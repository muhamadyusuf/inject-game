// Dasbor admin: memantau progres pemain secara langsung (polling tiap 2 detik).
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let timer = null;
let terakhirData = null;

const tampil = (v) => { $('v-login').classList.toggle('hidden', v !== 'login'); $('v-dash').classList.toggle('hidden', v !== 'dash'); };

function lalu(ms) {
  const d = Math.max(0, Math.round(ms / 1000));
  if (d < 5) return 'baru saja';
  if (d < 60) return d + ' dtk lalu';
  if (d < 3600) return Math.floor(d / 60) + ' mnt lalu';
  return Math.floor(d / 3600) + ' jam lalu';
}

function kotakProgres(p, n) {
  let h = '<span class="kotak">';
  for (let i = 0; i < n; i++) {
    const no = i + 1;
    const selesai = p.selesai.includes(no);
    const bukti = p.aksiTerbukti[i];
    let kelas = '', isi = '·', judul = `Misi ${no}: belum`;
    if (selesai && bukti) { kelas = 'ok'; isi = '✓'; judul = `Misi ${no}: selesai dan terbukti di log server`; }
    else if (selesai) { kelas = 'curiga'; isi = '⚠'; judul = `Misi ${no}: dilaporkan selesai, tetapi bukti tidak ada di log server`; }
    else if (bukti) { kelas = 'cek'; isi = '🔎'; judul = `Misi ${no}: aksi di Burp terbukti, belum selesai menjawab`; }
    if (p.misiAktif === no) kelas += ' aktif';
    h += `<b class="${kelas}" title="${esc(judul)}">${isi}</b>`;
  }
  return h + '</span>';
}
const bar = (nilai, kelas) => nilai === null ? '-' : `<span class="minibar ${kelas}"><i style="width:${nilai}%"></i></span> ${nilai}`;

function saring(d) {
  const q = $('cari').value.trim().toLowerCase();
  return d.pemain.filter((p) => (!q || p.nama.toLowerCase().includes(q) || p.id.includes(q)) && (!$('onlinesaja').checked || p.online));
}

function gambar(d) {
  terakhirData = d;
  const n = d.jumlahMisi;
  const semua = d.pemain;
  const online = semua.filter((p) => p.online).length;
  const tamat = semua.filter((p) => p.selesai.length === n).length;
  const rata = semua.length ? (semua.reduce((a, p) => a + p.selesai.length, 0) / semua.length).toFixed(1) : '0';
  const burp = semua.reduce((a, p) => a + p.reqBurp, 0);
  $('ringkas').innerHTML = [
    [semua.length, 'Pemain'], [online, 'Online (15 dtk)'], [tamat, `Selesai semua ${n} misi`], [rata, 'Rata-rata misi selesai'], [burp, 'Request dari Burp'],
  ].map(([a, b]) => `<div class="tile-a"><div class="n">${esc(a)}</div><div class="l">${esc(b)}</div></div>`).join('');

  const baris = saring(d);
  $('baris').innerHTML = baris.map((p) => `<tr class="${p.online ? '' : 'off'}">
    <td>${p.online ? '🟢 Online' : '⚪ Offline'}</td>
    <td><b>${esc(p.nama)}</b><div class="kecil">${esc(p.id)}</div></td>
    <td>${p.misiAktif ? 'Misi ' + p.misiAktif : (p.selesai.length === n ? '🏆 Tamat' : '-')}</td>
    <td>${kotakProgres(p, n)} <span class="kecil">${p.selesai.length}/${n}</span></td>
    <td>${bar(p.hpPemain, 'p')}<br>${bar(p.hpMusuh, 'm')}</td>
    <td>🎮 ${p.reqGame} · 🔎 ${p.reqBurp}</td>
    <td>${p.salahJawab} jawab · ${p.salahKirim} kirim</td>
    <td>${esc(lalu(d.sekarang - p.terakhir))}</td></tr>`).join('');
  $('kosong').classList.toggle('hidden', baris.length > 0);
  $('pembaruan').textContent = 'Diperbarui ' + new Date().toLocaleTimeString('id-ID');
  $('info-server').textContent = `${semua.length} pemain tercatat`;
}

async function muat() {
  try {
    const r = await fetch('/api/admin/pemain', { cache: 'no-store', credentials: 'same-origin' });
    if (r.status === 401) { berhenti(); tampil('login'); return; }
    gambar(await r.json());
  } catch { $('pembaruan').textContent = 'Server tidak terjangkau, mencoba lagi...'; }
}
function mulai() { tampil('dash'); muat(); clearInterval(timer); timer = setInterval(() => { if (!document.hidden) muat(); }, 2000); }
function berhenti() { clearInterval(timer); timer = null; }

$('btn-masuk').onclick = async () => {
  $('err').classList.add('hidden');
  const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ kunci: $('kunci').value.trim() }) });
  if (r.ok) { $('kunci').value = ''; mulai(); return; }
  const j = await r.json().catch(() => ({}));
  $('err').textContent = j.error || 'Gagal masuk';
  $('err').classList.remove('hidden');
};
$('kunci').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-masuk').click(); });
$('btn-keluar').onclick = async () => { await fetch('/api/admin/keluar', { method: 'POST', credentials: 'same-origin' }); berhenti(); tampil('login'); };
$('btn-hapus').onclick = async () => {
  if (!confirm('Hapus semua data pemain di server? Progres di browser pemain tidak ikut terhapus.')) return;
  await fetch('/api/admin/hapus', { method: 'POST', credentials: 'same-origin' });
  muat();
};
$('cari').addEventListener('input', () => terakhirData && gambar(terakhirData));
$('onlinesaja').addEventListener('change', () => terakhirData && gambar(terakhirData));

// Ekspor CSV: sel yang diawali = + - @ diberi tanda kutip agar tidak dibaca sebagai rumus di spreadsheet.
const sel = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
$('btn-csv').onclick = () => {
  if (!terakhirData) return;
  const kepala = ['nama', 'id', 'online', 'misi_aktif', 'misi_selesai', 'jumlah_selesai', 'hp_pemain', 'hp_monster', 'request_game', 'request_burp', 'salah_jawab', 'salah_kirim', 'bukti_log_per_misi'];
  const isi = terakhirData.pemain.map((p) => [p.nama, p.id, p.online ? 'ya' : 'tidak', p.misiAktif ?? '', p.selesai.join(' '), p.selesai.length, p.hpPemain ?? '', p.hpMusuh ?? '', p.reqGame, p.reqBurp, p.salahJawab, p.salahKirim, p.aksiTerbukti.map((b) => (b ? 1 : 0)).join('')].map(sel).join(','));
  const blob = new Blob(['﻿' + [kepala.join(','), ...isi].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'progres-pasar-pixel.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

(async () => {
  try { const r = await (await fetch('/api/admin/sesi', { cache: 'no-store', credentials: 'same-origin' })).json(); r.masuk ? mulai() : tampil('login'); }
  catch { tampil('login'); }
})();
