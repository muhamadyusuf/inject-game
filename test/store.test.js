// Kontrak penyimpanan: implementasi memori dan redis harus berperilaku sama.
// Plus uji "serverless": dua instans server yang berbagi satu redis, dan kegagalan redis.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { buatStoreMemori, buatStoreRedis, buatStore, MAKS_LOG, MAKS_PEMAIN } = require('../store.js');
const { buatRedisPalsu } = require('./redis-palsu.js');

const data = (o = {}) => ({ versi: 'rentan', kategori: 'Pedang', skin: 'cerah', status: 200, jumlah: 2, kode: 'ABCD', ...o });
const profilContoh = (o = {}) => ({ nama: 'Budi', selesai: [1], misiAktif: 2, hpPemain: 90, hpMusuh: 80, salahJawab: 1, salahKirim: 0, mulai: 1, terakhir: 2, ...o });

// Jam palsu supaya urutan "terlama" deterministik (skor ZADD berbeda tiap panggilan).
async function denganJam(fn) {
  const asli = Date.now; let t = 1_700_000_000_000;
  Date.now = () => ++t;
  try { return await fn(); } finally { Date.now = asli; }
}

const fabrik = {
  memori: async () => ({ store: buatStoreMemori(), tutup() {} }),
  redis: async () => { const r = await buatRedisPalsu(); return { store: buatStoreRedis(r.url, r.token), tutup: r.tutup, r }; },
};

