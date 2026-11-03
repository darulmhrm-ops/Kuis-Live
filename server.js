'use strict';

/**
 * KuisLive 2.0 — server kuis multiplayer real-time (ala Quizizz)
 * - Dua peran: Admin/Guru (password) & Siswa
 * - Mode mandiri: tiap siswa menjawab dengan tempo sendiri,
 *   setelah menjawab → hasil → 3 detik → soal berikutnya OTOMATIS
 * - Dashboard live untuk guru
 * Express + Socket.IO, state room in-memory, kuis di data/quizzes.json
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const QUIZ_FILE = path.join(DATA_DIR, 'quizzes.json');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'guru123';
const ADVANCE_DELAY_MS = 3000;      // jeda tampil hasil sebelum soal berikutnya
const ANSWER_GRACE_MS = 750;        // toleransi jawaban tepat di batas waktu
const DISCONNECT_GRACE_MS = 120000; // waktu tunggu rejoin sebelum pemain dibuang

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];
const MEMES = ['Keren!', 'Hebat!', 'Luar biasa!', 'Mantap!', 'Cepat sekali!', 'Hampir!', 'Jangan menyerah!', 'Coba lagi ya!'];

/* token admin yang sedang login (in-memory; hilang saat server restart) */
const adminTokens = new Set();

/* ---------------- storage ---------------- */

function loadQuizzes() {
  try {
    const list = JSON.parse(fs.readFileSync(QUIZ_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persistQuizzes(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(QUIZ_FILE, JSON.stringify(list, null, 2));
}

/* ---------------- helpers ---------------- */

function clean(s, max = 500) {
  return String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, max);
}

function makeCode() {
  let c;
  do {
    c = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(c));
  return c;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function validateQuiz(input) {
  const errors = [];
  const title = clean(input && input.title, 120);
  if (!title) errors.push('Judul kuis wajib diisi.');

  const rawQuestions = Array.isArray(input && input.questions) ? input.questions : [];
  if (rawQuestions.length === 0) errors.push('Minimal 1 soal.');

  const questions = rawQuestions.map((q, i) => {
    const text = clean(q && q.text, 500);
    if (!text) errors.push(`Soal ${i + 1}: teks soal wajib diisi.`);
    const options = Array.isArray(q && q.options) ? q.options.slice(0, 4).map((o) => clean(o, 200)) : [];
    while (options.length < 4) options.push('');
    if (options.some((o) => !o)) errors.push(`Soal ${i + 1}: keempat opsi jawaban wajib diisi.`);
    let correct = Number(q && q.correct);
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) {
      errors.push(`Soal ${i + 1}: pilih kunci jawaban yang benar.`);
      correct = 0;
    }
    let timeLimit = Number(q && q.timeLimit);
    if (!Number.isFinite(timeLimit)) timeLimit = 20;
    timeLimit = Math.min(180, Math.max(5, Math.round(timeLimit)));
    let points = Number(q && q.points);
    if (![500, 1000, 2000].includes(points)) points = 500;
    return { id: `q${Date.now()}${i}${Math.random().toString(36).slice(2, 6)}`, text, options, correct, timeLimit, points };
  });

  const settings = {
    shuffleQuestions: !!(input && input.settings && input.settings.shuffleQuestions),
    shuffleOptions: !!(input && input.settings && input.settings.shuffleOptions),
  };

  return { ok: errors.length === 0, errors, quiz: { title, questions, settings } };
}

/* ---------------- rooms ---------------- */

const rooms = new Map(); // code -> room

function createRoom(quiz) {
  const room = {
    code: makeCode(),
    quiz,
    hostSocketId: null,
    players: new Map(), // socketId -> player
    state: 'lobby', // lobby | playing | finished
    startedAt: 0,
    finishedAt: 0,
    questionStats: [], // per soal: {answered, correct}
    joinUrl: null,
    qr: null,
    createdAt: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function lobbyPayload(room) {
  return {
    code: room.code,
    quizTitle: room.quiz.title,
    totalQuestions: room.quiz.questions.length,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, connected: p.connected })),
    joinUrl: room.joinUrl || null,
    qr: room.qr || null,
  };
}

// siapkan URL join (pakai host header supaya benar untuk HP di jaringan yang sama) + QR code
async function prepareJoinInfo(room, socket) {
  const headers = (socket && socket.handshake && socket.handshake.headers) || {};
  const host = headers.host || `localhost:${PORT}`;
  // deteksi protokol: proxy/tunnel (Cloudflare, Render) mengirim x-forwarded-proto
  const proto = headers['x-forwarded-proto'] || (socket.handshake && socket.handshake.secure ? 'https' : 'http');
  room.joinUrl = `${proto}://${host}/play.html?code=${room.code}`;
  try {
    room.qr = await QRCode.toDataURL(room.joinUrl, { width: 240, margin: 1 });
  } catch {
    room.qr = null;
  }
  io.to(room.code).emit('room:lobby', lobbyPayload(room));
}

function removePlayer(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) return;
  if (player.removeTimer) {
    clearTimeout(player.removeTimer);
    player.removeTimer = null;
  }
  if (player.expireTimer) clearTimeout(player.expireTimer);
  if (player.advanceTimer) clearTimeout(player.advanceTimer);
  room.players.delete(playerId);
}

function playerStatus(p) {
  if (p.finishedAt) return 'done';
  if (p.qIndex < 0) return 'waiting';
  return 'answering';
}

function leaderboard(room) {
  return [...room.players.values()]
    .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
    .map((p, i) => ({
      rank: i + 1,
      playerId: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      streak: p.streak,
    }));
}

/* ---------------- dashboard live (untuk guru) ---------------- */

function dashboardPayload(room) {
  const total = room.quiz.questions.length;
  return {
    state: room.state,
    quizTitle: room.quiz.title,
    totalQuestions: total,
    elapsedMs: room.startedAt ? (room.finishedAt || Date.now()) - room.startedAt : 0,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      qIndex: p.qIndex, // -1 = belum mulai
      status: playerStatus(p),
      progressPct: p.finishedAt ? 100 : Math.round((Math.max(0, p.qIndex) / total) * 100),
      connected: p.connected,
    })),
    questionStats: room.questionStats,
    // referensi kunci jawaban untuk guru
    questions: room.quiz.questions.map((q) => ({
      text: q.text,
      correct: q.options[q.correct],
      points: q.points,
      timeLimit: q.timeLimit,
    })),
    liveStandings: leaderboard(room).map((r) => ({ rank: r.rank, name: r.name, color: r.color, score: r.score })),
  };
}

