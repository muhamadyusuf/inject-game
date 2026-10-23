// Penyimpanan data pemain: log bukti request dan laporan progres.
//
//  - memori : Map biasa. Cocok untuk laptop/VPS (satu proses berjalan terus). Hilang saat restart.
//  - redis  : Redis lewat REST (Upstash / Vercel KV). Wajib di Vercel dan platform serverless lain,
//             karena tiap permintaan bisa dilayani instans berbeda dan memori tidak dibagi.
//
// Kedua implementasi memenuhi kontrak yang sama (diuji di test/store.test.js).

const MAKS_PEMAIN = 500;
const MAKS_LOG = 100;
const TTL_DETIK = 24 * 3600; // data redis kedaluwarsa sendiri: tidak menumpuk selamanya
const TTL_NONCE = 3600;

// ---------- memori ----------
function buatStoreMemori() {
  const log = new Map();    // pemain -> { entri: [], no: 0 }
  const nonce = new Map();  // pemain -> Set (sengaja TIDAK dihapus saat reset, sama seperti redis)
  const profil = new Map(); // pemain -> laporan progres
  const batasi = (m) => { if (m.size >= MAKS_PEMAIN) m.delete(m.keys().next().value); };

  return {
    mode: 'memori',
    async catat(pemain, data, nonceBaru) {
      if (!log.has(pemain)) { batasi(log); log.set(pemain, { entri: [], no: 0 }); }
      const d = log.get(pemain);
      let via = 'burp';
      if (nonceBaru) {
        if (!nonce.has(pemain)) nonce.set(pemain, new Set());
        const n = nonce.get(pemain);
        if (!n.has(nonceBaru)) {
          via = 'game';
          if (n.size >= 200) n.delete(n.values().next().value);
          n.add(nonceBaru);
        }
      }
      const entri = { no: ++d.no, ...data, via, t: Date.now() };
      d.entri.push(entri);
      if (d.entri.length > MAKS_LOG) d.entri.shift();
      return entri;
    },
    async log(pemain) { return log.has(pemain) ? [...log.get(pemain).entri] : []; },
    async reset(pemain) { log.delete(pemain); },
    async profil(pemain) { return profil.get(pemain) || null; },
    async simpanProfil(pemain, p) { if (!profil.has(pemain)) batasi(profil); profil.set(pemain, p); },
    async semua() {
      const ids = new Set([...profil.keys(), ...log.keys()]);
      return [...ids].map((id) => ({ id, profil: profil.get(id) || null, log: log.has(id) ? [...log.get(id).entri] : [] }));
    },
    async hapusSemua() { log.clear(); profil.clear(); nonce.clear(); },
  };
}

// ---------- redis (REST, format pipeline Upstash) ----------
function klienRedis(url, token, fetchImpl = fetch) {
  const endpoint = String(url).replace(/\/+$/, '') + '/pipeline';
  return async function pipeline(perintah) {
    if (!perintah.length) return [];
    const r = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(perintah),
    });
    if (!r.ok) throw new Error(`penyimpanan redis menjawab ${r.status}`);
    const hasil = await r.json();
    return hasil.map((x) => { if (x && x.error) throw new Error('redis: ' + x.error); return x ? x.result : null; });
  };
}

function buatStoreRedis(url, token, fetchImpl) {
  const redis = klienRedis(url, token, fetchImpl);
  const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const kL = (p) => `pp:l:${p}`, kC = (p) => `pp:c:${p}`, kP = (p) => `pp:p:${p}`, kN = (p, n) => `pp:n:${p}:${n}`;
  const PEMAIN = 'pp:pemain';

  return {
    mode: 'redis',
    async catat(pemain, data, nonceBaru) {
      // Putaran 1: apakah nonce baru (SET NX), nomor urut, dan tandai pemain aktif.
      const awal = [['INCR', kC(pemain)], ['ZADD', PEMAIN, String(Date.now()), pemain]];
      if (nonceBaru) awal.unshift(['SET', kN(pemain, nonceBaru), '1', 'NX', 'EX', String(TTL_NONCE)]);
      const h = await redis(awal);
      const via = nonceBaru && h[0] === 'OK' ? 'game' : 'burp';
      const no = Number(h[nonceBaru ? 1 : 0]);
      const entri = { no, ...data, via, t: Date.now() };
      // Putaran 2: simpan entri, batasi panjang log dan jumlah pemain, atur kedaluwarsa.
      await redis([
        ['RPUSH', kL(pemain), JSON.stringify(entri)], ['LTRIM', kL(pemain), String(-MAKS_LOG), '-1'],
        ['EXPIRE', kL(pemain), String(TTL_DETIK)], ['EXPIRE', kC(pemain), String(TTL_DETIK)],
        ['ZREMRANGEBYRANK', PEMAIN, '0', String(-(MAKS_PEMAIN + 1))],
      ]);
      return entri;
    },
    async log(pemain) {
      const [baris] = await redis([['LRANGE', kL(pemain), '0', '-1']]);
      return (baris || []).map(parse).filter(Boolean);
    },
    async reset(pemain) { await redis([['DEL', kL(pemain), kC(pemain)]]); },
    async profil(pemain) { const [p] = await redis([['GET', kP(pemain)]]); return p ? parse(p) : null; },
    async simpanProfil(pemain, p) {
      await redis([['SET', kP(pemain), JSON.stringify(p), 'EX', String(TTL_DETIK)], ['ZADD', PEMAIN, String(Date.now()), pemain],
        ['ZREMRANGEBYRANK', PEMAIN, '0', String(-(MAKS_PEMAIN + 1))]]);
    },
    async semua() {
      const [ids] = await redis([['ZRANGE', PEMAIN, '0', '-1']]);
      if (!ids || !ids.length) return [];
      // MGET: satu perintah untuk semua profil (hemat kuota perintah), lalu satu LRANGE per pemain.
      const h = await redis([['MGET', ...ids.map(kP)], ...ids.map((id) => ['LRANGE', kL(id), '0', '-1'])]);
      const profilMentah = h[0] || [];
      return ids.map((id, i) => ({
        id, profil: profilMentah[i] ? parse(profilMentah[i]) : null, log: (h[i + 1] || []).map(parse).filter(Boolean),
      }));
    },
    async hapusSemua() {
      const [ids] = await redis([['ZRANGE', PEMAIN, '0', '-1']]);
      const kunci = (ids || []).flatMap((id) => [kL(id), kC(id), kP(id)]);
      if (kunci.length) await redis([['DEL', ...kunci]]);
      await redis([['DEL', PEMAIN]]);
    },
  };
}

// Pilih penyimpanan dari environment. Nama variabel Upstash maupun Vercel KV didukung.
function buatStore(env = process.env, fetchImpl) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return buatStoreRedis(url, token, fetchImpl);
  return buatStoreMemori();
}

module.exports = { buatStore, buatStoreMemori, buatStoreRedis, MAKS_PEMAIN, MAKS_LOG };