for (const [nama, buat] of Object.entries(fabrik)) {
  test(`[${nama}] nonce baru = game, nonce dipakai ulang = burp, tanpa nonce = burp, nomor urut naik`, async () => {
    const { store, tutup } = await buat();
    try {
      const a = await store.catat('budi', data(), 'n1');
      const b = await store.catat('budi', data({ kategori: 'Perisai' }), 'n1');
      const c = await store.catat('budi', data({ kategori: 'Ramuan' }), '');
      const d = await store.catat('budi', data(), 'n2');
      assert.deepEqual([a.via, b.via, c.via, d.via], ['game', 'burp', 'burp', 'game']);
      assert.deepEqual([a.no, b.no, c.no, d.no], [1, 2, 3, 4]);
      assert.equal(store.mode, nama);
      const log = await store.log('budi');
      assert.deepEqual(log.map((h) => h.kategori), ['Pedang', 'Perisai', 'Ramuan', 'Pedang']);
      assert.ok(log.every((h) => typeof h.t === 'number' && h.kode === 'ABCD'));
    } finally { tutup(); }
  });

  test(`[${nama}] log per pemain terpisah, pemain tak dikenal kosong`, async () => {
    const { store, tutup } = await buat();
    try {
      await store.catat('budi', data(), 'a'); await store.catat('siti', data({ kategori: 'Ramuan' }), 'b');
      assert.equal((await store.log('budi')).length, 1);
      assert.equal((await store.log('siti'))[0].kategori, 'Ramuan');
      assert.deepEqual(await store.log('eko'), []);
      assert.equal(await store.profil('eko'), null);
    } finally { tutup(); }
  });

  test(`[${nama}] log dibatasi ${MAKS_LOG} entri terakhir, nomor urut tetap naik`, async () => {
    const { store, tutup } = await buat();
    try {
      for (let i = 1; i <= MAKS_LOG + 5; i++) await store.catat('budi', data(), 'n' + i);
      const log = await store.log('budi');
      assert.equal(log.length, MAKS_LOG);
      assert.equal(log[0].no, 6);
      assert.equal(log.at(-1).no, MAKS_LOG + 5);
    } finally { tutup(); }
  });

  test(`[${nama}] reset menghapus log dan nomor urut, tetapi nonce lama tetap dianggap sudah dipakai`, async () => {
    const { store, tutup } = await buat();
    try {
      await store.catat('budi', data(), 'lama');
      await store.reset('budi');
      assert.deepEqual(await store.log('budi'), []);
      const e = await store.catat('budi', data(), 'lama');
      assert.equal(e.via, 'burp', 'mengulang nonce lama setelah reset tetap berlabel burp');
      assert.equal(e.no, 1, 'nomor urut mulai lagi dari 1');
      assert.equal((await store.catat('budi', data(), 'baru')).via, 'game');
    } finally { tutup(); }
  });

  test(`[${nama}] profil disimpan dan dibaca, semua() menggabungkan profil dan log`, async () => {
    const { store, tutup } = await buat();
    try {
      await store.simpanProfil('budi', profilContoh());
      await store.simpanProfil('siti', profilContoh({ nama: 'Siti' }));
      await store.catat('budi', data(), 'x');
      await store.catat('eko', data({ kategori: 'Ramuan' }), 'y'); // hanya log, tanpa profil
      assert.deepEqual(await store.profil('budi'), profilContoh());
      const semua = await store.semua();
      assert.deepEqual(semua.map((p) => p.id).sort(), ['budi', 'eko', 'siti']);
      const budi = semua.find((p) => p.id === 'budi'), eko = semua.find((p) => p.id === 'eko'), siti = semua.find((p) => p.id === 'siti');
      assert.equal(budi.profil.nama, 'Budi'); assert.equal(budi.log.length, 1);
      assert.equal(eko.profil, null); assert.equal(eko.log[0].kategori, 'Ramuan');
      assert.deepEqual(siti.log, []);
    } finally { tutup(); }
  });

  test(`[${nama}] jumlah pemain dibatasi ${MAKS_PEMAIN}: yang tertua dibuang`, async () => {
    await denganJam(async () => {
      const { store, tutup } = await buat();
      try {
        for (let i = 0; i < MAKS_PEMAIN + 5; i++) await store.catat('p' + String(i).padStart(3, '0'), data(), 'n');
        const ids = (await store.semua()).map((p) => p.id);
        assert.equal(ids.length, MAKS_PEMAIN);
        assert.ok(!ids.includes('p000') && !ids.includes('p004'), 'pemain tertua dibuang');
        assert.ok(ids.includes('p504'), 'pemain terbaru tetap ada');
      } finally { tutup(); }
    });
  });

  test(`[${nama}] hapusSemua mengosongkan semuanya`, async () => {
    const { store, tutup } = await buat();
    try {
      await store.simpanProfil('budi', profilContoh()); await store.catat('budi', data(), 'a');
      await store.hapusSemua();
      assert.deepEqual(await store.semua(), []);
      assert.deepEqual(await store.log('budi'), []);
      assert.equal(await store.profil('budi'), null);
    } finally { tutup(); }
  });
}

test('redis: kunci diberi kedaluwarsa agar data tidak menumpuk selamanya, dan token dikirim', async () => {
  const r = await buatRedisPalsu('rahasia-redis');
  try {
    const store = buatStoreRedis(r.url, 'rahasia-redis');
    await store.catat('budi', data(), 'n1');
    await store.simpanProfil('budi', profilContoh());
    for (const k of ['pp:l:budi', 'pp:c:budi', 'pp:p:budi', 'pp:n:budi:n1']) assert.ok(r.ttl.get(k) > 0, `TTL ${k}`);
    assert.equal(r.statistik.tanpaAuth, 0);
    await assert.rejects(buatStoreRedis(r.url, 'token-salah').log('budi'), /401/);
  } finally { r.tutup(); }
});

test('buatStore memilih redis dari variabel Upstash atau Vercel KV, selain itu memori', async () => {
  assert.equal(buatStore({}).mode, 'memori');
  assert.equal(buatStore({ UPSTASH_REDIS_REST_URL: 'http://x', UPSTASH_REDIS_REST_TOKEN: 't' }).mode, 'redis');
  assert.equal(buatStore({ KV_REST_API_URL: 'http://x', KV_REST_API_TOKEN: 't' }).mode, 'redis');
  assert.equal(buatStore({ KV_REST_API_URL: 'http://x' }).mode, 'memori', 'URL tanpa token tidak cukup');
});