function emitDashboard(room) {
  const sock = io.sockets.sockets.get(room.hostSocketId);
  if (sock) sock.emit('host:dashboard', dashboardPayload(room));
}

/* ---------------- game loop: mode mandiri ---------------- */

function resetGame(room) {
  room.state = 'lobby';
  room.startedAt = 0;
  room.finishedAt = 0;
  room.questionStats = [];
  for (const p of [...room.players.values()]) {
    if (p.expireTimer) clearTimeout(p.expireTimer);
    if (p.advanceTimer) clearTimeout(p.advanceTimer);
    p.expireTimer = null;
    p.advanceTimer = null;
    if (!p.connected) {
      removePlayer(room, p.id); // buang pemain yang tidak kembali
      continue;
    }
    p.score = 0;
    p.streak = 0;
    p.bestStreak = 0;
    p.review = [];
    p.lastResult = null;
    p.qIndex = -1;
    p.order = [];
    p.currentOptions = [];
    p.questionEndsAt = 0;
    p.answeredCurrent = false;
    p.finishedAt = null;
  }
}

function startGame(room) {
  const active = [...room.players.values()].filter((p) => p.connected);
  if (active.length === 0) return { ok: false, error: 'Belum ada pemain yang bergabung.' };
  resetGame(room);
  room.state = 'playing';
  room.startedAt = Date.now();
  room.finishedAt = 0;
  room.questionStats = room.quiz.questions.map(() => ({ answered: 0, correct: 0 }));
  for (const p of room.players.values()) {
    if (!p.connected) continue;
    initPlayerRun(room, p);
  }
  emitDashboard(room);
  return { ok: true };
}

// mulai progresi seorang pemain dari soal pertama
function initPlayerRun(room, player) {
  player.qIndex = 0;
  player.order = room.quiz.questions.map((_, i) => i);
  if (room.quiz.settings.shuffleQuestions) player.order = shuffle(player.order);
  sendQuestion(room, player);
}

