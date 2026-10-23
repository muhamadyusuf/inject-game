# Misi Pasar Pixel — Game Pendamping Workshop

Game bergaya blok untuk belajar Injection dengan **Burp Suite asli**, semuanya di **satu port (3003)**. Tombol **SERANG** mengirim request HTTP sungguhan ke server game ini, jadi Burp bisa menangkap, mengubah, dan mengulangnya di Repeater. Tidak ada kolom isian: aksi lewat tombol dan Burp, pemahaman lewat pilihan ganda.

**Penting tentang targetnya:** endpoint `/pasar/rentan/item` dan `/pasar/aman/item` hanya mengembalikan jawaban **diskripkan** dari `public/sim.js`. Tidak ada database, tidak ada query SQL sungguhan, tidak ada kode rentan; "kebocoran query" di versi rentan hanyalah teks yang dibangun untuk pembelajaran. Server mencatat request yang masuk (di memori, per pemain) sebagai **bukti misi**.

## Menjalankan

```bash
cd game
npm install
npm start
```

Buka `http://localhost:3003`. Dari PC lain di jaringan yang sama, pakai IP LAN yang dicetak saat start. Satu server cukup untuk seluruh kelas, karena progres tersimpan di browser masing-masing.

- **Mode Tamu** (default): isi nama, langsung main. Tanpa akun dan tanpa internet.
- **Login Google** (opsional): isi `public/firebase-config.js` dengan config web Firebase Anda (publik, bukan rahasia) dan aktifkan provider Google di Firebase Console. Firebase hanya dimuat saat tombolnya ditekan, jadi kegagalan Firebase tidak mengganggu mode Tamu.
- `auth/unauthorized-domain`: buka lewat `http://localhost:3003` (bukan `127.0.0.1`), atau tambahkan domain/IP (tanpa port) di Authentication, Settings, Authorized domains.

## Tampilan dan mekanisme

Layar tiga kolom, **arena di tengah** sebagai fokus:
- **Kiri (±15%):** menu misi, status, dan aksi (Serang Biasa, Reset, Keluar).
- **Tengah:** kotak game (karakter dan monster berdiri sejajar di panggung yang sama), lalu **panel input** di bawahnya.
- **Kanan (±23%):** panel **Misi** kecil (cerita, langkah, pertanyaan pilihan ganda, hint).

Kotak game:
- **Pemain:** HP 100 dan panel kekuatan (serangan biasa 10, serangan bukti 20 per misi, meter bukti). Jawaban salah membuat monster membalas (-10 HP). HP habis berarti dipulihkan penuh, tanpa game over.
- **Senjata di bawah karakter:** satu tombol **SERANG!** yang mengirim request dasar nyata (`GET /pasar/rentan/item?kategori=Pedang`). Semua perubahan (kategori, kutip, cookie, jalur rentan/aman) dilakukan di Burp, bukan di game. Tiap SERANG memicu animasi karakter maju dan monster terkena (HIT atau ERR sesuai status respons).
- **Monster "Penjaga Gerbang Bot":** HP 100. Serangan biasa hanya MISS. Setiap misi terbukti memicu animasi dan -20 HP.

Panel input memuat respons terakhir dari server, **log bukti** yang dilihat server, dan panduan singkat memakai Burp.

## Alur permainan

0. **Kotak "👋 Cara bermain"** muncul otomatis di atas halaman login saat pertama kali game dibuka di sebuah browser (3 langkah: siapkan Burp, ikuti tanda 👉, kalahkan monster, termasuk alamat game yang sedang dipakai). Tutup dengan tombol, Esc, atau klik latar; setelah itu tidak muncul lagi di browser itu. Tombol **❓ Cara bermain** di halaman login dan di menu kiri membukanya lagi kapan saja.
1. **Masuk** (Tamu atau Google). Misi pertama yang belum selesai langsung terbuka.
2. Tiap misi punya **tujuan** satu kalimat dan daftar langkah. Langkah yang sedang giliran ditandai **👉** dan menampilkan petunjuk konkret (mis. "klik kanan request, Send to Repeater, ubah kategori=Pedang menjadi kategori=Perisai, klik Send"). Pilihan jawaban hanya muncul untuk langkah sekarang, jadi layar tidak penuh.
3. Setelah semua langkah selesai: animasi serangan, monster -20 HP, lalu **otomatis lanjut** ke misi berikutnya. Setelah misi terakhir, monster tumbang.

