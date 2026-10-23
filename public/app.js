// UI game "Misi Pasar Pixel". Semua interaksi lewat tombol; logika ada di engine.js.
import {
  buatState, buatPermintaan, terapkanLog, catatRespons, opsiStep,
  stepTerbuka, stepSelesai, misiSelesai, jawabStep, langkahSekarang, periksaKirim, hpMusuh, kenaDamage, kekuatan, HP_PEMAIN, LEVELS,
} from './engine.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const EMOJI = { Pedang: '⚔️', Perisai: '🛡️', Ramuan: '🧪' };
const PANGKAT = ['Pemula', 'Pengamat', 'Penyelidik', 'Analis', 'Penjaga Kode', 'Pahlawan Pasar'];

let user = null;       // { uid, displayName, photoURL }
let progres = { selesai: [], salahJawab: 0, salahKirim: 0 };
let s = null;          // state engine (di memori, mulai bersih tiap masuk)
let misiAktif = null;
let pesan = null;      // { tipe: 'ok'|'bad'|'info', teks }

// ---------- penyimpanan progres (per pemain, di browser ini) ----------
const kunci = (uid) => `pasar-pixel:${uid}`;
const PROGRES_AWAL = () => ({ selesai: [], salahJawab: 0, salahKirim: 0 });
const muatProgres = (uid) => { try { return { ...PROGRES_AWAL(), ...(JSON.parse(localStorage.getItem(kunci(uid))) || {}) }; } catch { return PROGRES_AWAL(); } };
const simpanProgres = () => { try { localStorage.setItem(kunci(user.uid), JSON.stringify(progres)); } catch {} };

// ---------- render ----------
function renderHero() {
  const n = progres.selesai.length;
  const hp = hpMusuh(progres.selesai);
  const k = kekuatan(progres.selesai);
  $('hp-fill').style.width = hp + '%';
  $('hp-text').textContent = `${hp} / 100 HP`;
  $('p-name').textContent = '🧑 ' + user.displayName;
  $('p-hp-fill').style.width = (s.hpPemain / HP_PEMAIN * 100) + '%';
  $('p-hp-text').textContent = `${s.hpPemain} / ${HP_PEMAIN}`;
  $('p-power').innerHTML = `⚡ Serangan biasa: <b>${k.biasa}</b> (tidak cukup)<br>💥 Serangan bukti: <b>${k.bukti}</b> per misi<br>`
    + `🔥 Bukti: <b>${k.terkumpul}/${LEVELS.length}</b> <span class="pbar"><i style="width:${k.terkumpul / LEVELS.length * 100}%"></i></span>`;
  $('monster').classList.toggle('kalah', hp === 0);
  $('victory').classList.toggle('hidden', hp > 0);
  $('stat-xp').textContent = '⭐ XP: ' + n * 100;
  $('stat-misi').textContent = `🎯 ${n} / ${LEVELS.length}`;
  $('stat-pangkat').textContent = '🏅 ' + PANGKAT[n];
}

// Animasi blok: kelas dipasang ulang agar bisa diputar berkali-kali.
function animasi(id, kelas, ms = 650) {
  const el = $(id);
  if (!el) return;
  el.classList.remove(kelas); void el.offsetWidth; el.classList.add(kelas);
  setTimeout(() => el.classList.remove(kelas), ms);
}
function pop(id, teks) {
  const el = $(id);
  el.textContent = teks; el.classList.remove('tampil'); void el.offsetWidth; el.classList.add('tampil');
}

function renderPeta() {
  const list = $('level-list');
  list.innerHTML = '';
  LEVELS.forEach((lvl, i) => {
    const done = progres.selesai.includes(lvl.id);
    const locked = !done && i > 0 && !progres.selesai.includes(LEVELS[i - 1].id);
    const div = document.createElement('div');
    div.className = 'level-item ' + (done ? 'done' : locked ? 'locked' : '');
    div.title = `${lvl.judul} (${lvl.tahap})`;
    div.innerHTML = `<span class="ico">${done ? '✅' : locked ? '🔒' : '⚔️'}</span>`
      + `<span class="lbl">${lvl.id}. ${esc(lvl.judul)}</span>`;
    if (!locked) { div.dataset.act = 'buka-misi'; div.dataset.id = lvl.id; }
    list.appendChild(div);
  });
}