// kirim soal aktif ke pemain; opts.resend = kirim ulang tanpa reset waktu (dipakai saat rejoin)
function sendQuestion(room, player, opts = {}) {
  const q = room.quiz.questions[player.order[player.qIndex]];
  if (!q) return;

  if (!opts.resend) {
    let optionIdx = [0, 1, 2, 3];
    if (room.quiz.settings.shuffleOptions) optionIdx = shuffle(optionIdx);
    player.currentOptions = optionIdx.map((i) => ({ original: i, text: q.options[i] }));
    player.questionEndsAt = Date.now() + q.timeLimit * 1000;
    player.answeredCurrent = false;
  }

  const sock = socketOf(player.id);
  if (sock) {
    sock.emit('game:question', {
      index: player.qIndex + 1,
      total: player.order.length,
      text: q.text,
      options: player.currentOptions.map((o) => o.text),
      timeLimit: q.timeLimit,
      points: q.points,
      endsAt: player.questionEndsAt,
    });
  }

  // timer kedaluwarsa per pemain
  if (player.expireTimer) clearTimeout(player.expireTimer);
  const delay = Math.max(0, player.questionEndsAt + ANSWER_GRACE_MS - Date.now());
  player.expireTimer = setTimeout(() => {
    if (room.state === 'playing' && !player.answeredCurrent && !player.finishedAt && player.qIndex >= 0) {
      submitAnswer(room, player, null); // waktu habis → 0 poin
    }
  }, delay);
}

// optionIndex null = tidak menjawab (waktu habis)
function submitAnswer(room, player, optionIndex) {
  if (room.state !== 'playing' || player.finishedAt) return;
  if (player.answeredCurrent || player.qIndex < 0) return;

  const q = room.quiz.questions[player.order[player.qIndex]];
  const limitMs = q.timeLimit * 1000;
  const now = Date.now();
  const remaining = Math.min(limitMs, Math.max(0, player.questionEndsAt - now));
  const used = (limitMs - remaining) / 1000;

  const answered =
    optionIndex !== null && optionIndex !== undefined &&
    Number.isInteger(optionIndex) && optionIndex >= 0 && optionIndex <= 3 &&
    now <= player.questionEndsAt + ANSWER_GRACE_MS;
  const correct = answered && player.currentOptions[optionIndex].original === q.correct;
  const points = correct ? Math.max(1, Math.round(q.points * (1 - 0.5 * (used / q.timeLimit)))) : 0;

  player.answeredCurrent = true;
  if (player.expireTimer) {
    clearTimeout(player.expireTimer);
    player.expireTimer = null;
  }

  player.score += points;
  if (correct) {
    player.streak += 1;
    player.bestStreak = Math.max(player.bestStreak, player.streak);
  } else {
    player.streak = 0;
  }
  player.review.push({
    qIndex: player.qIndex + 1,
    text: q.text,
    yourOption: answered ? q.options[player.currentOptions[optionIndex].original] : null,
    correctOption: q.options[q.correct],
    correct,
    points,
    answered,
  });

  const stat = room.questionStats[player.qIndex];
  if (stat) {
    stat.answered += 1;
    if (correct) stat.correct += 1;
  }

  const correctPosition = player.currentOptions.findIndex((o) => o.original === q.correct);
  const result = {
    answered,
    correct,
    points,
    score: player.score,
    streak: player.streak,
    correctIndex: correctPosition,
    correctOption: q.options[q.correct],
    meme: correct ? MEMES[Math.floor(Math.random() * MEMES.length)] : 'Belum tepat',
    nextInMs: ADVANCE_DELAY_MS,
  };
  player.lastResult = result;

  const sock = socketOf(player.id);
  if (sock) sock.emit('game:answer_result', result);

  emitDashboard(room);

  // jadwalkan soal berikutnya secara OTOMATIS
  if (player.advanceTimer) clearTimeout(player.advanceTimer);
  player.advanceTimer = setTimeout(() => advancePlayer(room, player), ADVANCE_DELAY_MS);
}

function advancePlayer(room, player) {
  if (player.advanceTimer) {
    clearTimeout(player.advanceTimer);
    player.advanceTimer = null;
  }
  if (room.state !== 'playing' || player.finishedAt) return;

  player.qIndex += 1;
  if (player.qIndex >= player.order.length) {
    playerDone(room, player);
    return;
  }
  sendQuestion(room, player);
  emitDashboard(room);
}

function playerDone(room, player) {
  player.finishedAt = Date.now();
  player.qIndex = player.order.length; // tandai posisi = selesai
  if (player.expireTimer) {
    clearTimeout(player.expireTimer);
    player.expireTimer = null;
  }
  const sock = socketOf(player.id);
  if (sock) {
    sock.emit('game:player_done', {
      score: player.score,
      bestStreak: player.bestStreak,
      standings: leaderboard(room),
    });
  }
  emitDashboard(room);
  maybeFinish(room);
}

