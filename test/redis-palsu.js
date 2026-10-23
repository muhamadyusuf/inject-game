// Redis palsu minimal yang meniru format REST Upstash (POST /pipeline) untuk tes. Hanya perintah yang dipakai store.js.
const http = require('node:http');

// Semantik rentang Redis (LRANGE, LTRIM, ZRANGE, ZREMRANGEBYRANK): indeks negatif dihitung dari belakang;
// jika setelah dikonversi start > stop (mis. ZREMRANGEBYRANK 0 -501 pada set kecil), hasilnya kosong.
function potong(arr, a, b) {
  const n = arr.length;
  let s = a < 0 ? n + a : a;
  let e = b < 0 ? n + b : b;
  if (s < 0) s = 0;
  if (e >= n) e = n - 1;
  if (s > e || s >= n) return [];
  return arr.slice(s, e + 1);
}

async function buatRedisPalsu(token = 'token-uji') {
  const kv = new Map(), daftar = new Map(), zset = new Map(), ttl = new Map();
  const statistik = { permintaan: 0, perintah: 0, tanpaAuth: 0 };
  const urut = (z) => [...z.entries()].sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1)).map(([m]) => m);
  const cmd = {
    SET(k, v, ...opt) {
      if (opt.includes('NX') && kv.has(k)) return null;
      kv.set(k, String(v));
      const i = opt.indexOf('EX'); if (i >= 0) ttl.set(k, Number(opt[i + 1]));
      return 'OK';
    },
    GET: (k) => (kv.has(k) ? kv.get(k) : null),
    MGET: (...ks) => ks.map((k) => (kv.has(k) ? kv.get(k) : null)),
    INCR(k) { const n = Number(kv.get(k) || 0) + 1; kv.set(k, String(n)); return n; },
    RPUSH(k, ...v) { const l = daftar.get(k) || []; l.push(...v.map(String)); daftar.set(k, l); return l.length; },
    LTRIM(k, a, b) { daftar.set(k, potong(daftar.get(k) || [], Number(a), Number(b))); return 'OK'; },
    LRANGE: (k, a, b) => potong(daftar.get(k) || [], Number(a), Number(b)),
    EXPIRE(k, n) { ttl.set(k, Number(n)); return 1; },
    ZADD(k, skor, m) { const z = zset.get(k) || new Map(); const baru = !z.has(m); z.set(m, Number(skor)); zset.set(k, z); return baru ? 1 : 0; },
    ZRANGE: (k, a, b) => potong(urut(zset.get(k) || new Map()), Number(a), Number(b)),
    ZREMRANGEBYRANK(k, a, b) { const z = zset.get(k); if (!z) return 0; const hapus = potong(urut(z), Number(a), Number(b)); hapus.forEach((m) => z.delete(m)); return hapus.length; },
    DEL(...ks) { let n = 0; for (const k of ks) { n += (kv.delete(k) | daftar.delete(k) | zset.delete(k)) ? 1 : 0; } return n; },
  };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      statistik.permintaan++;
      if (req.headers.authorization !== `Bearer ${token}`) { statistik.tanpaAuth++; res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
      if (req.method !== 'POST' || req.url !== '/pipeline') { res.writeHead(404); return res.end('{}'); }
      const hasil = JSON.parse(b).map(([nama, ...arg]) => {
        statistik.perintah++;
        const f = cmd[String(nama).toUpperCase()];
        if (!f) return { error: 'ERR unknown command ' + nama };
        try { return { result: f(...arg) }; } catch (e) { return { error: String(e.message) }; }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(hasil));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, token, statistik, ttl, kv, daftar, zset, tutup: () => srv.close() };
}
module.exports = { buatRedisPalsu };
