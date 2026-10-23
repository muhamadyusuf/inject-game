// Evaluasi mesin game dan simulasi: bukti misi berasal dari log server (bukan klaim pemain).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const muat = (f) => import(pathToFileURL(path.join(__dirname, '..', 'public', f)).href);
const baru = async () => { const E = await muat('engine.js'); return { E, s: E.buatState('uji') }; };
const misi = (E, n) => E.LEVELS[n - 1];
let no = 0;
const entri = (o) => ({ no: ++no, versi: 'rentan', kategori: 'Pedang', skin: 'cerah', status: 200, jumlah: 2, via: 'burp', kode: 'ABCD', ...o });

test('simulasi: jumlah item, kebocoran hanya di versi rentan, item beta tidak pernah tampil', async () => {
  const { tanggapi, buatRequest, KATEGORI } = await muat('sim.js');
  const res = (k, v) => tanggapi(buatRequest({ kategori: k, cookieSkin: 'cerah', pemain: 'x' }), v);
  assert.deepEqual(KATEGORI.map((k) => res(k, 'aman').jumlah), [2, 2, 3]);
  assert.equal(res("'", 'rentan').status, 500);
  assert.match(res("'", 'rentan').badan, /Query: SELECT/);
  assert.equal(res("'", 'aman').status, 200);
  assert.doesNotMatch(res("'", 'aman').badan, /Query|SELECT|error/i);
  for (const v of ['rentan', 'aman']) for (const k of [...KATEGORI, "'", "''", 'Beta', '']) {
    assert.ok(!res(k, v).daftar.some((i) => i.rilis === false), `${v}/${k}`);
  }
});

test('permintaan SERANG: selalu request dasar yang sama (perubahan dilakukan di Burp)', async () => {
  const { E, s } = await baru();
  assert.deepEqual(E.buatPermintaan(s), { path: '/pasar/rentan/item?kategori=Pedang', skin: 'cerah' });
  for (const nama of ['setKartu', 'toggleSkin', 'toggleVersi']) assert.equal(E[nama], undefined, `${nama} sudah dihapus`);
});

test('misi tidak bisa diselesaikan dengan request dari tombol SERANG (via game)', async () => {
  const { E, s } = await baru();
  E.terapkanLog(s, [entri({ via: 'game', kategori: 'Ramuan' }), entri({ via: 'game', versi: 'rentan', kategori: "'", status: 500 })]);
  for (const n of [2, 3, 5]) assert.equal(E.stepSelesai(s, misi(E, n), misi(E, n).steps[0]), false, `misi ${n}`);
  assert.equal(E.stepSelesai(s, misi(E, 1), misi(E, 1).steps[0]), true, 'misi 1 cukup SERANG');
});

test('misi 1-5 selesai dari log server; pertanyaan terkunci sebelum bukti ada', async () => {
  const { E, s } = await baru();
  const jwb = (n, id, idx) => E.jawabStep(s, misi(E, n), id, idx);

  assert.equal(jwb(1, 'b', 0), false, 'terkunci sebelum ada request');
  E.terapkanLog(s, [entri({ via: 'game' })]);
  E.catatRespons(s, { status: 200, kode: 'ABCD', teks: 'x' }, () => 0.5);
  assert.equal(jwb(1, 'b', 1), false);
  assert.equal(jwb(1, 'b', 0), true);
  assert.equal(jwb(1, 'c', 1), true);
  const dStep = misi(E, 1).steps[3];
  const opsi = E.opsiStep(s, dStep);
  assert.equal(opsi.length, 3);
  assert.equal(opsi[s.kodeBenar], 'ABCD');
  assert.equal(new Set(opsi).size, 3, 'pilihan tidak boleh kembar');
  assert.equal(jwb(1, 'd', (s.kodeBenar + 1) % 3), false);
  assert.equal(jwb(1, 'd', s.kodeBenar), true);
  assert.equal(E.misiSelesai(s, misi(E, 1)), true);

  // Misi 2
  assert.equal(jwb(2, 'c', 1), false);
  E.terapkanLog(s, [...s.log, entri({ kategori: 'Perisai' }), entri({ kategori: 'Ramuan', jumlah: 3 })]);
  assert.equal(jwb(2, 'c', 0), false);
  assert.equal(jwb(2, 'c', 1), true);
  assert.equal(E.misiSelesai(s, misi(E, 2)), true);

  // Misi 3
  assert.equal(E.misiSelesai(s, misi(E, 3)), false);
  E.terapkanLog(s, [...s.log, entri({ kategori: "'", status: 500 })]);
  assert.equal(jwb(3, 'b', 0), false); assert.equal(jwb(3, 'b', 2), true); assert.equal(jwb(3, 'c', 0), true);
  assert.equal(E.misiSelesai(s, misi(E, 3)), true);

  // Misi 4
  E.terapkanLog(s, [...s.log, entri({ skin: 'gelap' })]);
  assert.equal(jwb(4, 'b', 1), true); assert.equal(jwb(4, 'c', 0), false); assert.equal(jwb(4, 'c', 1), true);
  assert.equal(E.misiSelesai(s, misi(E, 4)), true);

  // Misi 5 butuh jalur AMAN
  assert.equal(E.misiSelesai(s, misi(E, 5)), false);
  assert.equal(jwb(5, 'b', 1), false, 'terkunci sebelum request ke jalur aman');
  E.terapkanLog(s, [...s.log, entri({ versi: 'aman', kategori: "'", jumlah: 0 })]);
  assert.equal(jwb(5, 'b', 0), false); assert.equal(jwb(5, 'b', 1), true);
  assert.equal(jwb(5, 'c', 0), false); assert.equal(jwb(5, 'c', 2), true);
  assert.equal(E.misiSelesai(s, misi(E, 5)), true);
});