function maybeFinish(room) {
  if (room.state !== 'playing') return;
  const players = [...room.players.values()];
  if (players.length === 0) return;
  if (players.every((p) => p.finishedAt)) finishGame(room);
}

function fullReview(room, player) {
  return player.order.map((qIdx, i) => {
    const answered = player.review.find((r) => r.qIndex === i + 1);
    if (answered) return answered;
    const q = room.quiz.questions[qIdx];
    return {
      qIndex: i + 1,
      text: q.text,
      yourOption: null,
      correctOption: q.options[q.correct],
      correct: false,
      points: 0,
      answered: false,
    };
  });
}

function sendFinishedTo(room, player) {
  const sock = socketOf(player.id);
  if (!sock) return;
  const rows = leaderboard(room);
  const rank = rows.find((r) => r.playerId === player.id);
  sock.emit('game:finished', {
    podium: rows.slice(0, 3),
    rows,
    you: {
      rank: rank ? rank.rank : rows.length,
      score: player.score,
      bestStreak: player.bestStreak,
      review: fullReview(room, player),
    },
  });
}

function finishGame(room) {
  if (room.state === 'finished') return;
  room.state = 'finished';
  room.finishedAt = Date.now();
  for (const p of room.players.values()) {
    if (p.expireTimer) clearTimeout(p.expireTimer);
    if (p.advanceTimer) clearTimeout(p.advanceTimer);
  }
  for (const p of room.players.values()) sendFinishedTo(room, p);
  const hostSock = io.sockets.sockets.get(room.hostSocketId);
  if (hostSock) {
    hostSock.emit('game:finished_host', {
      podium: leaderboard(room).slice(0, 3),
      rows: leaderboard(room),
      questionStats: room.questionStats,
    });
  }
  emitDashboard(room);
}

/* ---------- snapshot state (untuk rejoin) ---------- */

function playerRejoinSnapshot(room, player) {
  const sock = socketOf(player.id);
  if (!sock) return;

  if (room.state === 'finished') {
    sendFinishedTo(room, player);
    return;
  }
  if (room.state === 'lobby') return; // menunggu guru mulai

  // state playing
  if (player.finishedAt) {
    sock.emit('game:player_done', {
      score: player.score,
      bestStreak: player.bestStreak,
      standings: leaderboard(room),
    });
    return;
  }
  if (player.qIndex < 0) {
    // belum pernah mulai (join saat permainan berjalan / putus saat start)
    initPlayerRun(room, player);
    emitDashboard(room);
    return;
  }
  if (player.answeredCurrent) {
    // sedang dalam jeda 3 detik → kirim ulang hasil; advanceTimer yang berjalan akan mengirim soal berikutnya
    if (player.lastResult) sock.emit('game:answer_result', player.lastResult);
    return;
  }
  // belum menjawab: kalau waktu sudah habis saat offline → timeout; kalau masih ada → kirim ulang soal
  if (Date.now() > player.questionEndsAt + ANSWER_GRACE_MS) {
    submitAnswer(room, player, null);
  } else {
    sendQuestion(room, player, { resend: true });
  }
}

/* socket registry: playerId === socketId */
function socketOf(playerId) {
  return io.sockets.sockets.get(playerId) || null;
}

