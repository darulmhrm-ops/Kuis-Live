/* ================= KuisLive — Pemain client (mode mandiri) ================= */

'use strict';

const $ = (id) => document.getElementById(id);
const socket = io();

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];
const SHAPES = ['▲', '◆', '●', '■'];

/* ikon SVG */
const ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 01-10 0V4z"/><path d="M7 6H4v1.5a3.5 3.5 0 003.5 3.5"/><path d="M17 6h3v1.5a3.5 3.5 0 01-3.5 3.5"/><path d="M12 14v3"/><path d="M8.5 20h7"/></svg>',
};

let myId = null;
let myColor = AVATAR_COLORS[0];
let myName = '';
let questionEndsAt = 0;
let rafId = null;
let answeredThisRound = false;
let countdownTimer = null;

/* ---------- util avatar ---------- */

function initial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

function avatarHtml(name, color) {
  return `<span class="avatar" style="background:${color}">${initial(name)}</span>`;
}

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $(id).classList.add('active');
}

/* ================= Join (PIN + nama satu halaman) ================= */

function renderAvatarPicker() {
  const picker = $('avatarPicker');
  picker.innerHTML = '';
  AVATAR_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.style.background = c;
    b.textContent = 'A';
    b.style.color = '#fff';
    b.style.fontWeight = '700';
    b.style.fontSize = '0.95rem';
    b.setAttribute('aria-label', `Warna avatar ${i + 1}`);
    if (i === 0) b.classList.add('selected');
    b.addEventListener('click', () => {
      picker.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      myColor = c;
    });
    picker.appendChild(b);
  });
}

function join() {
  const code = $('codeInput').value.replace(/\D/g, '');
  const name = $('nameInput').value.trim();
  const err = $('joinError');
  err.textContent = '';
  if (code.length !== 6) { err.textContent = 'PIN harus 6 digit.'; return; }
  if (!name) { err.textContent = 'Nama wajib diisi.'; return; }
  socket.emit('player:join', { code, name, color: myColor }, (res) => {
    if (!res.ok) { err.textContent = res.error; return; }
    myId = res.playerId;
    myColor = res.color;
    myName = name;
    sessionStorage.setItem('kuisPlayer', JSON.stringify({ code, name }));
    $('waitAvatar').innerHTML = avatarHtml(name, myColor);
    $('waitName').textContent = name;
    showView('view-waiting');
  });
}

$('joinBtn').addEventListener('click', join);
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

// prefill kode dari URL (?code=123456)
const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) $('codeInput').value = urlCode.replace(/\D/g, '').slice(0, 6);

/* ================= Game events ================= */

socket.on('game:question', (q) => {
  answeredThisRound = false;
  questionEndsAt = q.endsAt;
  showView('view-question');

  $('playQCounter').textContent = `Soal ${q.index}/${q.total}`;
  $('playPoints').textContent = `+${q.points}`;
  $('playQuestionText').textContent = q.text;
  $('answerStatus').classList.add('hidden');

  const wrap = $('playOptions');
  wrap.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = `option-btn c${i}`;
    btn.innerHTML = `<span class="shape">${SHAPES[i]}</span><span class="opt-text"></span>`;
    btn.querySelector('.opt-text').textContent = opt;
    btn.addEventListener('click', () => answer(i, btn));
    wrap.appendChild(btn);
  });

  // rejoin di tengah soal: kalau sudah menjawab, kunci tombol
  if (q.youAnswered) {
    answeredThisRound = true;
    document.querySelectorAll('#playOptions .option-btn').forEach((b) => { b.disabled = true; });
  }

  startTimerBar($('playTimerBar'), questionEndsAt);
});

function answer(index, btn) {
  if (answeredThisRound) return;
  answeredThisRound = true;
  stopTimerBar();
  socket.emit('player:answer', { optionIndex: index });
  document.querySelectorAll('#playOptions .option-btn').forEach((b) => { b.disabled = true; });
  btn.classList.add('dim');
}

// hasil jawaban → tampil ±3 detik → server otomatis kirim soal berikutnya
socket.on('game:answer_result', (res) => {
  stopTimerBar();
  showView('view-result');

  if (!res.answered) {
    $('resultIcon').className = 'reveal-icon late';
    $('resultIcon').innerHTML = ICONS.clock;
    $('resultTitle').textContent = 'Waktu habis!';
    $('resultPoints').textContent = '+0';
    $('resultPoints').classList.add('zero');
    $('resultMeme').textContent = 'Jawaban tidak terkirim';
  } else if (res.correct) {
    $('resultIcon').className = 'reveal-icon ok';
    $('resultIcon').innerHTML = ICONS.check;
    $('resultTitle').textContent = 'Benar!';
    $('resultPoints').textContent = `+${res.points}`;
    $('resultPoints').classList.remove('zero');
    $('resultMeme').textContent = res.meme;
  } else {
    $('resultIcon').className = 'reveal-icon bad';
    $('resultIcon').innerHTML = ICONS.x;
    $('resultTitle').textContent = 'Kurang tepat';
    $('resultPoints').textContent = '+0';
    $('resultPoints').classList.add('zero');
    $('resultMeme').textContent = `Kunci: ${res.correctOption || ''}`;
  }
  $('resultScore').textContent = res.score;
  $('resultStreak').textContent = res.streak;

  // hitung mundur visual (server yang memicu pemindahan soal)
  startCountdown(res.nextInMs || 3000);
});

