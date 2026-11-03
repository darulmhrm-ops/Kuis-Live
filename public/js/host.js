/* ================= KuisLive — Host client ================= */

'use strict';

const $ = (id) => document.getElementById(id);
const socket = io();

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];
const SHAPES = ['▲', '◆', '●', '■'];

/* ikon SVG (lucide-style) */
const ICONS = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 01-10 0V4z"/><path d="M7 6H4v1.5a3.5 3.5 0 003.5 3.5"/><path d="M17 6h3v1.5a3.5 3.5 0 01-3.5 3.5"/><path d="M12 14v3"/><path d="M8.5 20h7"/></svg>',
};

let questions = []; // model editor
let roomCode = null;
let currentQuestion = null; // data soal aktif dari server
let questionEndsAt = 0;
let rafId = null;
let lastPlayerCount = 0; // jumlah pemain terakhir (dari lobby)

/* ---------- util avatar ---------- */

function initial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

function avatarHtml(name, color, extraClass = '') {
  return `<span class="avatar ${extraClass}" style="background:${color}">${initial(name)}</span>`;
}

/* ================= Editor ================= */

function newQuestion() {
  return { text: '', options: ['', '', '', ''], correct: 0, timeLimit: 20, points: 500 };
}

function renderEditor() {
  const list = $('questionList');
  list.innerHTML = '';
  questions.forEach((q, qi) => {
    const card = document.createElement('div');
    card.className = 'question-card';

    const head = document.createElement('div');
    head.className = 'qc-head';
    head.innerHTML = `<h3>Soal ${qi + 1}</h3>`;
    const tools = document.createElement('div');
    tools.className = 'qc-tools';
    tools.innerHTML = `
      <button class="icon-btn" data-act="up" title="Naik">${ICONS.up}</button>
      <button class="icon-btn" data-act="down" title="Turun">${ICONS.down}</button>
      <button class="icon-btn" data-act="dup" title="Duplikat">${ICONS.copy}</button>
      <button class="icon-btn danger" data-act="del" title="Hapus">${ICONS.trash}</button>`;
    tools.addEventListener('click', (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      if (act === 'del') questions.splice(qi, 1);
      if (act === 'dup') questions.splice(qi + 1, 0, JSON.parse(JSON.stringify(questions[qi])));
      if (act === 'up' && qi > 0) [questions[qi - 1], questions[qi]] = [questions[qi], questions[qi - 1]];
      if (act === 'down' && qi < questions.length - 1) [questions[qi + 1], questions[qi]] = [questions[qi], questions[qi + 1]];
      renderEditor();
    });
    head.appendChild(tools);
    card.appendChild(head);

    const text = document.createElement('textarea');
    text.className = 'q-text';
    text.placeholder = 'Tulis pertanyaan di sini…';
    text.value = q.text;
    text.addEventListener('input', () => { q.text = text.value; });
    card.appendChild(text);

    q.options.forEach((opt, oi) => {
      const row = document.createElement('div');
      row.className = 'option-row';
      const shape = document.createElement('span');
      shape.className = `shape s${oi}`;
      shape.textContent = SHAPES[oi];
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = `Opsi ${SHAPES[oi]}`;
      input.value = opt;
      input.addEventListener('input', () => { q.options[oi] = input.value; });
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `correct-${qi}`;
      radio.checked = q.correct === oi;
      radio.title = 'Tandai sebagai jawaban benar';
      radio.addEventListener('change', () => { q.correct = oi; });
      const tag = document.createElement('label');
      tag.className = 'correct-tag';
      tag.textContent = q.correct === oi ? 'benar' : '';
      radio.addEventListener('change', () => { renderEditor(); });
      row.append(shape, input, radio, tag);
      card.appendChild(row);
    });

    const meta = document.createElement('div');
    meta.className = 'qc-meta';
    meta.innerHTML = `
      <label>${ICONS.clock} Batas waktu
        <input type="number" min="5" max="180" step="5" value="${q.timeLimit}" />
      </label>
      <label>${ICONS.star} Poin
        <select>
          <option value="500" ${q.points === 500 ? 'selected' : ''}>500 (Standar)</option>
          <option value="1000" ${q.points === 1000 ? 'selected' : ''}>1000 (Ganda)</option>
          <option value="2000" ${q.points === 2000 ? 'selected' : ''}>2000 (Triple)</option>
        </select>
      </label>`;
    const numInput = meta.querySelector('input');
    numInput.addEventListener('input', () => { q.timeLimit = Number(numInput.value) || 20; });
    const sel = meta.querySelector('select');
    sel.addEventListener('change', () => { q.points = Number(sel.value); });
    card.appendChild(meta);

    list.appendChild(card);
  });
}

