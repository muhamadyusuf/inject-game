// Server game, mandiri: satu port (3003), tanpa database, tanpa internet.
//
// Selain menyajikan halaman, server ini menyediakan "Pasar Pixel" sebagai endpoint HTTP
// SUNGGUHAN supaya Burp Suite asli bisa menangkap dan mengulang request-nya.
// Jawabannya DISKRIPKAN oleh public/sim.js: tidak ada database, tidak ada query sungguhan,
// dan tidak ada kode rentan. Server mencatat request yang masuk sebagai bukti misi, dan
// menyediakan dasbor admin (dilindungi kunci) untuk memantau progres pemain.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { buatStore } = require('./store.js');

const PUBLIC = path.join(__dirname, 'public');
const MAKS_KATEGORI = 100;
const ONLINE_MS = 25000; // klien melapor tiap <= 10 detik
const KUNCI_CONTOH = 'ganti-dengan-kunci-acak-yang-panjang'; // sama dengan .env.example

const impor = (f) => import(pathToFileURL(path.join(PUBLIC, f)).href);
let simP, misiP;
const muatSim = () => (simP ||= impor('sim.js'));
const muatMisi = () => (misiP ||= impor('missions.js'));

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) {
      try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* abaikan cookie rusak */ }
    }
  });
  return out;
}
const bersihkanPemain = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9:-]/g, '').slice(0, 40);
const bersihkanNama = (v) => String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24);
const angka = (v, min, max, awal) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : awal);
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// Kunci admin yang STABIL, urutan prioritas:
//   1. opsi.adminKey (untuk tes)
//   2. env ADMIN_KEY            -> cara standar saat di-hosting
//   3. file .admin-key          -> dibuat sekali, dipakai terus walau server restart (lokal / disk persisten)
//   4. acak per proses          -> cadangan jika file tidak bisa ditulis (kunci berubah tiap restart)
function tentukanKunci(opsi = {}) {
  if (opsi.adminKey) return { kunci: String(opsi.adminKey), sumber: 'opsi' };
  if (process.env.ADMIN_KEY === KUNCI_CONTOH) {
    // Nilai contoh dari .env.example bersifat publik: jangan pernah dipakai sebagai kunci sungguhan.
    console.warn('PERINGATAN: ADMIN_KEY masih nilai contoh dari .env.example (publik). Diabaikan; ganti dengan kunci Anda sendiri.');
  } else if (process.env.ADMIN_KEY) return { kunci: String(process.env.ADMIN_KEY), sumber: 'env' };
  const berkas = opsi.fileKunci || process.env.ADMIN_KEY_FILE || path.join(__dirname, '.admin-key');
  try {
    const isi = fs.readFileSync(berkas, 'utf8').trim();
    if (isi.length >= 8) return { kunci: isi, sumber: 'file', berkas };
  } catch { /* belum ada: buat di bawah */ }
  const baru = crypto.randomBytes(8).toString('hex');
  try {
    fs.writeFileSync(berkas, baru + '\n', { mode: 0o600 });
    return { kunci: baru, sumber: 'file-baru', berkas };
  } catch {
    return { kunci: baru, sumber: 'acak' };
  }
}