function htmlStep(misi, st, now) {
  const selesai = stepSelesai(s, misi, st);
  const buka = stepTerbuka(s, st);
  const giliran = now && now.id === st.id;
  const ikon = selesai ? '✅' : giliran ? '👉' : buka ? '⬜' : '🔒';
  let isi = `<div class="t">${ikon} ${esc(st.teks)}</div>`;
  if (giliran && st.tipe === 'aksi' && st.detail) isi += `<div class="detail">${esc(st.detail)}</div>`;
  if (giliran && st.tipe === 'tanya') {
    isi += `<div class="opsi">${opsiStep(s, st).map((o, i) => `<button class="btn sm blue" data-act="jawab" data-step="${st.id}" data-idx="${i}">${esc(o)}</button>`).join('')}</div>`;
  }
  if (!selesai && !buka) isi += '<div class="kecil">Terbuka setelah langkah sebelumnya selesai.</div>';
  return `<li class="step ${selesai ? 'done' : ''} ${giliran ? 'now' : ''}">${isi}</li>`;
}

function htmlInput() {
  const resp = s.responsTerakhir;
  const rawRes = resp ? `HTTP ${resp.status}\n\n${resp.teks}` : '(tekan SERANG di bawah karakter)';
  const baris = s.log.length
    ? [...s.log].reverse().map((h) => `<div class="hrow" title="${h.via === 'burp' ? 'Diulang atau diubah lewat Burp' : 'Dikirim tombol SERANG'}">#${h.no} ${h.via === 'burp' ? '🔎 BURP' : '🎮 GAME'} /${esc(h.versi)} kategori=${esc(h.kategori === "'" ? "%27" : h.kategori)} skin=${esc(h.skin)} → ${h.status}</div>`).join('')
    : '<span class="kecil">Belum ada request. Tekan SERANG.</span>';
  return `<div class="arena">
    <div class="panel">
      <h3>📥 Respons terakhir (nyata dari server)</h3>
      <pre class="raw" id="raw-res">${esc(rawRes)}</pre>
      <div class="kecil">Header seperti X-Kode-Bukti dan X-Skin-Aktif hanya terlihat di tab Response Burp.</div>
    </div>
    <div class="panel">
      <h3>📜 Bukti yang dilihat server</h3>
      <div class="hist" id="log-bukti">${baris}</div>
      <div class="kecil">🎮 = dikirim tombol SERANG. 🔎 = diulang atau diubah lewat Burp (ini yang dihitung untuk misi).</div>
    </div>
  </div>
  <div class="panel" style="margin-top:14px">
    <h3>🔎 Cara memakai Burp Suite</h3>
    <ol class="kecil" style="line-height:1.7;font-size:13px">
      <li>Buka Burp Suite, tab <b>Proxy</b>, klik <b>Open browser</b>.</li>
      <li>Di browser Burp, buka <span class="mono">${esc(location.origin)}</span>, masuk, lalu tekan <b>SERANG</b>.</li>
      <li>Di <b>HTTP history</b>, cari request <span class="mono">GET /pasar/...</span>, klik kanan, <b>Send to Repeater</b>.</li>
      <li>Di <b>Repeater</b>, ubah bagian yang diminta misi lalu <b>Send</b>. Server mencatatnya dan langkah misi terverifikasi otomatis.</li>
    </ol>
  </div>`;
}