function collectQuiz() {
  return {
    title: $('quizTitle').value,
    questions: questions.map((q) => ({
      text: q.text,
      options: q.options.slice(),
      correct: q.correct,
      timeLimit: Number(q.timeLimit) || 20,
      points: Number(q.points) || 500,
    })),
    settings: {
      shuffleQuestions: $('setShuffleQ').checked,
      shuffleOptions: $('setShuffleO').checked,
    },
  };
}

$('addQuestionBtn').addEventListener('click', () => {
  questions.push(newQuestion());
  renderEditor();
});

$('saveQuizBtn').addEventListener('click', () => {
  const err = $('editorError');
  err.textContent = '';
  socket.emit('host:save_quiz', collectQuiz(), (res) => {
    if (!res.ok) {
      err.textContent = res.errors[0];
      return;
    }
    socket.emit('host:create_room', { quizId: res.quizId }, (r) => {
      if (!r.ok) {
        err.textContent = r.error;
        return;
      }
      enterLobby(r.code);
    });
  });
});

/* ================= Kuis tersimpan ================= */

function loadSavedQuizzes() {
  socket.emit('host:list_quizzes', (list) => {
    const wrap = $('savedList');
    if (!list.length) {
      wrap.innerHTML = '<p class="muted">Belum ada kuis tersimpan. Buat baru dulu!</p>';
      return;
    }
    wrap.innerHTML = '';
    list.forEach((q) => {
      const item = document.createElement('div');
      item.className = 'saved-item';
      item.innerHTML = `
        <div><h3></h3><p class="muted">${q.count} soal</p></div>
        <div class="saved-actions">
          <button class="btn btn-primary">Gunakan</button>
          <button class="btn btn-outline">Hapus</button>
        </div>`;
      item.querySelector('h3').textContent = q.title;
      item.querySelector('.btn-primary').addEventListener('click', () => {
        socket.emit('host:create_room', { quizId: q.id }, (r) => {
          if (r.ok) enterLobby(r.code);
        });
      });
      item.querySelector('.btn-outline').addEventListener('click', () => {
        if (!confirm(`Hapus kuis "${q.title}"?`)) return;
        socket.emit('host:delete_quiz', { quizId: q.id }, () => loadSavedQuizzes());
      });
      wrap.appendChild(item);
    });
  });
}

$('tabNew').addEventListener('click', () => {
  $('tabNew').classList.add('active');
  $('tabSaved').classList.remove('active');
  $('panelNew').classList.remove('hidden');
  $('panelSaved').classList.add('hidden');
});
$('tabSaved').addEventListener('click', () => {
  $('tabSaved').classList.add('active');
  $('tabNew').classList.remove('active');
  $('panelSaved').classList.remove('hidden');
  $('panelNew').classList.add('hidden');
  loadSavedQuizzes();
});

/* ================= Navigasi view ================= */

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $(id).classList.add('active');
}

function enterLobby(code) {
  roomCode = code;
  sessionStorage.setItem('kuisRoom', code);
  $('lobbyCode').textContent = code;
  $('joinLink').value = `${location.origin}/play.html?code=${code}`;
  showView('view-lobby');
}