test('misi 3 butuh jalur rentan dan misi 5 butuh jalur aman (tidak bisa tertukar)', async () => {
  const { E, s } = await baru();
  E.terapkanLog(s, [entri({ versi: 'aman', kategori: "'" })]);
  assert.equal(E.stepSelesai(s, misi(E, 3), misi(E, 3).steps[0]), false);
  assert.equal(E.stepSelesai(s, misi(E, 5), misi(E, 5).steps[0]), true);
});

test('HP: 5 misi tepat 100, serangan biasa tidak cukup, jawaban salah memberi damage', async () => {
  const { E, s } = await baru();
  assert.equal(E.DMG_PER_MISI * E.LEVELS.length, E.HP_MUSUH);
  assert.equal(E.hpMusuh([1, 2, 3, 4, 5]), 0);
  assert.ok((await muat('missions.js')).DMG_BIASA < E.DMG_PER_MISI);
  assert.deepEqual(E.kenaDamage(s), { pingsan: false });
  for (let i = 0; i < 8; i++) E.kenaDamage(s);
  assert.deepEqual(E.kenaDamage(s), { pingsan: true });
  assert.equal(s.hpPemain, E.HP_PEMAIN);
});

test('semua pertanyaan punya indeks jawaban valid dan hint', async () => {
  const { E, s } = await baru();
  for (const l of E.LEVELS) {
    assert.ok(l.hint && l.cerita);
    for (const st of l.steps.filter((x) => x.tipe === 'tanya' && typeof x.opsi !== 'function')) {
      assert.ok(st.benar >= 0 && st.benar < st.opsi.length, `${l.id}${st.id}`);
    }
  }
  assert.equal(typeof E.LEVELS[0].steps[3].opsi, 'function');
});