function startCountdown(ms) {
  if (countdownTimer) clearInterval(countdownTimer);
  const endAt = Date.now() + ms;
  const tick = () => {
    const remain = Math.max(0, endAt - Date.now());
    $('countdown').textContent = Math.ceil(remain / 1000);
    $('countdownBar').style.width = `${(remain / ms) * 100}%`;
    if (remain <= 0) clearInterval(countdownTimer);
  };
  tick();
  countdownTimer = setInterval(tick, 100);
}

// selesai semua soal → tampilkan klasemen live sambil menunggu pemain lain
socket.on('game:player_done', ({ score, bestStreak, standings }) => {
  showView('view-done');
  $('doneScore').textContent = score;
  const body = $('doneLbBody');
  body.innerHTML = '';
  standings.forEach((r) => {
    const tr = document.createElement('tr');
    if (r.playerId === myId) tr.classList.add('me');
    tr.innerHTML = `
      <td class="rank-cell"><span class="rank-badge ${r.rank <= 3 ? 'r' + r.rank : ''}">${r.rank}</span></td>
      <td><span class="lb-player">${avatarHtml(r.name, r.color)}<span>${escapeHtml(r.name)}${r.playerId === myId ? ' (kamu)' : ''}</span></span></td>
      <td>${r.score}</td>`;
    body.appendChild(tr);
  });
});

socket.on('game:finished', ({ podium, rows, you }) => {
  showView('view-finished');
  $('finMedal').innerHTML = ICONS.trophy;
  $('finRank').textContent = `Kamu peringkat #${you.rank} dari ${rows.length}`;
  $('finScore').textContent = `${you.score} poin · streak terbaik ${you.bestStreak}`;

  renderPodiumMini($('podiumMini'), podium);

  const list = $('reviewList');
  list.innerHTML = '';
  you.review.forEach((r) => {
    const item = document.createElement('div');
    const unanswered = r.answered === false;
    item.className = `review-item ${r.correct ? 'ok' : 'bad'}`;
    const icon = unanswered ? ICONS.clock : r.correct ? ICONS.check : ICONS.x;
    const yourLine = unanswered
      ? `Tidak dijawab · Kunci: <b>${escapeHtml(r.correctOption)}</b> · <b>+0</b>`
      : `Jawabanmu: <b>${escapeHtml(r.yourOption)}</b>${r.correct ? '' : ` · Kunci: <b>${escapeHtml(r.correctOption)}</b>`} · <b>+${r.points}</b>`;
    item.innerHTML = `
      <div class="rq">${icon} Soal ${r.qIndex}: ${escapeHtml(r.text)}</div>
      <div class="ra">${yourLine}</div>`;
    list.appendChild(item);
  });
});

socket.on('game:reset', () => {
  showView('view-waiting');
});

socket.on('player:kicked', () => {
  alert('Guru mengeluarkan kamu dari permainan.');
  sessionStorage.removeItem('kuisPlayer');
  showView('view-join');
});

socket.on('reaction', ({ name, icon }) => {
  spawnFloating($('playReactionLayer'), icon);
});

/* reaksi */
$('reactionBar').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const iconSvg = btn.innerHTML;
  socket.emit('player:reaction', { icon: iconSvg });
  spawnFloating($('playReactionLayer'), iconSvg);
});

$('finHomeBtn').addEventListener('click', () => {
  sessionStorage.removeItem('kuisPlayer');
  location.href = '/';
});

/* ================= Utilitas ================= */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function startTimerBar(bar, endsAt) {
  stopTimerBar();
  const total = endsAt - Date.now();
  const tick = () => {
    const remain = Math.max(0, endsAt - Date.now());
    bar.style.width = `${(remain / total) * 100}%`;
    if (remain > 0) rafId = requestAnimationFrame(tick);
    else bar.style.width = '0%';
  };
  tick();
}
function stopTimerBar() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

function spawnFloating(layer, iconSvg) {
  const el = document.createElement('div');
  el.className = 'floating-reaction';
  el.innerHTML = iconSvg || '';
  el.style.left = `${10 + Math.random() * 80}%`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

function renderPodiumMini(container, podium) {
  container.innerHTML = '';
  const order = [podium[1], podium[0], podium[2]];
  const cls = ['second', 'first', 'third'];
  order.forEach((r, i) => {
    if (!r) return;
    const step = document.createElement('div');
    step.className = `podium-step ${cls[i]}`;
    step.innerHTML = `
      <span class="p-av">${avatarHtml(r.name, r.color)}</span>
      <span class="p-name">${escapeHtml(r.name)}</span>
      <div class="podium-block">${cls[i] === 'first' ? '1' : cls[i] === 'second' ? '2' : '3'}</div>`;
    container.appendChild(step);
  });
}

/* ================= Init ================= */

renderAvatarPicker();

// rejoin otomatis kalau halaman di-refresh di tengah permainan
const savedPlayer = sessionStorage.getItem('kuisPlayer');
if (savedPlayer) {
  try {
    const { code, name } = JSON.parse(savedPlayer);
    socket.emit('player:rejoin', { code, name }, (res) => {
      if (res.ok) {
        myId = res.playerId;
        myColor = res.color;
        myName = name;
        $('waitAvatar').innerHTML = avatarHtml(name, myColor);
        $('waitName').textContent = name;
        if (res.state === 'lobby') showView('view-waiting');
        // state lain ditangani snapshot dari server (game:question / game:answer_result / game:player_done / game:finished)
      } else {
        sessionStorage.removeItem('kuisPlayer');
      }
    });
  } catch {
    sessionStorage.removeItem('kuisPlayer');
  }
}
