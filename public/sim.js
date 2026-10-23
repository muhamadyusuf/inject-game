// Simulasi "Pasar Pixel": toko item di dunia game. Seluruhnya berjalan di dalam halaman,
// tidak ada server rentan sungguhan. Versi rentan hanya menunjukkan SATU hal:
// input yang ditempel ke teks query bisa merusak perintah (galat + query bocor).
export const KATEGORI = ['Pedang', 'Perisai', 'Ramuan'];

export const ITEM = [
  { id: 1, nama: 'Pedang Kayu', kategori: 'Pedang', harga: 100, rilis: true },
  { id: 2, nama: 'Pedang Besi', kategori: 'Pedang', harga: 250, rilis: true },
  { id: 3, nama: 'Perisai Kayu', kategori: 'Perisai', harga: 120, rilis: true },
  { id: 4, nama: 'Perisai Baja', kategori: 'Perisai', harga: 300, rilis: true },
  { id: 5, nama: 'Ramuan Biru', kategori: 'Ramuan', harga: 50, rilis: true },
  { id: 6, nama: 'Ramuan Merah', kategori: 'Ramuan', harga: 50, rilis: true },
  { id: 7, nama: 'Ramuan Hijau', kategori: 'Ramuan', harga: 60, rilis: true },
  { id: 8, nama: 'Pedang Naga (Beta)', kategori: 'Pedang', harga: 9999, rilis: false },
  { id: 9, nama: 'Perisai Rahasia (Beta)', kategori: 'Perisai', harga: 9999, rilis: false },
];

const kutipGanjil = (s) => (String(s).match(/'/g) || []).length % 2 === 1;
const urlEnc = (s) => encodeURIComponent(s).replace(/'/g, '%27');

export function buatRequest({ kategori, cookieSkin, pemain }) {
  return { metode: 'GET', path: '/item', kategori, cookieSkin, pemain };
}

// Server simulasi. versi: 'rentan' (menempel teks) atau 'aman' (parameter terpisah).
export function tanggapi(req, versi) {
  if (versi === 'rentan') {
    const query = `SELECT nama, harga FROM item WHERE kategori = '${req.kategori}' AND rilis = true`;
    if (kutipGanjil(req.kategori)) {
      return { status: 500, teks: 'Internal Server Error', jumlah: null, daftar: [], query,
        badan: `Database error: unterminated quoted string\nQuery: ${query}` };
    }
    return hasil(req, query);
  }
  return hasil(req, null);
}

function hasil(req, query) {
  const daftar = ITEM.filter((i) => i.rilis && i.kategori === req.kategori);
  return { status: 200, teks: 'OK', jumlah: daftar.length, daftar, query,
    badan: `Kategori: ${req.kategori}\n` + daftar.map((i) => `- ${i.nama} (${i.harga} koin)`).join('\n')
      + `\nJumlah item: ${daftar.length}` };
}

export function mentahRequest(req) {
  return `${req.metode} ${req.path}?kategori=${urlEnc(req.kategori)} HTTP/1.1\n`
    + `Host: pasar.pixel\nX-Kode-Pemain: ${req.pemain}\nCookie: skin=${req.cookieSkin}\nAccept: text/html`;
}

export function mentahRespons(res, { setCookie = null, skin = 'cerah' } = {}) {
  return `HTTP/1.1 ${res.status} ${res.teks}\nContent-Type: text/html${setCookie ? `\nSet-Cookie: skin=${setCookie}; Path=/` : ''}\nX-Skin-Aktif: ${skin}\n\n${res.badan}`;
}
