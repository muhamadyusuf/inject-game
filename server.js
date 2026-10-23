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

const PUBLIC = path.join(__dirname, 'public');
const MAKS_PEMAIN = 500;
const MAKS_LOG = 100;
const MAKS_NONCE = 200;
const MAKS_KATEGORI = 100;
const ONLINE_MS = 15000;
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
  const app = express();
  app.disable('x-powered-by');
  const proxy = opsi.trustProxy ?? Number(process.env.TRUST_PROXY || 0);
  if (proxy) app.set('trust proxy', proxy);
  app.adminKey = adminKey;
  app.sumberKunci = sumber;

  // pemain -> { log, nonce, no }. Hanya di memori; hilang saat server restart.
  const data = new Map();
  // pemain -> laporan progres yang DILAPORKAN pemain sendiri (bukan bukti terverifikasi).
  const profil = new Map();
  const batasi = (m) => { if (m.size >= MAKS_PEMAIN) m.delete(m.keys().next().value); };
  const ambil = (pemain) => {
    if (!data.has(pemain)) { batasi(data); data.set(pemain, { log: [], nonce: new Set(), no: 0 }); }
    return data.get(pemain);
  };

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
    // (artinya diulang atau diubah di luar game, mis. di Repeater).
    const p = ambil(pemain);
    const nonce = String(req.get('X-Aksi') || '').slice(0, 64);
    let via = 'burp';
    if (nonce && !p.nonce.has(nonce)) {
      via = 'game';
      if (p.nonce.size >= MAKS_NONCE) p.nonce.delete(p.nonce.values().next().value);
      p.nonce.add(nonce);
    }
    const kode = crypto.randomBytes(2).toString('hex').toUpperCase();
    p.log.push({ no: ++p.no, versi, kategori, skin, status: hasil.status, jumlah: hasil.jumlah, via, kode, t: Date.now() });
    if (p.log.length > MAKS_LOG) p.log.shift();

    if (!cookies.skin) res.append('Set-Cookie', 'skin=cerah; Path=/; SameSite=Lax');
    res.set({ 'X-Skin-Aktif': skin, 'X-Kode-Bukti': kode, 'Cache-Control': 'no-store' });
    res.status(hasil.status).type('text/plain').send(hasil.badan);
  });

  const pemainDariCookie = (req) => bersihkanPemain(parseCookies(req.headers.cookie).pemain);

  app.get('/api/log', (req, res) => {
    const pemain = pemainDariCookie(req);
    res.set('Cache-Control', 'no-store').json({ log: pemain && data.has(pemain) ? data.get(pemain).log : [] });
  });
  app.post('/api/reset', (req, res) => {
    const pemain = pemainDariCookie(req);
    if (pemain) data.delete(pemain);
    res.json({ ok: true });
  });

  // ---------- Laporan progres dari pemain ----------
  app.post('/api/progres', express.json({ limit: '2kb' }), (req, res) => {
    const pemain = pemainDariCookie(req);
    if (!pemain) return res.status(400).json({ error: 'cookie pemain tidak ada' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const sebelum = profil.get(pemain);
    if (!sebelum) batasi(profil);
    profil.set(pemain, {
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
    const ids = new Set([...profil.keys(), ...data.keys()]);
    const baris = [...ids].map((id) => {
      const d = data.get(id), pf = profil.get(id);
      const log = d ? d.log : [];
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
    res.set('Cache-Control', 'no-store').json({ sekarang, jumlahMisi: LEVELS.length, pemain: baris });
  });
  app.post('/api/admin/hapus', wajibAdmin, (req, res) => { data.clear(); profil.clear(); res.json({ ok: true }); });

  app.use(express.static(PUBLIC));
  // Body rusak atau terlalu besar: jawab 400/413 tanpa membocorkan jejak error.
  app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) return res.status(err.status || 400).json({ error: 'permintaan tidak valid' });
    next(err);
  });
  return app;
}

module.exports = { createGameApp };

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
