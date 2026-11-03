/* ================= KuisLive — Guru/Admin client (dashboard) ================= */

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
};

let questions = []; // model editor
let roomCode = null;
let lastPlayerCount = 0;
let dashTimerInterval = null;
let dashElapsedBase = 0;

/* ---------- util ---------- */

function initial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

function avatarHtml(name, color) {
  return `<span class="avatar" style="background:${color}">${initial(name)}</span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $(id).classList.add('active');
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------- auth: cek token, lanjutkan sesi di socket ini ---------- */

const adminToken = sessionStorage.getItem('kuisAdminToken');
if (!adminToken) {
  window.location.href = '/login.html';
} else {
  // socket baru (setelah redirect dari login) → lanjutkan sesi dengan token yang ada
  socket.emit('admin:resume', { token: adminToken }, (res) => {
    if (!res || !res.ok) {
      sessionStorage.removeItem('kuisAdminToken');
      window.location.href = '/login.html';
    }
  });
}

function hostEmit(event, payload, ack) {
  socket.emit(event, { ...(payload || {}), token: adminToken }, ack);
}

function logout() {
  socket.emit('host:logout');
  sessionStorage.removeItem('kuisAdminToken');
  sessionStorage.removeItem('kuisRoom');
  window.location.href = '/login.html';
}
$('logoutBtn').addEventListener('click', logout);
$('logoutBtn2').addEventListener('click', logout);
$('logoutBtn3').addEventListener('click', logout);

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
  hostEmit('host:save_quiz', collectQuiz(), (res) => {
    if (!res.ok) {
      err.textContent = res.errors ? res.errors[0] : res.error;
      if (res.error && res.error.includes('Sesi')) window.location.href = '/login.html';
      return;
    }
    hostEmit('host:create_room', { quizId: res.quizId }, (r) => {
      if (!r.ok) {
        err.textContent = r.error;
        if (r.error && r.error.includes('Sesi')) window.location.href = '/login.html';
        return;
      }
      enterLobby(r.code);
    });
  });
});

/* ================= Kuis tersimpan ================= */

function loadSavedQuizzes() {
  hostEmit('host:list_quizzes', {}, (list) => {
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
        hostEmit('host:create_room', { quizId: q.id }, (r) => {
          if (r.ok) enterLobby(r.code);
        });
      });
      item.querySelector('.btn-outline').addEventListener('click', () => {
        if (!confirm(`Hapus kuis "${q.title}"?`)) return;
        hostEmit('host:delete_quiz', { quizId: q.id }, () => loadSavedQuizzes());
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

/* ================= Navigasi ================= */

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
  hostEmit('host:start');
});

$('endGameBtn').addEventListener('click', () => {
  if (confirm('Akhiri kuis sekarang? Semua siswa akan langsung melihat hasil akhir.')) {
    hostEmit('host:end_game');
  }
});

$('playAgainBtn').addEventListener('click', () => {
  hostEmit('host:play_again');
});

/* ================= Events ================= */

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
      chip.appendChild(off);
    }
    const kick = document.createElement('button');
    kick.className = 'kick';
    kick.textContent = '×';
    kick.title = 'Keluarkan pemain';
    kick.addEventListener('click', () => hostEmit('host:kick', { playerId: p.id }));
    chip.appendChild(kick);
    grid.appendChild(chip);
  });
  $('lobbyHint').textContent = data.players.length
    ? `${data.players.length} siswa siap!`
    : 'Menunggu siswa bergabung…';
  $('startBtn').disabled = data.players.length === 0;
});

socket.on('host:error', (msg) => {
  $('lobbyHint').textContent = msg;
  $('lobbyHint').classList.add('error');
});

/* ---------- dashboard live ---------- */

socket.on('host:dashboard', (d) => {
  if (d.state === 'lobby') {
    showView('view-lobby');
    return;
  }
  if (d.state === 'finished') return; // ditangani game:finished_host

  showView('view-dashboard');
  $('dashQuizTitle').textContent = `${d.quizTitle} · ${d.totalQuestions} soal`;
  $('dashPlayerCount').textContent = `${d.players.length} siswa`;

  // timer berjalan
  dashElapsedBase = d.elapsedMs;
  if (dashTimerInterval) clearInterval(dashTimerInterval);
  dashTimerInterval = setInterval(() => {
    $('dashTimer').textContent = fmtTime(dashElapsedBase + 1000);
    dashElapsedBase += 1000;
  }, 1000);
  $('dashTimer').textContent = fmtTime(d.elapsedMs);

  // tabel klasemen live
  const rows = [...d.players].sort((a, b) => b.score - a.score);
  const body = $('dashBody');
  body.innerHTML = '';
  rows.forEach((p, i) => {
    const tr = document.createElement('tr');
    const statusMap = {
      answering: '<span class="status-pill answering">Menjawab</span>',
      done: '<span class="status-pill done">Selesai</span>',
      waiting: '<span class="status-pill waiting">Menunggu</span>',
    };
    const pos = p.status === 'done' ? 'Selesai' : p.qIndex < 0 ? '—' : `Soal ${p.qIndex + 1}/${d.totalQuestions}`;
    tr.innerHTML = `
      <td class="rank-cell"><span class="rank-badge ${i + 1 <= 3 ? 'r' + (i + 1) : ''}">${i + 1}</span></td>
      <td><span class="lb-player">${avatarHtml(p.name, p.color)}<span>${escapeHtml(p.name)}${p.connected === false ? ' <em class="offline-tag">offline</em>' : ''}</span></span></td>
      <td><strong>${p.score}</strong></td>
      <td>
        <div class="dash-progress">
          <div class="dash-progress-track"><div class="dash-progress-bar" style="width:${p.progressPct}%"></div></div>
          <span class="dash-progress-label">${pos}</span>
        </div>
      </td>
      <td>${statusMap[p.status] || ''}</td>`;
    body.appendChild(tr);
  });

  // referensi soal (kunci jawaban)
  const refList = $('dashQuestions');
  refList.innerHTML = '';
  (d.questions || []).forEach((q, i) => {
    const item = document.createElement('div');
    item.className = 'ref-item';
    item.innerHTML = `
      <div class="ref-q">${i + 1}. ${escapeHtml(q.text)}</div>
      <div class="ref-a">Kunci: <b>${escapeHtml(q.correct)}</b> · ${q.points} poin · ${q.timeLimit}s</div>`;
    refList.appendChild(item);
  });

  // statistik per soal
  const statList = $('dashStats');
  statList.innerHTML = '';
  const totalPlayers = d.players.length || 1;
  (d.questionStats || []).forEach((s, i) => {
    const pct = Math.round((s.answered / totalPlayers) * 100);
    const item = document.createElement('div');
    item.className = 'stat-item';
    item.innerHTML = `
      <div class="stat-head"><span>Soal ${i + 1}</span><span>${s.answered}/${d.players.length} menjawab · ${s.correct} benar</span></div>
      <div class="stat-track"><div class="stat-bar" style="width:${pct}%"></div></div>`;
    statList.appendChild(item);
  });
});

socket.on('game:finished_host', ({ podium, rows }) => {
  if (dashTimerInterval) clearInterval(dashTimerInterval);
  showView('view-finished');
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

socket.on('reaction', ({ name, icon }) => {
  spawnFloating($('reactionLayer'), icon);
});

/* ================= Utilitas ================= */

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
  const order = [podium[1], podium[0], podium[2]];
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

// rejoin otomatis kalau guru refresh halaman di tengah permainan
const savedRoom = sessionStorage.getItem('kuisRoom');
if (savedRoom && adminToken) {
  hostEmit('host:rejoin', { code: savedRoom }, (res) => {
    if (res.ok) {
      roomCode = savedRoom;
      $('lobbyCode').textContent = savedRoom;
      $('joinLink').value = `${location.origin}/play.html?code=${savedRoom}`;
      if (res.state === 'lobby') showView('view-lobby');
      // state playing/finished → ditangani event host:dashboard / game:finished_host
    } else {
      sessionStorage.removeItem('kuisRoom');
    }
  });
}