## HP pemain

HP pemain berkurang **10** pada setiap:
- **Jawaban pilihan ganda yang salah.**
- **Request dari Burp yang tidak cocok dengan misi aktif** (mis. mengirim kutip saat Misi 2 meminta kategori Perisai). Pesan merahnya menyebut langkah yang sebenarnya diminta.

Request dari tombol SERANG tidak pernah dihukum, request dari Burp yang cocok langkah misi tidak dihukum, dan tiap request hanya dinilai sekali. Request yang sudah ada sebelum masuk atau sebelum misi dibuka tidak dihukum. HP habis berarti pemain dipulihkan penuh (tidak ada game over).

## Dasbor admin (memantau progres pemain)

Buka `http://localhost:3003/admin.html` (dari PC lain: `http://IP-LAPTOP-ANDA:3003/admin.html`; saat di-hosting: `https://domain-anda/admin.html`). Halaman ini dilindungi **kunci admin yang selalu sama**, dengan urutan prioritas:

1. **Variabel `ADMIN_KEY`**: lewat environment hosting, atau lewat file **`.env`** saat lokal (salin `.env.example` menjadi `.env`; `npm start` membacanya otomatis). Kunci tidak dicetak di log. Pakai minimal 8 karakter (server memberi peringatan jika lebih pendek). Nilai contoh dari `.env.example` ditolak karena bersifat publik.
2. **File `.admin-key`**: dibuat otomatis saat server pertama kali dijalankan, lalu dipakai terus setelah restart. Kuncinya dicetak di terminal.
3. **Acak per proses**: hanya cadangan jika file tidak bisa ditulis. Kunci berubah tiap restart, dan server memberi tahu lewat terminal.

**`.env` atau `.admin-key`?** Keamanannya sama: keduanya file teks biasa. Yang penting: (a) file tidak ikut ke git (keduanya sudah di `.gitignore`), (b) izin file hanya untuk pemilik (`.admin-key` dibuat dengan izin itu otomatis; untuk `.env` jalankan `chmod 600 .env`), dan (c) tidak bisa diunduh lewat web. Poin (c) sudah dijaga: server hanya menyajikan folder `public/`, dan ada tes yang memastikan `/.env`, `/.admin-key`, `/server.js`, serta trik `../` tidak mengembalikan isinya. Untuk **hosting**, jangan unggah file `.env`: isi `ADMIN_KEY` lewat pengaturan variabel environment hosting (menu "Environment" atau "Secrets").

```
Dasbor admin     : /admin.html   Kunci: 59b5c006f917ed42   (tersimpan tetap di .admin-key)
```

Dasbor memperbarui diri tiap 2 detik dan menampilkan, per pemain: status online (aktif dalam 15 detik), misi aktif, progres 5 misi, HP pemain dan HP monster, jumlah request dari tombol SERANG dan dari Burp, jumlah salah jawab dan salah kirim, serta waktu terakhir aktif. Ada ringkasan (jumlah pemain, online, selesai semua, rata-rata misi), pencarian nama, filter "hanya yang online", **ekspor CSV**, dan tombol hapus semua data.

**Dua sumber data, ditandai terpisah:**
- **Laporan pemain sendiri** (progres, HP, jumlah salah): dikirim halaman game tiap 2 detik. Bisa dipalsukan oleh pemain yang paham, jadi perlakukan sebagai indikasi.
- **Dicatat server sendiri** (jumlah request game vs Burp, dan bukti aksi per misi): tidak bisa dipalsukan lewat laporan. Kotak progres menandai:
  - ✓ selesai dan terbukti di log server,
  - 🔎 aksi di Burp terbukti tetapi misi belum selesai (pemain mungkin tersangkut di pertanyaan),
  - ⚠ dilaporkan selesai tetapi tidak ada bukti di log server (log di-reset atau server restart, atau laporan dipalsukan).