function renderMisi() {
  const area = $('misi-area');
  $('input-area').innerHTML = `<div class="card" id="arena-card"><h2>🎮 PANEL INPUT</h2>${htmlInput()}</div>`;
  if (misiAktif === null) {
    const semua = progres.selesai.length === LEVELS.length;
    area.innerHTML = `<div class="card"><div class="misi-kosong">${semua ? '🏆 Semua misi selesai!' : 'Pilih misi di menu kiri untuk mulai.'}</div></div>`;
    return;
  }
  const misi = LEVELS.find((l) => l.id === misiAktif);
  const now = langkahSekarang(s, misi);
  const done = misi.steps.filter((st) => stepSelesai(s, misi, st)).length;
  area.innerHTML = `<div class="card" id="level-detail">
    <h2>Misi ${misi.id}: ${esc(misi.judul)}</h2>
    <span class="pill">${esc(misi.tahap)}</span> <span class="kecil">Langkah ${done}/${misi.steps.length}</span>
    <p class="sub tujuan">🎯 ${esc(misi.tujuan)}</p>
    <ol class="steps">${misi.steps.map((st) => htmlStep(misi, st, now)).join('')}</ol>
    <div class="row">
      <button class="btn sm secondary" data-act="hint">💡 Hint</button>
      <button class="btn sm secondary" data-act="tutup">Tutup</button>
    </div>
    <div id="lvl-feedback">${pesan ? `<div class="feedback ${pesan.tipe}">${esc(pesan.teks)}</div>` : ''}</div>
  </div>`;
}

function renderSenjata() {
  $('senjata').innerHTML = `<div class="kecil">🗡️ Senjata: request nyata ke server game</div>
    <div class="mono" style="font-size:12px">GET /pasar/rentan/item?kategori=Pedang</div>
    <button class="serang" data-act="send">💥 SERANG!</button>
    <div class="kecil">Ubah dan ulangi request ini di Burp (Repeater) untuk mengerjakan misi.</div>`;
}

function render() { renderHero(); renderSenjata(); renderPeta(); renderMisi(); }

// ---------- aksi tombol ----------
function cekSelesai() {
  const misi = LEVELS.find((l) => l.id === misiAktif);
  if (!misi || progres.selesai.includes(misi.id) || !misiSelesai(s, misi)) return;
  progres.selesai.push(misi.id);
  simpanProgres();
  animasi('char', 'serang'); setTimeout(() => { animasi('monster', 'kena'); pop('pop-m', '-20'); }, 280);
  const berikut = LEVELS.find((l) => l.id > misi.id && !progres.selesai.includes(l.id));
  pesan = { tipe: 'ok', teks: `✅ Misi ${misi.id} selesai! Penjaga Gerbang kehilangan 20 HP.${hpMusuh(progres.selesai) === 0 ? ' Dia tumbang!' : ` Sebentar lagi lanjut ke Misi ${berikut ? berikut.id : ''}...`}` };
  setTimeout(() => {
    if (misiAktif !== misi.id || !user) return;
    misiAktif = berikut ? berikut.id : null;
    pesan = berikut ? { tipe: 'info', teks: `➡️ Misi ${berikut.id}: ${berikut.judul}. Ikuti tanda 👉.` } : null;
    render();
  }, 2600);
}

const AKSI = {
  'buka-misi': (d) => { misiAktif = Number(d.id); pesan = null; },
  'tutup': () => { misiAktif = null; pesan = null; },
  'send': async () => {
    pesan = null;
    animasi('char', 'serang');
    let status;
    try { status = await serang(); } catch { pesan = { tipe: 'bad', teks: 'Server game tidak terjangkau. Coba lagi.' }; status = 0; }
    setTimeout(() => { animasi('monster', 'kena'); pop('pop-m', status === 200 ? 'HIT ' + status : 'ERR ' + (status || '?')); }, 280);
  },
  'jawab': (d) => {
    const misi = LEVELS.find((l) => l.id === misiAktif);
    if (jawabStep(s, misi, d.step, Number(d.idx))) pesan = { tipe: 'ok', teks: 'Jawaban benar!' };
    else {
      const { pingsan } = kenaDamage(s);
      progres.salahJawab++; simpanProgres();
      animasi('char', 'kena'); pop('pop-p', '-10');
      pesan = { tipe: 'bad', teks: (pingsan ? '😵 Kamu pingsan, tapi dipulihkan penuh. ' : 'Monster membalas! ') + 'Perhatikan lagi request dan respons, lalu coba lagi.' };
    }
  },
  'hint': () => { const m = LEVELS.find((l) => l.id === misiAktif); pesan = { tipe: 'info', teks: '💡 ' + m.hint }; },
  'reset-arena': async () => { try { await fetch('/api/reset', { method: 'POST' }); } catch {} s = buatState(user.displayName); pesan = { tipe: 'info', teks: 'Arena direset. Progres misi tetap tersimpan.' }; $('hero-msg').innerHTML = ''; },
  'serang-biasa': () => {
    animasi('char', 'serang'); setTimeout(() => { animasi('monster', 'kena'); pop('pop-m', 'MISS!'); }, 280);
    $('hero-msg').innerHTML = '<div class="feedback info">⚔️ Serangan biasa hanya 10 dan Penjaga memulihkan diri. Kumpulkan bukti untuk serangan kritis!</div>';
  },
};