$('copyLinkBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('joinLink').value);
    $('copyLinkBtn').textContent = 'Tersalin!';
  } catch {
    $('joinLink').select();
    document.execCommand('copy');
    $('copyLinkBtn').textContent = 'Tersalin!';
  }
  setTimeout(() => { $('copyLinkBtn').textContent = 'Salin'; }, 1500);
});

$('startBtn').addEventListener('click', () => {
  socket.emit('host:start');
});

/* ================= Game events ================= */

socket.on('room:lobby', (data) => {
  if (data.code !== roomCode) return;
  lastPlayerCount = data.players.length;
  if (data.joinUrl) $('joinLink').value = data.joinUrl;
  const qrImg = $('joinQr');
  if (data.qr) {
    qrImg.src = data.qr;
    qrImg.classList.remove('hidden');
  } else {
    qrImg.classList.add('hidden');
  }
  $('lobbyQuizTitle').textContent = `${data.quizTitle} · ${data.totalQuestions} soal`;
  const grid = $('lobbyPlayers');
  grid.innerHTML = '';
  $('playerCount').textContent = data.players.length;
  data.players.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'player-chip' + (p.connected === false ? ' offline' : '');
    chip.innerHTML = avatarHtml(p.name, p.color);
    const name = document.createElement('span');
    name.textContent = p.name;
    chip.appendChild(name);
    if (p.connected === false) {
      const off = document.createElement('span');
      off.className = 'offline-tag';
      off.textContent = 'offline';
      off.title = 'Koneksi terputus — menunggu pemain kembali';
      chip.appendChild(off);
    }
    const kick = document.createElement('button');
    kick.className = 'kick';
    kick.textContent = '×';
    kick.title = 'Keluarkan pemain';
    kick.addEventListener('click', () => socket.emit('host:kick', { playerId: p.id }));
    chip.appendChild(kick);
    grid.appendChild(chip);
  });
  $('lobbyHint').textContent = data.players.length
    ? `${data.players.length} pemain siap!`
    : 'Menunggu pemain bergabung…';
  $('startBtn').disabled = data.players.length === 0;
});

socket.on('host:error', (msg) => {
  $('lobbyHint').textContent = msg;
  $('lobbyHint').classList.add('error');
});

socket.on('game:question', (q) => {
  currentQuestion = q;
  questionEndsAt = q.endsAt;
  showView('view-game');
  $('gameQuestion').classList.remove('hidden');
  $('gameLeaderboard').classList.add('hidden');
  $('gameFinished').classList.add('hidden');

  $('qCounter').textContent = `Soal ${q.index}/${q.total}`;
  $('answeredBadge').textContent = `0/${lastPlayerCount} menjawab`;
  $('questionText').textContent = q.text;
  $('nextBtn').disabled = true;
  $('skipBtn').classList.remove('hidden');
  $('nextHint').textContent = 'Tunggu semua pemain menjawab…';

  const grid = $('optionGrid');
  grid.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = `option-btn c${i}`;
    btn.dataset.index = i;
    btn.innerHTML = `<span class="opt-bar"></span><span class="opt-content"><span class="shape">${SHAPES[i]}</span><span class="opt-text"></span><span class="opt-count">0</span></span>`;
    btn.querySelector('.opt-text').textContent = opt;
    grid.appendChild(btn);
  });

  startTimerBar($('timerBar'), questionEndsAt);
});

socket.on('game:progress', ({ answered, total }) => {
  $('answeredBadge').textContent = `${answered}/${total} menjawab`;
  if (answered >= total && total > 0) {
    $('nextBtn').disabled = false;
    $('nextHint').textContent = 'Semua sudah menjawab — lanjut!';
  }
});