Keamanan: kunci dibandingkan dengan perbandingan waktu-konstan, sesi admin memakai cookie HttpOnly SameSite=Strict, percobaan login salah dibatasi (10 per menit per alamat), nama pemain dibersihkan di server dan di-escape di halaman, dan sel CSV yang diawali `=`, `+`, `-`, atau `@` diberi tanda kutip agar tidak dibaca sebagai rumus. Karena memakai HTTP biasa di jaringan lokal, kunci tidak terenkripsi saat dikirim: jaga kerahasiaan kunci dan gunakan jaringan kelas yang dipercaya. Semua data hanya di memori server dan hilang saat server restart; halaman admin tidak ditautkan dari game.

## Hosting (agar tidak membebani laptop)

Game ini adalah **server Node yang berjalan terus** dengan data di memori, jadi cocok di Render, Railway, Fly.io, VPS, atau sejenisnya. **Tidak cocok di Vercel atau platform serverless lain**: tiap permintaan bisa dilayani instans berbeda, sehingga log bukti dan progres pemain tidak konsisten.

Pengaturan:

| Variabel | Isi |
|---|---|
| `ADMIN_KEY` | Kunci admin yang tetap. **Wajib diset di hosting**, karena disk hosting sering bersifat sementara sehingga `.admin-key` bisa hilang. |
| `PORT` | Biasanya diberikan oleh hosting. Bawaan 3003. |
| `TRUST_PROXY` | `1` jika di belakang proxy HTTPS hosting (hampir semua). Membuat cookie admin bertanda `Secure` dan batas login dihitung per alamat asli pengunjung. |

Perintah start: `npm install` lalu `npm run game` (atau `node server.js`), Node 24 atau lebih baru. Gunakan **satu instans saja** (jangan di-scale ke beberapa replika).

Hal yang perlu diperhatikan:
- **HTTPS** disediakan oleh hosting. Setelah di HTTPS, kunci admin tidak lagi terkirim sebagai teks biasa.
- **Login Google:** tambahkan domain hosting (tanpa `https://`) di Firebase Console, Authentication, Settings, Authorized domains. Mode Tamu tidak butuh langkah ini.
- **Data hilang saat restart.** Banyak paket gratis menidurkan atau me-restart server. Progres pemain tetap tersimpan di browser masing-masing dan dilaporkan ulang ke server, tetapi log bukti Burp hilang, sehingga dasbor menandai ⚠ (selesai tanpa bukti di log). Untuk sesi kelas, pastikan server tetap aktif (paket yang tidak tidur) selama workshop.
- **Burp memakai alamat hosting:** peserta membuka alamat hosting di browser Burp. Panduan di panel input menampilkan alamat yang sedang dipakai secara otomatis.
- **Target Pasar Pixel jadi publik.** Endpoint `/pasar/...` hanya memberi jawaban diskripkan (tanpa database dan tanpa kode rentan), tetapi siapa pun yang tahu alamatnya bisa membukanya dan memenuhi memori server dengan data pemain palsu. Server membatasi 500 pemain, 100 request per pemain, dan kategori 100 karakter. Jangan sebarkan alamat di luar peserta.

## Cara bukti diverifikasi

Tombol SERANG menambahkan header `X-Aksi` berisi nonce unik. Server memberi label tiap request:
- `🎮 game`: nonce baru, berarti dari tombol SERANG.
- `🔎 burp`: nonce dipakai ulang (diulang di Repeater) atau tidak ada (diketik dari nol di Burp).