// Request SUNGGUHAN ke server game (port yang sama). Burp bisa menangkapnya; nonce X-Aksi membuat
// server tahu bahwa request yang diulang atau diubah di Burp bukan berasal dari tombol ini.
async function serang() {
  const { path, skin } = buatPermintaan(s);
  document.cookie = `skin=${skin}; path=/; SameSite=Lax`;
  const nonce = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2);
  const r = await fetch(path, { headers: { 'X-Aksi': nonce }, credentials: 'same-origin', cache: 'no-store' });
  const teks = await r.text();
  catatRespons(s, { status: r.status, kode: r.headers.get('X-Kode-Bukti') || '0000', teks });
  await segarkanLog();
  nilaiKirim();
  return r.status;
}

// Periksa request baru dari Burp terhadap misi aktif. Request yang tidak cocok mengurangi HP pemain.
function nilaiKirim() {
  const misi = misiAktif === null ? null : LEVELS.find((l) => l.id === misiAktif);
  const { salah, pingsan } = periksaKirim(s, misi && !progres.selesai.includes(misi.id) ? misi : null);
  if (!salah) return;
  progres.salahKirim += salah; simpanProgres();
  animasi('char', 'kena'); pop('pop-p', '-' + salah * 10);
  const now = langkahSekarang(s, misi);
  pesan = { tipe: 'bad', teks: `${pingsan ? '😵 Kamu pingsan, tapi dipulihkan penuh. ' : ''}⚠️ ${salah} request dari Burp tidak cocok dengan misi ini (-${salah * 10} HP).${now ? ' Sekarang: ' + now.teks + '.' : ''}` };
}

const kunciLog = () => `${s.log.length}:${s.log.length ? s.log[s.log.length - 1].no : 0}`;
async function segarkanLog() {
  const r = await fetch('/api/log', { cache: 'no-store', credentials: 'same-origin' });
  const j = await r.json();
  const sebelum = kunciLog();
  terapkanLog(s, j.log);
  return sebelum !== kunciLog();
}

// Laporkan progres ke server agar admin bisa memantau. Ini laporan pemain sendiri;
// bukti request (game vs Burp) dicatat server sendiri dan tampil terpisah di dasbor admin.
let laporanTerakhir = { json: '', t: 0 };
function lapor() {
  if (!user || !s) return;
  const body = { nama: user.displayName, selesai: progres.selesai, misiAktif, hpPemain: s.hpPemain,
    hpMusuh: hpMusuh(progres.selesai), salahJawab: progres.salahJawab, salahKirim: progres.salahKirim };
  const json = JSON.stringify(body);
  // Hemat kuota server: kirim hanya jika ada perubahan, atau sebagai detak "masih online" tiap 10 detik.
  if (json === laporanTerakhir.json && Date.now() - laporanTerakhir.t < 10000) return;
  laporanTerakhir = { json, t: Date.now() };
  fetch('/api/progres', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, credentials: 'same-origin', keepalive: true }).catch(() => {});
}

let timerLog = null;
function mulaiPolling() {
  clearInterval(timerLog);
  timerLog = setInterval(async () => {
    if (!user || document.hidden) return;
    try {
      if (await segarkanLog()) { nilaiKirim(); cekSelesai(); render(); }
      lapor();
    } catch { /* server sementara tidak terjangkau; coba lagi di putaran berikutnya */ }
  }, 3000);
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || !user) return;
  const fn = AKSI[el.dataset.act];
  if (!fn) return;
  try { await fn(el.dataset); } catch (err) { pesan = { tipe: 'bad', teks: err.message }; }
  if (el.dataset.act !== 'serang-biasa') cekSelesai();
  render();
  lapor();
});