/* ---------------- http + socket ---------------- */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  /* ---- autentikasi admin ---- */

  socket.on('admin:login', ({ password }, ack) => {
    if (String(password == null ? '' : password) !== ADMIN_PASSWORD) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Password salah.' });
      return;
    }
    const token = crypto.randomBytes(24).toString('hex');
    adminTokens.add(token);
    socket.data.adminToken = token;
    if (typeof ack === 'function') ack({ ok: true, token });
  });

  socket.on('host:logout', () => {
    if (socket.data.adminToken) adminTokens.delete(socket.data.adminToken);
    socket.data.adminToken = null;
  });

  // lanjutkan sesi guru di socket baru (setelah redirect/pindah halaman)
  socket.on('admin:resume', ({ token }, ack) => {
    if (token && adminTokens.has(String(token))) {
      socket.data.adminToken = String(token);
      if (typeof ack === 'function') ack({ ok: true });
    } else {
      if (typeof ack === 'function') ack({ ok: false, error: 'Sesi guru berakhir.' });
    }
  });

  function isAdmin() {
    return !!(socket.data.adminToken && adminTokens.has(socket.data.adminToken));
  }

  function hostRoom() {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostSocketId !== socket.id) return null;
    return room;
  }

  /* ---- host: kuis ---- */

  socket.on('host:list_quizzes', (payload, ack) => {
    if (!isAdmin()) {
      if (typeof ack === 'function') ack([]);
      return;
    }
    if (typeof ack === 'function') ack(loadQuizzes().map((q) => ({ id: q.id, title: q.title, count: q.questions.length })));
  });

  socket.on('host:save_quiz', (input, ack) => {
    if (!isAdmin()) {
      if (typeof ack === 'function') ack({ ok: false, errors: ['Sesi guru berakhir. Silakan login kembali.'] });
      return;
    }
    const v = validateQuiz(input);
    if (!v.ok) {
      if (typeof ack === 'function') ack({ ok: false, errors: v.errors });
      return;
    }
    const list = loadQuizzes();
    const quiz = { id: `k${Date.now()}${Math.random().toString(36).slice(2, 6)}`, ...v.quiz, createdAt: new Date().toISOString() };
    list.push(quiz);
    persistQuizzes(list);
    if (typeof ack === 'function') ack({ ok: true, quizId: quiz.id });
  });

  socket.on('host:delete_quiz', ({ quizId }, ack) => {
    if (!isAdmin()) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Sesi guru berakhir.' });
      return;
    }
    persistQuizzes(loadQuizzes().filter((q) => q.id !== quizId));
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('host:create_room', ({ quizId }, ack) => {
    if (!isAdmin()) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Sesi guru berakhir. Silakan login kembali.' });
      return;
    }
    const quiz = loadQuizzes().find((q) => q.id === quizId);
    if (!quiz) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Kuis tidak ditemukan.' });
      return;
    }
    const room = createRoom(quiz);
    room.hostSocketId = socket.id;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.role = 'host';
    if (typeof ack === 'function') ack({ ok: true, code: room.code });
    prepareJoinInfo(room, socket); // emit room:lobby + QR setelah siap
  });

  socket.on('host:rejoin', ({ code, token }, ack) => {
    if (!token || !adminTokens.has(String(token))) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Sesi guru tidak valid. Login kembali.' });
      return;
    }
    socket.data.adminToken = String(token);
    const room = rooms.get(String(code || ''));
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Room tidak ditemukan.' });
      return;
    }
    room.hostSocketId = socket.id;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.role = 'host';
    if (typeof ack === 'function') ack({ ok: true, state: room.state });
    if (room.qr) {
      socket.emit('room:lobby', lobbyPayload(room));
    } else {
      prepareJoinInfo(room, socket); // QR belum ada (server pernah restart) → buat ulang
    }
    emitDashboard(room);
  });

  /* ---- host: kontrol permainan ---- */

  socket.on('host:start', () => {
    const room = hostRoom();
    if (!room || !isAdmin()) return;
    const res = startGame(room);
    if (!res.ok) socket.emit('host:error', res.error);
  });

  // akhiri kuis lebih awal → semua pemain langsung lihat hasil akhir
  socket.on('host:end_game', () => {
    const room = hostRoom();
    if (!room || !isAdmin()) return;
    if (room.state === 'playing') finishGame(room);
  });

  socket.on('host:play_again', () => {
    const room = hostRoom();
    if (!room || !isAdmin()) return;
    resetGame(room);
    io.to(room.code).emit('game:reset');
    io.to(room.code).emit('room:lobby', lobbyPayload(room));
    emitDashboard(room);
  });

  socket.on('host:kick', ({ playerId }) => {
    const room = hostRoom();
    if (!room || !isAdmin()) return;
    const sock = socketOf(playerId);
    if (room.players.has(playerId)) {
      removePlayer(room, playerId);
      if (sock) {
        sock.leave(room.code);
        sock.emit('player:kicked');
      }
      io.to(room.code).emit('room:lobby', lobbyPayload(room));
      io.to(room.code).emit('host:player_left', { playerId });
      emitDashboard(room);
      maybeFinish(room);
    }
  });

  /* ---- player ---- */

  socket.on('player:join', ({ code, name, color }, ack) => {
    const room = rooms.get(String(code || '').trim());
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Kode room tidak ditemukan.' });
      return;
    }
    if (room.state === 'finished') {
      if (typeof ack === 'function') ack({ ok: false, error: 'Permainan sudah selesai.' });
      return;
    }
    const playerName = clean(name, 20);
    if (!playerName) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Nama wajib diisi.' });
      return;
    }
    if ([...room.players.values()].some((p) => p.name.toLowerCase() === playerName.toLowerCase())) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Nama sudah dipakai pemain lain.' });
      return;
    }
    const player = {
      id: socket.id,
      name: playerName,
      color: AVATAR_COLORS.includes(color) ? color : AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      score: 0,
      streak: 0,
      bestStreak: 0,
      joinedAt: Date.now(),
      review: [],
      lastResult: null,
      connected: true,
      removeTimer: null,
      // progresi mandiri
      qIndex: -1,
      order: [],
      currentOptions: [],
      questionEndsAt: 0,
      answeredCurrent: false,
      expireTimer: null,
      advanceTimer: null,
      finishedAt: null,
    };
    room.players.set(socket.id, player);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.role = 'player';
    if (typeof ack === 'function') ack({ ok: true, playerId: player.id, color: player.color, state: room.state });
    io.to(room.code).emit('room:lobby', lobbyPayload(room));
    emitDashboard(room);

    // join terlambat saat kuis berjalan → langsung mulai dari soal 1
    if (room.state === 'playing') {
      initPlayerRun(room, player);
      emitDashboard(room);
    }
  });

  // pemain refresh halaman di tengah permainan → rejoin dengan nama yang sama
  socket.on('player:rejoin', ({ code, name }, ack) => {
    const room = rooms.get(String(code || '').trim());
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Room tidak ditemukan.' });
      return;
    }
    const playerName = clean(name, 20).toLowerCase();
    const existing = [...room.players.values()].find((p) => p.name.toLowerCase() === playerName);
    if (!existing) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Kamu tidak terdaftar di room ini.' });
      return;
    }
    // pindahkan entry pemain ke socket baru (id pemain = socket id)
    room.players.delete(existing.id);
    existing.id = socket.id;
    existing.connected = true;
    if (existing.removeTimer) {
      clearTimeout(existing.removeTimer);
      existing.removeTimer = null;
    }
    room.players.set(socket.id, existing);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.role = 'player';
    if (typeof ack === 'function') ack({ ok: true, playerId: socket.id, color: existing.color, state: room.state });
    io.to(room.code).emit('room:lobby', lobbyPayload(room));
    emitDashboard(room);
    playerRejoinSnapshot(room, existing);
  });

  socket.on('player:answer', ({ optionIndex }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'player') return;
    const player = room.players.get(socket.id);
    if (!player) return;
    submitAnswer(room, player, optionIndex);
  });

  let lastReaction = 0;
  socket.on('player:reaction', ({ icon }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'player') return;
    const now = Date.now();
    if (now - lastReaction < 400) return;
    lastReaction = now;
    const player = room.players.get(socket.id);
    if (!player) return;
    // icon = markup SVG dari klien; batasi panjang & buang tag berisiko
    const safeIcon = String(icon || '')
      .slice(0, 800)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/ on\w+="[^"]*"/gi, '');
    io.to(room.code).emit('reaction', { playerId: player.id, name: player.name, icon: safeIcon });
  });

  /* ---- disconnect ---- */

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (socket.data.role === 'player' && room.players.has(socket.id)) {
      const player = room.players.get(socket.id);
      // jangan langsung buang: beri kesempatan rejoin (refresh halaman)
      player.connected = false;
      if (player.removeTimer) clearTimeout(player.removeTimer);
      player.removeTimer = setTimeout(() => {
        removePlayer(room, player.id);
        io.to(room.code).emit('room:lobby', lobbyPayload(room));
        io.to(room.code).emit('host:player_left', { playerId: player.id });
        emitDashboard(room);
        maybeFinish(room);
      }, DISCONNECT_GRACE_MS);
      io.to(room.code).emit('room:lobby', lobbyPayload(room));
      io.to(room.code).emit('host:player_left', { playerId: socket.id });
      emitDashboard(room);
    }
    if (socket.data.role === 'host' && room.hostSocketId === socket.id) {
      room.hostSocketId = null; // room tetap hidup, guru bisa rejoin dengan token
    }
  });
});

server.listen(PORT, () => {
  console.log(`KuisLive berjalan di http://localhost:${PORT}`);
  console.log(`Password guru: ${ADMIN_PASSWORD === 'guru123' ? 'guru123 (default — ganti via env ADMIN_PASSWORD)' : '(dari env ADMIN_PASSWORD)'}`);
});