// ---------- server dengan penyimpanan redis, meniru serverless ----------
async function naikkan(app) {
  const srv = http.createServer(app).listen(0);
  await new Promise((r) => srv.once('listening', r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}
const { createGameApp } = require('../server.js');

test('serverless: dua instans server berbagi data lewat redis (bukti, progres, admin)', async () => {
  const r = await buatRedisPalsu();
  const kunci = 'kunci-uji-1234';
  const A = await naikkan(createGameApp({ adminKey: kunci, store: buatStoreRedis(r.url, r.token) }));
  const B = await naikkan(createGameApp({ adminKey: kunci, store: buatStoreRedis(r.url, r.token) })); // "instans" lain
  try {
    const k = { Cookie: 'pemain=budi' };
    // request pertama lewat instans A (tombol SERANG), pengulangan lewat instans B (Burp Repeater)
    assert.equal((await fetch(A.base + '/pasar/rentan/item?kategori=Pedang', { headers: { ...k, 'X-Aksi': 'n1' } })).status, 200);
    assert.equal((await fetch(B.base + '/pasar/rentan/item?kategori=Perisai', { headers: { ...k, 'X-Aksi': 'n1' } })).status, 200);
    const kutip = await fetch(B.base + '/pasar/rentan/item?kategori=%27', { headers: k });
    assert.equal(kutip.status, 500);
    // log dibaca dari instans mana pun: sama
    for (const T of [A, B]) {
      const log = (await (await fetch(T.base + '/api/log', { headers: k })).json()).log;
      assert.deepEqual(log.map((h) => h.via), ['game', 'burp', 'burp']);
      assert.deepEqual(log.map((h) => h.no), [1, 2, 3]);
    }
    // laporan progres lewat A, dasbor admin lewat B
    await fetch(A.base + '/api/progres', { method: 'POST', headers: { 'Content-Type': 'application/json', ...k }, body: JSON.stringify({ nama: 'Budi', selesai: [1], misiAktif: 2, hpPemain: 90, hpMusuh: 80, salahJawab: 1, salahKirim: 2 }) });
    const login = await fetch(B.base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kunci }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    // cookie admin dari instans B juga sah di instans A (token diturunkan dari kunci, tanpa sesi di memori)
    for (const T of [A, B]) {
      const d = await (await fetch(T.base + '/api/admin/pemain', { headers: { Cookie: cookie } })).json();
      assert.equal(d.penyimpanan, 'redis');
      const budi = d.pemain.find((p) => p.id === 'budi');
      assert.equal(budi.nama, 'Budi'); assert.deepEqual(budi.selesai, [1]);
      assert.equal(budi.reqGame, 1); assert.equal(budi.reqBurp, 2);
      // log: SERANG Pedang (game), Perisai (burp), kutip di jalur rentan (burp)
      assert.deepEqual(budi.aksiTerbukti, [true, false, true, false, false]);
    }
    await fetch(A.base + '/api/reset', { method: 'POST', headers: k });
    assert.deepEqual((await (await fetch(B.base + '/api/log', { headers: k })).json()).log, []);
    assert.equal((await fetch(A.base + '/api/admin/hapus', { method: 'POST', headers: { Cookie: cookie } })).status, 200);
    assert.deepEqual((await (await fetch(B.base + '/api/admin/pemain', { headers: { Cookie: cookie } })).json()).pemain, []);
  } finally { A.srv.close(); B.srv.close(); r.tutup(); }
});

test('serverless: redis tidak terjangkau -> 500 generik tanpa jejak error, bukan crash', async () => {
  const r = await buatRedisPalsu(); const url = r.url; r.tutup(); // sengaja ditutup
  const T = await naikkan(createGameApp({ adminKey: 'kunci-uji-1234', store: buatStoreRedis(url, 'token-uji') }));
  const galat = console.error; const dicatat = []; console.error = (...a) => dicatat.push(a.join(' '));
  try {
    for (const p of ['/pasar/aman/item?kategori=Pedang', '/api/log']) {
      const res = await fetch(T.base + p, { headers: { Cookie: 'pemain=budi' } });
      assert.equal(res.status, 500, p);
      const t = await res.text();
      assert.match(t, /kesalahan server/);
      assert.doesNotMatch(t, /ECONNREFUSED|at |node:|127\.0\.0\.1/);
    }
    assert.ok(dicatat.length >= 2, 'rincian hanya di log server');
  } finally { console.error = galat; T.srv.close(); }
});

test('Vercel: api/index.js adalah handler yang melayani jalur dinamis; admin mati tanpa ADMIN_KEY', async () => {
  const envAwal = { V: process.env.VERCEL, K: process.env.ADMIN_KEY, F: process.env.ADMIN_KEY_FILE };
  process.env.VERCEL = '1'; delete process.env.ADMIN_KEY; process.env.ADMIN_KEY_FILE = '/tidak/ada/dir/.admin-key'; // file tak bisa ditulis -> kunci acak
  try {
    delete require.cache[require.resolve('../api/index.js')];
    const handler = require('../api/index.js');
    assert.equal(typeof handler, 'function');
    const T = await naikkan(handler);
    try {
      assert.equal((await fetch(T.base + '/pasar/aman/item?kategori=Ramuan', { headers: { Cookie: 'pemain=budi' } })).status, 200);
      assert.equal((await fetch(T.base + '/api/log', { headers: { Cookie: 'pemain=budi' } })).status, 200);
      const admin = await fetch(T.base + '/api/admin/sesi');
      assert.equal(admin.status, 503, 'admin dimatikan sampai ADMIN_KEY diatur');
      assert.match((await admin.json()).error, /ADMIN_KEY/);
      assert.equal((await fetch(T.base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"kunci":"x"}' })).status, 503);
    } finally { T.srv.close(); }
  } finally {
    for (const [k, v] of [['VERCEL', envAwal.V], ['ADMIN_KEY', envAwal.K], ['ADMIN_KEY_FILE', envAwal.F]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete require.cache[require.resolve('../api/index.js')];
  }
});

test('Vercel: dengan ADMIN_KEY admin aktif, cookie Secure di balik HTTPS, dan vercel.json benar', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const envAwal = { V: process.env.VERCEL, K: process.env.ADMIN_KEY };
  process.env.VERCEL = '1'; process.env.ADMIN_KEY = 'kunci-vercel-uji-1';
  try {
    delete require.cache[require.resolve('../api/index.js')];
    const T = await naikkan(require('../api/index.js'));
    try {
      const login = await fetch(T.base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ kunci: 'kunci-vercel-uji-1' }) });
      assert.equal(login.status, 200);
      assert.match(login.headers.get('set-cookie'), /Secure/, 'trust proxy otomatis aktif di Vercel');
      const d = await (await fetch(T.base + '/api/admin/pemain', { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } })).json();
      assert.equal(d.serverless, true);
      assert.equal(d.penyimpanan, 'memori', 'tanpa variabel Redis, dasbor akan menampilkan peringatan');
    } finally { T.srv.close(); }
  } finally {
    for (const [k, v] of [['VERCEL', envAwal.V], ['ADMIN_KEY', envAwal.K]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete require.cache[require.resolve('../api/index.js')];
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.equal(cfg.rewrites[0].destination, '/api');
  assert.match(cfg.functions['api/index.js'].includeFiles, /public/, 'sim.js dan missions.js dimuat dinamis, harus ikut dibundel');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'sim.js')) && fs.existsSync(path.join(__dirname, '..', 'public', 'missions.js')));
});
