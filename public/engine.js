// Mesin game murni (tanpa DOM, tanpa jaringan): state, penilaian misi, dan HP.
// Bukti misi datang dari log server (s.log), bukan dari klaim pemain.
import { LEVELS, HP_MUSUH, DMG_PER_MISI, DMG_BIASA } from './missions.js';

export const HP_PEMAIN = 100;
export const DMG_SALAH = 10; // jawaban salah: monster membalas

export const buatState = (pemain) => ({
  pemain,
  log: [], jawab: {}, hpPemain: HP_PEMAIN,
  responsTerakhir: null, kodeOpsi: [], kodeBenar: -1,
  dinilaiNo: 0, // log dengan no <= ini sudah diperiksa untuk hukuman kirim salah
});

// Request dasar tombol SERANG (selalu sama). Semua perubahan (kategori, kutip, cookie, jalur
// rentan/aman) dilakukan pemain di Burp, bukan di game.
export const buatPermintaan = () => ({ path: '/pasar/rentan/item?kategori=Pedang', skin: 'cerah' });

export const terapkanLog = (s, entries) => { s.log = Array.isArray(entries) ? entries : []; return s; };

// Dipanggil setelah respons SERANG: simpan teks respons dan siapkan pilihan kode bukti
// (satu asli, dua pengecoh) yang hanya bisa dibedakan dengan melihat respons di Burp.
export function catatRespons(s, { status, kode, teks }, acak = Math.random) {
  s.responsTerakhir = { status, kode, teks };
  // Dua kode pengecoh yang pasti berbeda satu sama lain dan dari kode asli (selalu berakhir).
  const hex = (n) => (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  let n = Math.floor(acak() * 0xffff);
  const pengecoh = [];
  while (pengecoh.length < 2) {
    const k = hex(n++);
    if (k !== kode && !pengecoh.includes(k)) pengecoh.push(k);
  }
  const opsi = [...pengecoh];
  const pos = Math.min(2, Math.floor(acak() * 3));
  opsi.splice(pos, 0, kode);
  s.kodeOpsi = opsi; s.kodeBenar = pos;
  return s;
}

// Langkah yang sedang giliran: langkah pertama yang belum selesai dan sudah terbuka.
export const langkahSekarang = (s, misi) => misi.steps.find((st) => !stepSelesai(s, misi, st) && stepTerbuka(s, st)) || null;

// Hukuman kirim salah: tiap request BARU dari Burp yang tidak cocok dengan langkah aksi misi aktif
// mengurangi HP pemain (DMG_SALAH). Request dari tombol SERANG tidak pernah dihukum. Tanpa misi aktif,
// log hanya ditandai sudah diperiksa. Mengembalikan jumlah request salah dan apakah pemain pingsan.
export function periksaKirim(s, misi) {
  const maks = s.log.reduce((m, h) => Math.max(m, h.no), 0);
  if (maks < s.dinilaiNo) s.dinilaiNo = 0; // log server di-reset
  const baru = s.log.filter((h) => h.no > s.dinilaiNo);
  s.dinilaiNo = Math.max(s.dinilaiNo, maks);
  if (!misi) return { salah: 0, pingsan: false };
  const aksiMisi = misi.steps.filter((st) => st.tipe === 'aksi');
  let salah = 0, pingsan = false;
  for (const h of baru) {
    if (h.via !== 'burp') continue;
    if (aksiMisi.some((st) => st.selesai({ ...s, log: [h] }))) continue;
    salah++;
    if (kenaDamage(s).pingsan) pingsan = true;
  }
  return { salah, pingsan };
}

export const opsiStep = (s, st) => (typeof st.opsi === 'function' ? st.opsi(s) : st.opsi);
const idxBenar = (s, st) => (typeof st.benar === 'function' ? st.benar(s) : st.benar);

export const stepTerbuka = (s, step) => step.tipe === 'aksi' || step.syarat(s);
export const stepSelesai = (s, misi, step) => (step.tipe === 'aksi' ? step.selesai(s) : !!s.jawab[`${misi.id}${step.id}`]);
export const misiSelesai = (s, misi) => misi.steps.every((st) => stepSelesai(s, misi, st));

// Jawab pertanyaan pilihan ganda. Mengembalikan true jika benar.
export function jawabStep(s, misi, stepId, idx) {
  const step = misi.steps.find((x) => x.id === stepId);
  if (!step || step.tipe !== 'tanya' || !step.syarat(s)) return false;
  if (idx !== idxBenar(s, step)) return false;
  s.jawab[`${misi.id}${step.id}`] = true;
  return true;
}

// Jawaban salah membuat monster membalas. Pemain yang pingsan dipulihkan penuh (tidak ada game over).
export function kenaDamage(s, n = DMG_SALAH) {
  s.hpPemain = Math.max(0, s.hpPemain - n);
  const pingsan = s.hpPemain === 0;
  if (pingsan) s.hpPemain = HP_PEMAIN;
  return { pingsan };
}

// Kekuatan pemain: serangan biasa tetap, serangan bukti = bukti sah per misi.
export const kekuatan = (selesai) => ({ biasa: DMG_BIASA, bukti: DMG_PER_MISI, terkumpul: selesai.length });
export const hpMusuh = (selesai) => Math.max(0, HP_MUSUH - selesai.length * DMG_PER_MISI);
export { LEVELS, HP_MUSUH, DMG_PER_MISI };