Langkah aksi misi hanya dihitung dari request berlabel **burp**, jadi menekan SERANG saja tidak menyelesaikan misi 2 sampai 5. Misi 1 cukup SERANG, lalu menanyakan hal yang hanya terlihat di Burp: header `X-Kode-Bukti` (tiga pilihan, satu asli). Halaman memeriksa log server setiap 2 detik.

Identitas pemain adalah cookie `pemain` yang dipasang halaman. Burp browser membawanya otomatis setelah pemain masuk di browser Burp.

| Misi | Tahap | Yang dilakukan di Burp | Pertanyaan pilihan ganda |
|---|---|---|---|
| 1. Pengintaian | OBSERVE | SERANG di browser Burp, baca History | Method, nama parameter, kode X-Kode-Bukti |
| 2. Manipulasi Parameter | INTERCEPT | Repeater: kategori Perisai dan Ramuan | Jumlah item Ramuan |
| 3. Senjata Kritis | INVESTIGATE | Repeater: kategori satu kutip (%27) di jalur /pasar/rentan | Status code, apa yang bocor |
| 4. Jejak Tersembunyi | OBSERVE (cookie) | Repeater: ubah cookie skin menjadi gelap | Siapa bisa mengubah cookie, amankah untuk hak admin |
| 5. Perbaikan & Verifikasi | FIX, VERIFY | Repeater: ubah jalur menjadi /pasar/aman, kutip yang sama | Hasil di versi aman, mengapa tidak terpengaruh |

## Batas yang disengaja

- Respons skrip hanya menunjukkan **satu** gejala: input yang ditempel ke teks query merusak perintah (status 500 dan query bocor). Tidak ada jalur yang menampilkan item beta; ini diuji otomatis.
- Tidak ada string serangan. "Kutip" hanyalah satu kartu input.
- Cookie `skin` hanya tampilan, tanpa nilai keamanan.
- Game ini bukan penilai resmi. Verifikasi akhir tetap oleh instruktur.
- Verifikasi memakai log server di memori: hilang saat server restart, dan tidak menjamin pemain memakai Burp (hanya bahwa request diulang atau diubah di luar tombol SERANG). Verifikasi akhir tetap oleh instruktur.
- Lab Kantin Digital di folder `kantin-digital` (port 3001/3002) tetap tersedia untuk praktik dengan lembar kerja FASE 2.

## Struktur

| File | Fungsi |
|---|---|
| `public/sim.js` | Data toko dan jawaban skrip (rentan dan aman) |
| `public/missions.js` | 5 misi, langkah aksi dan pertanyaan |
| `public/engine.js` | State dan aksi tombol, penilaian misi (tanpa DOM, mudah diuji) |
| `public/app.js` | UI, login Tamu/Google, penyimpanan progres per pemain |
| `public/style.css`, `index.html` | Tampilan |
| `server.js` | Satu port: halaman, endpoint `/pasar/:versi/item`, log bukti, laporan progres, API admin |
| `public/admin.html`, `public/admin.js` | Dasbor admin |
| `start.js` | Menjalankan server dan mencetak alamat untuk peserta |

## Tes

```bash
npm test
```

19 tes: jawaban skrip (jumlah item, kebocoran hanya di versi rentan, item beta tidak pernah tampil), mesin (bukti dari log, langkah tidak bisa dilompati, jalur rentan dan aman tidak bisa tertukar, request dari tombol SERANG tidak menyelesaikan misi), HP, hukuman kirim salah (dihitung sekali, tidak berulang saat server di-reset), petunjuk tiap langkah, dasbor admin (login, validasi laporan, penggabungan bukti log, pembatasan percobaan), kunci admin yang stabil (file, env, cadangan acak), perilaku di balik proxy HTTPS, file rahasia tidak bisa diunduh lewat web, kotak Cara bermain, serta server (endpoint, pencatatan bukti per pemain, pembeda game dan Burp, batas input, satu kolom isian). Alur UI penuh dimainkan di Chrome headless dengan request HTTP nyata sebagai pengganti Repeater, tanpa error konsol.