socket.on('game:reveal', ({ correctIndex, optionCounts }) => {
  stopTimerBar();
  $('timerBar').style.width = '0%';
  const btns = [...document.querySelectorAll('#optionGrid .option-btn')];
  const max = Math.max(1, ...optionCounts);
  btns.forEach((btn, i) => {
    btn.disabled = true;
    btn.querySelector('.opt-count').textContent = `${optionCounts[i]}`;
    btn.querySelector('.opt-bar').style.width = `${(optionCounts[i] / max) * 100}%`;
    if (i === correctIndex) btn.classList.add('correct');
    else btn.classList.add('dim');
  });
  $('nextBtn').disabled = false;
  $('skipBtn').classList.add('hidden');
  $('nextHint').textContent = 'Tampilkan papan skor';
});

socket.on('game:leaderboard', ({ rows }) => {
  showView('view-game');
  $('gameQuestion').classList.add('hidden');
  $('gameLeaderboard').classList.remove('hidden');
  $('gameFinished').classList.add('hidden');
  const body = $('lbBody');
  body.innerHTML = '';
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="rank-cell"><span class="rank-badge ${r.rank <= 3 ? 'r' + r.rank : ''}">${r.rank}</span></td>
      <td><span class="lb-player">${avatarHtml(r.name, r.color)}<span>${escapeHtml(r.name)}</span></span></td>
      <td>${r.score}</td>
      <td class="delta ${r.delta ? '' : 'zero'}">${r.delta ? '+' + r.delta : '—'}</td>`;
    body.appendChild(tr);
  });
  $('lbNextBtn').innerHTML = `Lanjut
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>`;
});

socket.on('game:finished_host', ({ podium, rows }) => {
  showView('view-game');
  $('gameQuestion').classList.add('hidden');
  $('gameLeaderboard').classList.add('hidden');
  $('gameFinished').classList.remove('hidden');
  renderPodium($('podium'), podium);
  const body = $('finBody');
  body.innerHTML = '';
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="rank-cell"><span class="rank-badge ${r.rank <= 3 ? 'r' + r.rank : ''}">${r.rank}</span></td>
      <td><span class="lb-player">${avatarHtml(r.name, r.color)}<span>${escapeHtml(r.name)}</span></span></td>
      <td>${r.score}</td>`;
    body.appendChild(tr);
  });
});

socket.on('game:reset', () => {
  showView('view-lobby');
});

/* reaksi mengambang di layar host */
socket.on('reaction', ({ name, icon }) => {
  spawnFloating($('reactionLayer'), icon);
});

$('nextBtn').addEventListener('click', () => socket.emit('host:next'));
$('skipBtn').addEventListener('click', () => socket.emit('host:next')); // akhiri soal lebih awal
$('lbNextBtn').addEventListener('click', () => socket.emit('host:next'));
$('playAgainBtn').addEventListener('click', () => socket.emit('host:play_again'));

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

function renderPodium(container, podium) {
  container.innerHTML = '';
  const order = [podium[1], podium[0], podium[2]]; // kiri: juara 2, tengah: juara 1, kanan: juara 3
  const cls = ['second', 'first', 'third'];
  order.forEach((r, i) => {
    if (!r) return;
    const step = document.createElement('div');
    step.className = `podium-step ${cls[i]}`;
    step.innerHTML = `
      <span class="p-av">${avatarHtml(r.name, r.color)}</span>
      <span class="p-name">${escapeHtml(r.name)}</span>
      <span class="p-score">${r.score} poin</span>
      <div class="podium-block">${cls[i] === 'first' ? '1' : cls[i] === 'second' ? '2' : '3'}</div>`;
    container.appendChild(step);
  });
}

/* ================= Init ================= */

questions.push(newQuestion());
renderEditor();

// rejoin otomatis kalau host refresh halaman di tengah permainan
const savedRoom = sessionStorage.getItem('kuisRoom');
if (savedRoom) {
  socket.emit('host:rejoin', { code: savedRoom }, (res) => {
    if (res.ok) {
      roomCode = savedRoom;
      $('lobbyCode').textContent = savedRoom;
      $('joinLink').value = `${location.origin}/play.html?code=${savedRoom}`;
      if (res.state === 'lobby') showView('view-lobby');
      else showView('view-game');
    } else {
      sessionStorage.removeItem('kuisRoom');
    }
  });
}