// ---------- masuk: mode Tamu ----------
const GUEST_KEY = 'pasar-pixel:tamu-terakhir';
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'pemain';

function masuk(u) {
  user = u;
  progres = muatProgres(u.uid);
  s = buatState(u.displayName);
  const belum = LEVELS.find((l) => !progres.selesai.includes(l.id));
  misiAktif = belum ? belum.id : null; pesan = null;
  const idPemain = u.uid.toLowerCase().replace(/[^a-z0-9:-]/g, '').slice(0, 40);
  document.cookie = `pemain=${encodeURIComponent(idPemain)}; path=/; SameSite=Lax`;
  lapor();
  segarkanLog().then(() => { periksaKirim(s, null); cekSelesai(); render(); lapor(); }).catch(() => {});
  mulaiPolling();
  $('view-login').classList.add('hidden');
  $('view-game').classList.remove('hidden');
  $('wrap').classList.add('lebar');
  $('user-name').textContent = u.displayName;
  const av = $('user-avatar');
  av.textContent = '';
  if (u.photoURL) { const img = document.createElement('img'); img.alt = ''; img.src = u.photoURL; av.appendChild(img); }
  else av.textContent = u.displayName.trim().charAt(0).toUpperCase() || '?';
  $('hero-msg').innerHTML = '';
  render();
}
function keluar() {
  user = null; s = null;
  laporanTerakhir = { json: '', t: 0 };
  clearInterval(timerLog);
  document.cookie = 'pemain=; path=/; max-age=0';
  try { localStorage.removeItem(GUEST_KEY); } catch {}
  $('view-login').classList.remove('hidden');
  $('view-game').classList.add('hidden');
  $('wrap').classList.remove('lebar');
}
const tampilkanError = (m) => { $('login-error').textContent = m; $('login-error').classList.remove('hidden'); };

$('btn-guest').onclick = () => {
  const nama = $('guest-name').value.trim();
  if (!nama) return tampilkanError('Isi dulu nama pemainmu.');
  const u = { uid: 'tamu:' + slug(nama), displayName: nama, photoURL: '' };
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(u)); } catch {}
  $('login-error').classList.add('hidden');
  masuk(u);
};
$('guest-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-guest').click(); });

$('btn-logout').onclick = () => keluar();

try {
  const last = JSON.parse(localStorage.getItem(GUEST_KEY));
  if (last && last.uid && last.displayName) masuk(last);
} catch {}

// ---------- kotak "Cara bermain": muncul otomatis di kunjungan pertama, bisa dibuka lagi lewat tombol ❓ ----------
const INTRO_KEY = 'pasar-pixel:intro-awal';
let fokusSebelum = null;
function bukaIntro() {
  $('intro-alamat').textContent = location.origin;
  fokusSebelum = document.activeElement;
  $('modal-intro').classList.remove('hidden');
  $('btn-intro-ok').focus();
}
function tutupIntro() {
  $('modal-intro').classList.add('hidden');
  try { localStorage.setItem(INTRO_KEY, '1'); } catch {}
  if (fokusSebelum && fokusSebelum.focus) fokusSebelum.focus();
}
$('btn-intro-ok').onclick = tutupIntro;
document.addEventListener('keydown', (e) => {
  if ($('modal-intro').classList.contains('hidden')) return;
  if (e.key === 'Escape') tutupIntro();
  if (e.key === 'Tab') { e.preventDefault(); $('btn-intro-ok').focus(); } // fokus tetap di dalam kotak
});
$('modal-intro').addEventListener('click', (e) => { if (e.target === $('modal-intro')) tutupIntro(); });
document.querySelectorAll('[data-bantuan]').forEach((b) => b.addEventListener('click', bukaIntro));
let sudahLihat = false;
try { sudahLihat = !!localStorage.getItem(INTRO_KEY); } catch { /* tanpa localStorage: tampilkan setiap kali */ }
if (!sudahLihat) bukaIntro();