test('server: /pasar menjawab skrip, mencatat bukti per pemain, membedakan game vs burp', async () => {
  const { createGameApp } = require('../server.js');
  const srv = createGameApp({ adminKey: 'kunci-uji-1234' }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const get = (p, h = {}) => fetch(base + p, { headers: h });
  const kuki = (pemain, skin) => `pemain=${pemain}${skin ? '; skin=' + skin : ''}`;
  try {
    // request pertama dari "game": nonce baru -> via game
    let r = await get('/pasar/rentan/item?kategori=Ramuan', { Cookie: kuki('budi'), 'X-Aksi': 'n1' });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Jumlah item: 3/);
    assert.match(r.headers.get('x-kode-bukti'), /^[0-9A-F]{4}$/);
    assert.match(r.headers.get('set-cookie') || '', /skin=cerah/);
    // nonce yang sama dipakai ulang (Repeater) -> via burp
    await get('/pasar/rentan/item?kategori=Perisai', { Cookie: kuki('budi'), 'X-Aksi': 'n1' });
    // tanpa nonce (ketik dari nol di Burp) -> via burp; kutip di jalur rentan -> 500 dengan query
    r = await get('/pasar/rentan/item?kategori=%27', { Cookie: kuki('budi', 'gelap') });
    assert.equal(r.status, 500);
    assert.match(await r.text(), /Query: SELECT/);
    assert.equal(r.headers.get('x-skin-aktif'), 'gelap');
    // jalur aman: kutip jadi data biasa
    r = await get('/pasar/aman/item?kategori=%27', { Cookie: kuki('budi') });
    assert.equal(r.status, 200);
    assert.doesNotMatch(await r.text(), /Query|SELECT/);

    const log = (await (await get('/api/log', { Cookie: kuki('budi') })).json()).log;
    assert.deepEqual(log.map((h) => h.via), ['game', 'burp', 'burp', 'burp']);
    assert.deepEqual(log.map((h) => h.status), [200, 200, 500, 200]);
    assert.equal(log[2].skin, 'gelap');
    assert.equal(log[2].kategori, "'");

    // pemain lain tidak melihat log budi
    assert.deepEqual((await (await get('/api/log', { Cookie: kuki('siti') })).json()).log, []);
    // reset
    await fetch(base + '/api/reset', { method: 'POST', headers: { Cookie: kuki('budi') } });
    assert.deepEqual((await (await get('/api/log', { Cookie: kuki('budi') })).json()).log, []);

    // batas: versi tak dikenal, kategori terlalu panjang
    assert.equal((await get('/pasar/lain/item?kategori=x')).status, 404);
    assert.equal((await get('/pasar/aman/item?kategori=' + 'a'.repeat(101))).status, 400);
    // tidak ada jalur yang menampilkan item beta
    for (const k of ['Beta', '%27%27', 'Pedang%27']) {
      const t = await (await get(`/pasar/rentan/item?kategori=${k}`)).text();
      assert.doesNotMatch(t, /\(Beta\)/, k);
    }
  } finally { srv.close(); }
});

