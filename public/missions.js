// 5 misi dengan Burp Suite ASLI. Bukti diverifikasi dari log server (request yang benar-benar masuk),
// bukan dari klaim pemain. "dariBurp" = request yang diulang atau diubah di luar tombol SERANG.
// Tidak ada string serangan; "kutip" hanyalah satu karakter yang diamati reaksinya.
export const HP_MUSUH = 100;
export const DMG_PER_MISI = 20;
export const DMG_BIASA = 10;

const dariBurp = (s, f) => s.log.some((h) => h.via === 'burp' && f(h));
// detail = petunjuk langkah demi langkah yang tampil hanya saat langkah itu giliran sekarang.
const aksi = (id, teks, selesai, detail) => ({ tipe: 'aksi', id, teks, selesai, detail });
const tanya = (id, teks, syarat, opsi, benar) => ({ tipe: 'tanya', id, teks, syarat, opsi, benar });

export const LEVELS = [
  { id: 1, judul: 'Pengintaian', tahap: 'OBSERVE',
    tujuan: 'Belajar membaca request di Burp. Kamu hanya mengamati, belum mengubah apa pun.',
    cerita: 'Penjaga Gerbang Bot menyembunyikan item beta. Kenali dulu cara toko ini bicara.',
    hint: 'Buka game ini di browser bawaan Burp, tekan SERANG, lalu cari request /pasar di tab HTTP history. Header X-Kode-Bukti ada di tab Response.',
    steps: [
      aksi('a', 'Tekan SERANG sekali dari browser Burp', (s) => s.log.length > 0,
        'Di Burp: tab Proxy, klik Open browser. Di browser itu buka alamat game ini, masuk dengan nama yang sama, lalu tekan tombol merah SERANG! di bawah karakter.'),
      tanya('b', 'Di Burp (HTTP history), apa method request itu?', (s) => s.log.length > 0, ['GET', 'POST', 'DELETE'], 0),
      tanya('c', 'Apa nama parameter yang dikirim di URL (setelah tanda ?)', (s) => s.log.length > 0, ['harga', 'kategori', 'token'], 1),
      { tipe: 'tanya', id: 'd', teks: 'Di tab Response Burp, berapa nilai header X-Kode-Bukti?',
        syarat: (s) => s.kodeOpsi.length > 0, opsi: (s) => s.kodeOpsi, benar: (s) => s.kodeBenar },
    ] },
  { id: 2, judul: 'Manipulasi Parameter', tahap: 'INTERCEPT',
    tujuan: 'Belajar mengulang request dan mengubah isinya di Repeater, tanpa mengklik ulang di game.',
    cerita: 'Mengklik ulang itu melelahkan. Kirim request ke Repeater, lalu ubah nilainya sesuka hati.',
    hint: 'Klik kanan request /pasar di HTTP history, pilih Send to Repeater. Ubah nilai kategori di URL, lalu klik Send.',
    steps: [
      aksi('a', 'Di Repeater, ubah kategori menjadi Perisai lalu Send', (s) => dariBurp(s, (h) => h.kategori === 'Perisai'),
        'HTTP history: klik kanan request /pasar, pilih Send to Repeater, buka tab Repeater. Di baris pertama ubah kategori=Pedang menjadi kategori=Perisai, lalu klik Send.'),
      aksi('b', 'Di Repeater, ubah kategori menjadi Ramuan lalu Send', (s) => dariBurp(s, (h) => h.kategori === 'Ramuan'),
        'Masih di Repeater: ubah kategori=Perisai menjadi kategori=Ramuan, lalu klik Send. Baca baris Jumlah item di respons.'),
      tanya('c', 'Berapa Jumlah item untuk kategori Ramuan?', (s) => dariBurp(s, (h) => h.kategori === 'Ramuan'), ['2', '3', '4'], 1),
    ] },
  { id: 3, judul: 'Senjata Kritis', tahap: 'INVESTIGATE',
    tujuan: 'Mengamati apa yang terjadi saat satu karakter aneh masuk ke input. Kamu hanya mengamati reaksinya.',
    cerita: 'Energi normal tidak melukai Penjaga. Tapi satu karakter aneh pada input bisa membuatnya tersedak.',
    hint: 'Di Repeater, ubah nilai kategori menjadi %27 (satu tanda kutip) pada jalur /pasar/rentan, lalu Send. Cari kata Query di respons.',
    steps: [
      aksi('a', 'Di Repeater, kirim kategori satu tanda kutip (%27) ke jalur /pasar/rentan', (s) => dariBurp(s, (h) => h.versi === 'rentan' && h.kategori === "'"),
        'Pastikan baris pertama berawalan GET /pasar/rentan/item. Ganti isi kategori menjadi %27 (itu satu tanda kutip yang ditulis aman di URL), klik Send, lalu baca respons.'),
      tanya('b', 'Status code apa yang muncul di respons?', (s) => dariBurp(s, (h) => h.versi === 'rentan' && h.kategori === "'"), ['200', '404', '500'], 2),
      tanya('c', 'Apa yang bocor di isi respons?', (s) => dariBurp(s, (h) => h.versi === 'rentan' && h.kategori === "'"), ['Teks query SQL', 'Password admin', 'Tidak ada'], 0),
    ] },
  { id: 4, judul: 'Jejak Tersembunyi', tahap: 'OBSERVE (header & cookie)',
    tujuan: 'Memahami bahwa cookie dan header juga input yang bisa dilihat dan diubah pengguna.',
    cerita: 'Penjaga menyimpan jejak di tempat yang tidak terlihat formulir: cookie dan header.',
    hint: 'Lihat header Cookie di request. Di Repeater, ubah skin=cerah menjadi skin=gelap, Send, lalu baca header X-Skin-Aktif di respons.',
    steps: [
      aksi('a', 'Di Repeater, ubah cookie skin menjadi gelap lalu Send', (s) => dariBurp(s, (h) => h.skin === 'gelap'),
        'Di request Repeater cari baris Cookie: ... skin=cerah. Ubah cerah menjadi gelap, klik Send, lalu lihat header X-Skin-Aktif di respons.'),
      tanya('b', 'Siapa yang bisa melihat dan mengubah cookie ini?', (s) => dariBurp(s, (h) => h.skin === 'gelap'), ['Hanya server', 'Pengguna (klien)', 'Hanya database'], 1),
      tanya('c', 'Amankah cookie ini dipakai untuk menentukan hak admin?', (s) => dariBurp(s, (h) => h.skin === 'gelap'), ['Aman', 'Tidak aman'], 1),
    ] },
  { id: 5, judul: 'Perbaikan & Verifikasi', tahap: 'FIX → VERIFY',
    tujuan: 'Membuktikan bahwa versi yang diperbaiki tidak terpengaruh oleh input yang sama.',
    cerita: 'Penjaga hampir tumbang. Pukulan terakhir adalah pemahaman: kenapa versi aman tidak bisa disakiti?',
    hint: 'Ulangi request kutip dari Misi 3 di Repeater, tapi ubah jalur /pasar/rentan menjadi /pasar/aman, lalu Send.',
    steps: [
      aksi('a', 'Di Repeater, ubah jalur menjadi /pasar/aman dan kirim kutip yang sama', (s) => dariBurp(s, (h) => h.versi === 'aman' && h.kategori === "'"),
        'Pakai request kutip dari Misi 3. Di baris pertama ganti kata rentan menjadi aman (kategori tetap %27), klik Send, lalu bandingkan dengan hasil Misi 3.'),
      tanya('b', 'Apa hasilnya di versi aman?', (s) => dariBurp(s, (h) => h.versi === 'aman' && h.kategori === "'"), ['Status 500 dan query bocor', 'Status 200, 0 item, tanpa kebocoran'], 1),
      tanya('c', 'Mengapa versi aman tidak terpengaruh?', (s) => dariBurp(s, (h) => h.versi === 'aman' && h.kategori === "'"),
        ['Kata kutip diblokir', 'Error hanya disembunyikan', 'Input dikirim sebagai parameter terpisah dari perintah'], 2),
    ] },
];