// opsi.adminKey, opsi.fileKunci, opsi.trustProxy (jumlah proxy di depan server; 0 = tanpa proxy).
function createGameApp(opsi = {}) {
  const { kunci: adminKey, sumber } = tentukanKunci(opsi);
  const adminToken = sha('admin:' + adminKey);
  // Di Vercel (serverless) kunci acak/file berbeda tiap instans, jadi admin dimatikan sampai ADMIN_KEY diatur.
  const adminAktif = !(process.env.VERCEL && sumber === 'acak');
  const store = opsi.store || buatStore(process.env);
  const app = express();
  app.disable('x-powered-by');
  const proxy = opsi.trustProxy ?? Number(process.env.TRUST_PROXY || (process.env.VERCEL ? 1 : 0));
  if (proxy) app.set('trust proxy', proxy);
  app.adminKey = adminKey;
  app.sumberKunci = sumber;
  app.store = store;

  // ---------- Pasar Pixel (target Burp) ----------
  app.get('/pasar/:versi/item', async (req, res) => {
    const { versi } = req.params;
    if (versi !== 'rentan' && versi !== 'aman') return res.status(404).type('text/plain').send('Versi tidak dikenal');
    const kategori = typeof req.query.kategori === 'string' ? req.query.kategori : 'Pedang';
    if (kategori.length > MAKS_KATEGORI) return res.status(400).type('text/plain').send('Kategori terlalu panjang');

    const cookies = parseCookies(req.headers.cookie);
    const pemain = bersihkanPemain(cookies.pemain || req.get('X-Kode-Pemain')) || 'anonim';
    const skin = cookies.skin === 'gelap' ? 'gelap' : 'cerah';

    const { tanggapi, buatRequest } = await muatSim();
    const hasil = tanggapi(buatRequest({ kategori, cookieSkin: skin, pemain }), versi);

    // via: 'game' = request pertama dari tombol SERANG; 'burp' = nonce dipakai ulang atau tidak ada
    // (artinya diulang atau diubah di luar game, mis. di Repeater). Dicatat oleh store.
    const nonce = String(req.get('X-Aksi') || '').slice(0, 64);
    const kode = crypto.randomBytes(2).toString('hex').toUpperCase();
    await store.catat(pemain, { versi, kategori, skin, status: hasil.status, jumlah: hasil.jumlah, kode }, nonce);

    if (!cookies.skin) res.append('Set-Cookie', 'skin=cerah; Path=/; SameSite=Lax');
    res.set({ 'X-Skin-Aktif': skin, 'X-Kode-Bukti': kode, 'Cache-Control': 'no-store' });
    res.status(hasil.status).type('text/plain').send(hasil.badan);
  });

  const pemainDariCookie = (req) => bersihkanPemain(parseCookies(req.headers.cookie).pemain);

  app.get('/api/log', async (req, res) => {
    const pemain = pemainDariCookie(req);
    res.set('Cache-Control', 'no-store').json({ log: pemain ? await store.log(pemain) : [] });
  });
  app.post('/api/reset', async (req, res) => {
    const pemain = pemainDariCookie(req);
    if (pemain) await store.reset(pemain);
    res.json({ ok: true });
  });

  // ---------- Laporan progres dari pemain ----------
  app.post('/api/progres', express.json({ limit: '2kb' }), async (req, res) => {
    const pemain = pemainDariCookie(req);
    if (!pemain) return res.status(400).json({ error: 'cookie pemain tidak ada' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const sebelum = await store.profil(pemain);
    await store.simpanProfil(pemain, {
      nama: bersihkanNama(b.nama) || pemain,
      selesai: [...new Set((Array.isArray(b.selesai) ? b.selesai : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5))].sort(),
      misiAktif: b.misiAktif === null ? null : angka(b.misiAktif, 1, 5, null),
      hpPemain: angka(b.hpPemain, 0, 100, 100),
      hpMusuh: angka(b.hpMusuh, 0, 100, 100),
      salahJawab: angka(b.salahJawab, 0, 9999, 0),
      salahKirim: angka(b.salahKirim, 0, 9999, 0),
      mulai: sebelum ? sebelum.mulai : Date.now(),
      terakhir: Date.now(),
    });
    res.json({ ok: true });
  });

  // ---------- Admin ----------
  app.use('/api/admin', (req, res, next) => (adminAktif ? next() : res.status(503).json({ error: 'ADMIN_KEY belum diatur di server (wajib di Vercel)' })));
  const gagal = new Map(); // ip -> { n, reset }
  const cekAdmin = (req) => {
    const t = parseCookies(req.headers.cookie).admin || '';
    const a = Buffer.from(sha('x' + t)), b = Buffer.from(sha('x' + adminToken));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const wajibAdmin = (req, res, next) => (cekAdmin(req) ? next() : res.status(401).set('Cache-Control', 'no-store').json({ error: 'perlu login admin' }));

  app.post('/api/admin/login', express.json({ limit: '1kb' }), (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || '?';
    const g = gagal.get(ip);
    if (g && g.n >= 10 && Date.now() < g.reset) return res.status(429).json({ error: 'terlalu banyak percobaan, tunggu semenit' });
    const kunci = String((req.body && req.body.kunci) || '');
    const a = Buffer.from(sha(kunci)), b = Buffer.from(sha(adminKey));
    if (!crypto.timingSafeEqual(a, b)) {
      const n = g && Date.now() < g.reset ? g.n + 1 : 1;
      gagal.set(ip, { n, reset: g && Date.now() < g.reset ? g.reset : Date.now() + 60000 });
      return res.status(401).json({ error: 'kunci salah' });
    }
    gagal.delete(ip);
    res.append('Set-Cookie', `admin=${adminToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${req.secure ? '; Secure' : ''}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/keluar', (req, res) => { res.append('Set-Cookie', 'admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'); res.json({ ok: true }); });
  app.get('/api/admin/sesi', (req, res) => res.set('Cache-Control', 'no-store').json({ masuk: cekAdmin(req) }));

  app.get('/api/admin/pemain', wajibAdmin, async (req, res) => {
    const { LEVELS } = await muatMisi();
    const sekarang = Date.now();
    const semua = await store.semua();
    const baris = semua.map(({ id, profil: pf, log }) => {
      // Bukti terverifikasi server: apakah SEMUA langkah aksi sebuah misi sudah terbukti di log.
      const aksiTerbukti = LEVELS.map((m) => m.steps.filter((st) => st.tipe === 'aksi').every((st) => {
        try { return !!st.selesai({ log }); } catch { return false; }
      }));
      const terakhirLog = log.length ? log[log.length - 1].t : 0;
      const terakhir = Math.max(pf ? pf.terakhir : 0, terakhirLog);
      return {
        id, nama: pf ? pf.nama : id,
        selesai: pf ? pf.selesai : [], misiAktif: pf ? pf.misiAktif : null,
        hpPemain: pf ? pf.hpPemain : null, hpMusuh: pf ? pf.hpMusuh : null,
        salahJawab: pf ? pf.salahJawab : 0, salahKirim: pf ? pf.salahKirim : 0,
        reqGame: log.filter((h) => h.via === 'game').length, reqBurp: log.filter((h) => h.via === 'burp').length,
        aksiTerbukti, mulai: pf ? pf.mulai : null, terakhir, online: sekarang - terakhir < ONLINE_MS,
      };
    }).sort((a, b) => b.terakhir - a.terakhir);
    res.set('Cache-Control', 'no-store').json({ sekarang, jumlahMisi: LEVELS.length, pemain: baris, penyimpanan: store.mode, serverless: !!process.env.VERCEL });
  });
  app.post('/api/admin/hapus', wajibAdmin, async (req, res) => { await store.hapusSemua(); res.json({ ok: true }); });

  app.use(express.static(PUBLIC));
  // Body rusak atau terlalu besar: jawab 400/413 tanpa membocorkan jejak error.
  app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) return res.status(err.status || 400).json({ error: 'permintaan tidak valid' });
    next(err);
  });
  // Kegagalan lain (mis. penyimpanan tidak terjangkau): jawaban generik, rincian hanya di log server.
  app.use((err, req, res, next) => {
    console.error('kesalahan:', err && err.message);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'kesalahan server' });
  });
  return app;
}

// Ekspor utama adalah handler (req, res) supaya dikenali Vercel dan platform serverless lain;
// createGameApp tetap tersedia sebagai properti (dipakai tes, start lokal, dan api/index.js).
let appBawaan;
function handler(req, res) { return (appBawaan ||= createGameApp())(req, res); }
handler.createGameApp = createGameApp;
module.exports = handler;

if (require.main === module) {
  const port = Number(process.env.PORT || 3003);
  const app = createGameApp();
  app.listen(port, '0.0.0.0', (err) => {
    if (err) { console.error('Gagal membuka port ' + port + ': ' + err.message); process.exit(1); }
    console.log(`Misi Pasar Pixel di http://localhost:${port}`);
    const info = {
      env: 'Kunci: (dari variabel ADMIN_KEY, tidak dicetak)',
      file: `Kunci: ${app.adminKey}   (tersimpan tetap di .admin-key)`,
      'file-baru': `Kunci: ${app.adminKey}   (dibuat sekali, disimpan di .admin-key dan dipakai terus)`,
      acak: `Kunci: ${app.adminKey}   (ACAK, berubah tiap restart: set ADMIN_KEY agar tetap)`,
    }[app.sumberKunci];
    console.log(`Dasbor admin     : /admin.html   ${info}`);
    if (app.sumberKunci === 'env' && String(process.env.ADMIN_KEY).length < 8) console.warn('PERINGATAN: ADMIN_KEY kurang dari 8 karakter. Pakai kunci yang lebih panjang.');
  });
}