test('server: halaman dan modul dari satu port; hanya satu kolom isian (nama pemain)', async () => {
  const { createGameApp } = require('../server.js');
  const srv = createGameApp({ adminKey: 'kunci-uji-1234' }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    for (const f of ['/', '/app.js', '/engine.js', '/sim.js', '/missions.js', '/style.css']) {
      assert.equal((await fetch(base + f)).status, 200, f);
    }
    const html = await (await fetch(base + '/')).text();
    const js = await (await fetch(base + '/app.js')).text();
    assert.equal((html.match(/<input/g) || []).length, 1);
    assert.doesNotMatch(html, /<textarea/);
    assert.doesNotMatch(js, /createElement\(['"](input|textarea)/);
    assert.doesNotMatch(js, /^import .*gstatic/m);
  } finally { srv.close(); }
});

test('hukuman kirim salah: request Burp yang tidak cocok misi aktif = -10 HP, dihitung sekali saja', async () => {
  const { E, s } = await baru();
  const m2 = misi(E, 2);
  // log lama sebelum misi aktif: ditandai diperiksa tanpa hukuman
  E.terapkanLog(s, [entri({ kategori: "'", status: 500 })]);
  assert.deepEqual(E.periksaKirim(s, null), { salah: 0, pingsan: false });
  assert.equal(s.hpPemain, 100);

  // Misi 2 aktif: kutip di jalur rentan tidak cocok langkah misi 2 -> -10
  E.terapkanLog(s, [...s.log, entri({ kategori: "'", status: 500 })]);
  assert.deepEqual(E.periksaKirim(s, m2), { salah: 1, pingsan: false });
  assert.equal(s.hpPemain, 90);
  assert.deepEqual(E.periksaKirim(s, m2), { salah: 0, pingsan: false }, 'tidak dihukum dua kali');
  assert.equal(s.hpPemain, 90);

  // request yang cocok (Perisai) dan request dari tombol SERANG tidak dihukum
  E.terapkanLog(s, [...s.log, entri({ kategori: 'Perisai' }), entri({ via: 'game', kategori: "'" })]);
  assert.deepEqual(E.periksaKirim(s, m2), { salah: 0, pingsan: false });
  assert.equal(s.hpPemain, 90);

  // beberapa salah sekaligus, dan pingsan memulihkan penuh
  E.terapkanLog(s, [...s.log, ...Array.from({ length: 9 }, () => entri({ kategori: 'Beta' }))]);
  const r = E.periksaKirim(s, m2);
  assert.equal(r.salah, 9);
  assert.equal(r.pingsan, true);
  assert.equal(s.hpPemain, 100);
});

test('hukuman kirim salah: log di-reset server tidak membuat request lama dihukum ulang', async () => {
  const { E, s } = await baru();
  E.terapkanLog(s, [entri({ no: 50, kategori: 'Beta' })]);
  E.periksaKirim(s, misi(E, 2));
  assert.equal(s.hpPemain, 90);
  E.terapkanLog(s, [{ ...entri({ kategori: 'Perisai' }), no: 1 }]); // server restart: nomor mulai lagi dari 1
  assert.deepEqual(E.periksaKirim(s, misi(E, 2)), { salah: 0, pingsan: false });
});

test('langkahSekarang: langkah terbuka pertama yang belum selesai, tiap aksi punya petunjuk', async () => {
  const { E, s } = await baru();
  assert.equal(E.langkahSekarang(s, misi(E, 1)).id, 'a');
  E.terapkanLog(s, [entri({ via: 'game' })]);
  assert.equal(E.langkahSekarang(s, misi(E, 1)).id, 'b');
  E.jawabStep(s, misi(E, 1), 'b', 0);
  assert.equal(E.langkahSekarang(s, misi(E, 1)).id, 'c');
  for (const l of E.LEVELS) {
    assert.ok(l.tujuan, `tujuan misi ${l.id}`);
    for (const st of l.steps.filter((x) => x.tipe === 'aksi')) assert.ok(st.detail && st.detail.length > 30, `detail ${l.id}${st.id}`);
  }
});

// ---------- dasbor admin ----------
async function jalankan(opsi) {
  const { createGameApp } = require('../server.js');
  const app = createGameApp(opsi);
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const f = (p, o = {}) => fetch(base + p, o);
  const json = (p, body, h = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) });
  return { srv, f, json, app };
}
const kukiAdmin = async (j) => {
  const r = await j('/api/admin/login', { kunci: 'rahasia123' });
  assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  return sc.split(';')[0];
};

test('admin: API terkunci tanpa login, kunci salah ditolak, kunci benar memberi cookie HttpOnly', async () => {
  const { srv, f, json } = await jalankan({ adminKey: 'rahasia123' });
  try {
    assert.equal((await f('/api/admin/pemain')).status, 401);
    assert.equal((await f('/api/admin/pemain', { headers: { Cookie: 'admin=asal' } })).status, 401);
    assert.equal((await f('/api/admin/pemain', { headers: { Cookie: 'pemain=budi' } })).status, 401, 'cookie pemain bukan admin');
    assert.equal((await json('/api/admin/hapus', {})).status, 401);
    assert.equal((await json('/api/admin/login', { kunci: 'salah' })).status, 401);
    assert.equal((await json('/api/admin/login', {})).status, 401);
    assert.deepEqual(await (await f('/api/admin/sesi')).json(), { masuk: false });
    const cookie = await kukiAdmin(json);
    assert.equal((await f('/api/admin/pemain', { headers: { Cookie: cookie } })).status, 200);
    assert.deepEqual(await (await f('/api/admin/sesi', { headers: { Cookie: cookie } })).json(), { masuk: true });
    assert.equal((await f('/admin.html')).status, 200);
    assert.match(await (await f('/admin.html')).text(), /noindex/);
  } finally { srv.close(); }
});

test('admin: laporan progres divalidasi, bukti log server digabung, pemain terpisah', async () => {
  const { srv, f, json } = await jalankan({ adminKey: 'rahasia123' });
  try {
    const cookie = await kukiAdmin(json);
    const lapor = (pemain, body) => json('/api/progres', body, { Cookie: `pemain=${pemain}` });
    assert.equal((await json('/api/progres', { nama: 'x' })).status, 400, 'tanpa cookie pemain');

    // laporan dengan nilai berbahaya/aneh dibersihkan
    assert.equal((await lapor('budi', { nama: '<b>Budi</b>\u0007 X-RPL', selesai: [1, 2, 2, 99, 'x', 0], misiAktif: 3, hpPemain: 500, hpMusuh: -4, salahJawab: 2, salahKirim: 1 })).status, 200);
    assert.equal((await lapor('siti', { nama: 'Siti', selesai: [], misiAktif: null, hpPemain: 90, hpMusuh: 100 })).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${srv.address().port}/api/progres`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'pemain=eko' }, body: '{rusak' })).status, 400);

    // bukti log server untuk budi: 1 dari tombol SERANG, lalu Perisai dan Ramuan dari Burp
    const k = { Cookie: 'pemain=budi' };
    await f('/pasar/rentan/item?kategori=Pedang', { headers: { ...k, 'X-Aksi': 'n1' } });
    await f('/pasar/rentan/item?kategori=Perisai', { headers: { ...k, 'X-Aksi': 'n1' } });
    await f('/pasar/rentan/item?kategori=Ramuan', { headers: k });

    const d = await (await f('/api/admin/pemain', { headers: { Cookie: cookie } })).json();
    assert.equal(d.jumlahMisi, 5);
    const budi = d.pemain.find((p) => p.id === 'budi');
    const siti = d.pemain.find((p) => p.id === 'siti');
    assert.ok(budi && siti);
    assert.doesNotMatch(budi.nama, /[<>\u0007]/);
    assert.deepEqual(budi.selesai, [1, 2]);
    assert.equal(budi.misiAktif, 3);
    assert.equal(budi.hpPemain, 100); assert.equal(budi.hpMusuh, 0);
    assert.equal(budi.reqGame, 1); assert.equal(budi.reqBurp, 2);
    assert.deepEqual(budi.aksiTerbukti, [true, true, false, false, false], 'misi 1 dan 2 terbukti di log');
    assert.equal(budi.salahJawab, 2); assert.equal(budi.salahKirim, 1);
    assert.equal(budi.online, true);
    assert.equal(siti.reqGame + siti.reqBurp, 0);
    assert.deepEqual(siti.aksiTerbukti, [false, false, false, false, false]);

    // hapus semua data
    assert.equal((await json('/api/admin/hapus', {}, { Cookie: cookie })).status, 200);
    assert.deepEqual((await (await f('/api/admin/pemain', { headers: { Cookie: cookie } })).json()).pemain, []);
  } finally { srv.close(); }
});

test('admin: percobaan login salah dibatasi (429), terkunci walau kunci benar', async () => {
  const { srv, json } = await jalankan({ adminKey: 'kunci-uji-1234' });
  try {
    for (let i = 0; i < 10; i++) assert.equal((await json('/api/admin/login', { kunci: 'salah' + i })).status, 401);
    assert.equal((await json('/api/admin/login', { kunci: 'salah' })).status, 429);
    assert.equal((await json('/api/admin/login', { kunci: 'kunci-uji-1234' })).status, 429);
  } finally { srv.close(); }
});

test('kunci admin stabil: dibuat sekali di file lalu dipakai terus, env menang, file rusak dibuat ulang', async () => {
  const fs = require('node:fs'), os = require('node:os');
  const { createGameApp } = require('../server.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kunci-'));
  const berkas = path.join(dir, '.admin-key');
  const envAwal = process.env.ADMIN_KEY;
  delete process.env.ADMIN_KEY;
  try {
    const a = createGameApp({ fileKunci: berkas });
    assert.equal(a.sumberKunci, 'file-baru');
    assert.match(a.adminKey, /^[0-9a-f]{16}$/);
    assert.equal(fs.readFileSync(berkas, 'utf8').trim(), a.adminKey);
    assert.equal(fs.statSync(berkas).mode & 0o077, 0, 'file hanya bisa dibaca pemiliknya');

    const b = createGameApp({ fileKunci: berkas }); // "restart": kunci harus sama
    assert.equal(b.sumberKunci, 'file');
    assert.equal(b.adminKey, a.adminKey);

    process.env.ADMIN_KEY = 'dari-env-hosting-123'; // env menang atas file
    const c = createGameApp({ fileKunci: berkas });
    assert.equal(c.sumberKunci, 'env');
    assert.equal(c.adminKey, 'dari-env-hosting-123');
    delete process.env.ADMIN_KEY;

    fs.writeFileSync(berkas, 'pendek\n'); // terlalu pendek -> dibuat ulang
    const d = createGameApp({ fileKunci: berkas });
    assert.equal(d.sumberKunci, 'file-baru');
    assert.ok(d.adminKey.length >= 8 && d.adminKey !== 'pendek');

    const e = createGameApp({ fileKunci: path.join(dir, 'tidak-ada', 'x') }); // tak bisa ditulis -> acak
    assert.equal(e.sumberKunci, 'acak');
    assert.ok(e.adminKey.length >= 8);
  } finally {
    if (envAwal === undefined) delete process.env.ADMIN_KEY; else process.env.ADMIN_KEY = envAwal;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hosting di balik proxy HTTPS: cookie admin Secure, pembatas login per alamat asli pengunjung', async () => {
  const login = (j, kunci, h = {}) => j('/api/admin/login', { kunci }, h);
  // tanpa trust proxy: header X-Forwarded-Proto diabaikan
  let t = await jalankan({ adminKey: 'kunci-uji-1234' });
  try {
    const r = await login(t.json, 'kunci-uji-1234', { 'X-Forwarded-Proto': 'https' });
    assert.doesNotMatch(r.headers.get('set-cookie'), /Secure/);
  } finally { t.srv.close(); }

  t = await jalankan({ adminKey: 'kunci-uji-1234', trustProxy: 1 });
  try {
    const r = await login(t.json, 'kunci-uji-1234', { 'X-Forwarded-Proto': 'https' });
    assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=86400; Secure/);
    // pembatas per IP asli: 10 gagal dari satu pengunjung tidak mengunci pengunjung lain
    for (let i = 0; i < 10; i++) await login(t.json, 'salah' + i, { 'X-Forwarded-For': '203.0.113.7' });
    assert.equal((await login(t.json, 'salah', { 'X-Forwarded-For': '203.0.113.7' })).status, 429);
    assert.equal((await login(t.json, 'kunci-uji-1234', { 'X-Forwarded-For': '198.51.100.9' })).status, 200);
  } finally { t.srv.close(); }
});

test('server: file rahasia dan kode server tidak bisa diunduh lewat web (termasuk trik ../)', async () => {
  const fs = require('node:fs');
  const { createGameApp } = require('../server.js');
  const rahasia = path.join(__dirname, '..', '.env.uji-rahasia');
  fs.writeFileSync(rahasia, 'KUNCI-RAHASIA-UJI');
  const srv = createGameApp({ adminKey: 'kunci-uji-1234' }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  try {
    const port = srv.address().port;
    const http = require('node:http');
    const ambil = (p) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: p }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', reject);
    });
    for (const p of ['/.env', '/.admin-key', '/.env.uji-rahasia', '/server.js', '/start.js', '/test/engine.test.js',
      '/..%2f.env.uji-rahasia', '/%2e%2e/.env.uji-rahasia', '/public/../.env.uji-rahasia', '/../.env.uji-rahasia', '/api/../.env.uji-rahasia']) {
      const r = await ambil(p);
      assert.notEqual(r.status, 200, p);
      assert.doesNotMatch(r.body, /KUNCI-RAHASIA-UJI|createGameApp/, p);
    }
  } finally { srv.close(); fs.rmSync(rahasia, { force: true }); }
});

test('halaman login memuat kotak "Cara bermain" (3 langkah) dan tombol bantuan; kartu intro lama dihapus', async () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(html, /id="modal-intro"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.equal((html.match(/<ol class="cara">[\s\S]*?<\/ol>/)[0].match(/<li>/g) || []).length, 3);
  assert.ok((html.match(/data-bantuan="1"/g) || []).length >= 2, 'tombol ❓ di login dan di menu');
  assert.match(js, /if \(!sudahLihat\) bukaIntro\(\)/);
  assert.doesNotMatch(js, /introTampil|htmlIntro|data-act="intro-ok"|pasar-pixel:intro:/);
});

test('kunci contoh dari .env.example ditolak sebagai kunci admin (publik)', async () => {
  const fs = require('node:fs'), os = require('node:os');
  const { createGameApp } = require('../server.js');
  const contoh = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8').match(/^ADMIN_KEY=(.+)$/m)[1];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kunci-'));
  const envAwal = process.env.ADMIN_KEY;
  const peringatan = [];
  const warnAwal = console.warn;
  console.warn = (m) => peringatan.push(m);
  try {
    process.env.ADMIN_KEY = contoh;
    const app = createGameApp({ fileKunci: path.join(dir, '.admin-key') });
    assert.notEqual(app.adminKey, contoh, 'nilai contoh tidak boleh jadi kunci');
    assert.notEqual(app.sumberKunci, 'env');
    assert.ok(peringatan.some((m) => /nilai contoh/.test(m)));
  } finally {
    console.warn = warnAwal;
    if (envAwal === undefined) delete process.env.ADMIN_KEY; else process.env.ADMIN_KEY = envAwal;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
