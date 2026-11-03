'use strict';

/**
 * KuisLive — server kuis multiplayer real-time (ala Quizizz)
 * Express + Socket.IO, state room disimpan in-memory, kuis disimpan ke data/quizzes.json
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const QUIZ_FILE = path.join(DATA_DIR, 'quizzes.json');

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];
const MEMES = ['Keren!', 'Hebat!', 'Luar biasa!', 'Mantap!', 'Cepat sekali!', 'Hampir!', 'Jangan menyerah!', 'Coba lagi ya!'];

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
    state: 'lobby', // lobby | question | reveal | leaderboard | finished
    qIndex: -1,
    order: [],
    currentOptions: [], // opsi yang sedang tampil (mungkin sudah diacak)
    answers: new Map(), // playerId -> {option, correct, points, elapsed}
    questionEndsAt: 0,
    timer: null,
    lastGain: new Map(), // playerId -> poin round terakhir
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

// jumlah pemain yang masih perlu menjawab soal aktif
function pendingCount(room) {
  let n = 0;
  for (const p of room.players.values()) {
    if (p.connected && !room.answers.has(p.id)) n++;
  }
  return n;
}

function removePlayer(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) return;
  if (player.removeTimer) {
    clearTimeout(player.removeTimer);
    player.removeTimer = null;
  }
  room.players.delete(playerId);
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
      delta: room.lastGain.get(p.id) || 0,
      streak: p.streak,
    }));
}

function resetGame(room) {
  room.state = 'lobby';
  room.qIndex = -1;
  room.order = [];
  room.answers.clear();
  room.lastGain.clear();
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  // buang pemain yang tidak kembali (koneksi terputus) saat memulai game baru
  for (const p of [...room.players.values()]) {
    if (!p.connected) removePlayer(room, p.id);
  }
  for (const p of room.players.values()) {
    p.score = 0;
    p.streak = 0;
    p.bestStreak = 0;
    p.review = [];
  }
}

function startGame(room) {
  if (room.players.size === 0) return { ok: false, error: 'Belum ada pemain yang bergabung.' };
  resetGame(room);
  room.order = room.quiz.questions.map((_, i) => i);
  if (room.quiz.settings.shuffleQuestions) room.order = shuffle(room.order);
  nextQuestion(room);
  return { ok: true };
}

function nextQuestion(room) {
  room.qIndex += 1;
  if (room.qIndex >= room.order.length) {
    finishGame(room);
    return;
  }
  const q = room.quiz.questions[room.order[room.qIndex]];
  room.answers.clear();
  room.lastGain.clear();

  let optionIdx = [0, 1, 2, 3];
  if (room.quiz.settings.shuffleOptions) optionIdx = shuffle(optionIdx);
  room.currentOptions = optionIdx.map((i) => ({ original: i, text: q.options[i] }));
  const correctPosition = optionIdx.indexOf(q.correct);

  room.questionEndsAt = Date.now() + q.timeLimit * 1000;
  room.state = 'question';

  io.to(room.code).emit('game:question', {
    index: room.qIndex + 1,
    total: room.order.length,
    text: q.text,
    options: room.currentOptions.map((o) => o.text),
    timeLimit: q.timeLimit,
    points: q.points,
    endsAt: room.questionEndsAt,
  });

  room.timer = setTimeout(() => endQuestion(room), q.timeLimit * 1000 + 750);
}

function submitAnswer(room, player, qIndex, optionIndex) {
  if (room.state !== 'question' || qIndex !== room.qIndex) return { ok: false, error: 'Soal sudah ditutup.' };
  if (room.answers.has(player.id)) return { ok: false, error: 'Kamu sudah menjawab.' };
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) return { ok: false, error: 'Jawaban tidak valid.' };

  const now = Date.now();
  const q = room.quiz.questions[room.order[room.qIndex]];
  const limitMs = q.timeLimit * 1000;
  // waktu terpakai = batas waktu - sisa waktu (dibatasi 0..limit)
  const remaining = Math.min(limitMs, Math.max(0, room.questionEndsAt - now));
  const used = (limitMs - remaining) / 1000;

  const correct = room.currentOptions[optionIndex].original === q.correct;
  const points = correct ? Math.max(1, Math.round(q.points * (1 - 0.5 * (used / q.timeLimit)))) : 0;

  player.score += points;
  if (correct) {
    player.streak += 1;
    player.bestStreak = Math.max(player.bestStreak, player.streak);
  } else {
    player.streak = 0;
  }
  player.review.push({
    qIndex: room.qIndex + 1,
    text: q.text,
    yourOption: q.options[room.currentOptions[optionIndex].original],
    correctOption: q.options[q.correct],
    correct,
    points,
  });

  room.answers.set(player.id, { option: optionIndex, correct, points, elapsed: used });
  room.lastGain.set(player.id, points);

  io.to(room.code).emit('game:progress', { answered: room.answers.size, total: room.players.size });
  socketOf(player.id) && socketOf(player.id).emit('game:answer_ack', { ok: true });

  // tutup soal begitu tidak ada pemain aktif yang belum menjawab
  if (pendingCount(room) === 0) {
    endQuestion(room);
  }
  return { ok: true };
}

function revealData(room) {
  const q = room.quiz.questions[room.order[room.qIndex]];
  const correctPosition = room.currentOptions.findIndex((o) => o.original === q.correct);
  const optionCounts = [0, 0, 0, 0];
  for (const a of room.answers.values()) optionCounts[a.option] += 1;
  return { q, correctPosition, optionCounts };
}

function youReveal(room, player) {
  const a = room.answers.get(player.id);
  return {
    answered: !!a,
    correct: a ? a.correct : false,
    points: a ? a.points : 0,
    score: player.score,
    streak: player.streak,
    meme: a && a.correct ? MEMES[Math.floor(Math.random() * MEMES.length)] : 'Belum tepat',
  };
}

function hostReveal(room) {
  const { correctPosition, optionCounts } = revealData(room);
  return {
    correctIndex: correctPosition,
    optionCounts,
    results: [...room.players.values()].map((p) => {
      const a = room.answers.get(p.id);
      return {
        playerId: p.id,
        name: p.name,
        color: p.color,
        answered: !!a,
        correct: a ? a.correct : false,
        points: a ? a.points : 0,
        score: p.score,
      };
    }),
  };
}

function endQuestion(room) {
  if (room.state !== 'question') return;
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  room.state = 'reveal';

  const { q, correctPosition, optionCounts } = revealData(room);

  io.to(room.code).emit('game:reveal', {
    correctIndex: correctPosition,
    optionCounts,
    timeLimit: q.timeLimit,
    points: q.points,
  });

  // hasil personal per pemain
  for (const p of room.players.values()) {
    const sock = socketOf(p.id);
    if (!sock) continue;
    sock.emit('game:reveal_you', youReveal(room, p));
  }

  // ringkasan untuk host
  const hostSock = io.sockets.sockets.get(room.hostSocketId);
  if (hostSock) hostSock.emit('game:reveal_host', hostReveal(room));
}

function showLeaderboard(room) {
  if (room.state !== 'reveal') return;
  room.state = 'leaderboard';
  io.to(room.code).emit('game:leaderboard', { rows: leaderboard(room) });
}

function fullReview(room, player) {
  return room.order.map((qIdx, i) => {
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

function finishGame(room) {
  room.state = 'finished';
  const rows = leaderboard(room);
  const podium = rows.slice(0, 3);

  for (const p of room.players.values()) {
    const sock = socketOf(p.id);
    if (!sock) continue;
    const rank = rows.find((r) => r.playerId === p.id);
    sock.emit('game:finished', {
      podium,
      rows,
      you: {
        rank: rank ? rank.rank : rows.length,
        score: p.score,
        bestStreak: p.bestStreak,
        review: fullReview(room, p),
      },
    });
  }
  const hostSock = io.sockets.sockets.get(room.hostSocketId);
  if (hostSock) hostSock.emit('game:finished_host', { podium, rows });
}

/* ---------- snapshot state (untuk rejoin) ---------- */

function questionPayload(room, youAnswered) {
  const q = room.quiz.questions[room.order[room.qIndex]];
  return {
    index: room.qIndex + 1,
    total: room.order.length,
    text: q.text,
    options: room.currentOptions.map((o) => o.text),
    timeLimit: q.timeLimit,
    points: q.points,
    endsAt: room.questionEndsAt,
    youAnswered: !!youAnswered,
  };
}

// kirim ulang state permainan saat ini ke satu pemain (dipakai saat rejoin)
function playerSnapshot(room, player) {
  const sock = socketOf(player.id);
  if (!sock) return;
  // qIndex valid hanya saat ada soal aktif/terakhir; di state 'finished' qIndex == order.length
  const hasQuestion = room.qIndex >= 0 && room.qIndex < room.order.length;

  if (hasQuestion) {
    sock.emit('game:question', questionPayload(room, room.answers.has(player.id)));
  }

  if (hasQuestion && ['reveal', 'leaderboard', 'finished'].includes(room.state)) {
    const { q, correctPosition, optionCounts } = revealData(room);
    sock.emit('game:reveal', { correctIndex: correctPosition, optionCounts, timeLimit: q.timeLimit, points: q.points });
    sock.emit('game:reveal_you', youReveal(room, player));
  }
  if (['leaderboard', 'finished'].includes(room.state)) {
    sock.emit('game:leaderboard', { rows: leaderboard(room) });
  }
  if (room.state === 'finished') {
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
}

// kirim ulang state permainan saat ini ke host (dipakai saat rejoin)
function hostSnapshot(room) {
  const sock = io.sockets.sockets.get(room.hostSocketId);
  if (!sock) return;
  const hasQuestion = room.qIndex >= 0 && room.qIndex < room.order.length;

  if (hasQuestion) {
    sock.emit('game:question', questionPayload(room, false));
  }

  if (hasQuestion && ['reveal', 'leaderboard', 'finished'].includes(room.state)) {
    const { q, correctPosition, optionCounts } = revealData(room);
    sock.emit('game:reveal', { correctIndex: correctPosition, optionCounts, timeLimit: q.timeLimit, points: q.points });
    sock.emit('game:reveal_host', hostReveal(room));
  }
  if (['leaderboard', 'finished'].includes(room.state)) {
    sock.emit('game:leaderboard', { rows: leaderboard(room) });
  }
  if (room.state === 'finished') {
    const rows = leaderboard(room);
    sock.emit('game:finished_host', { podium: rows.slice(0, 3), rows });
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
  /* ---- host ---- */

  socket.on('host:list_quizzes', (ack) => {
    if (typeof ack === 'function') ack(loadQuizzes().map((q) => ({ id: q.id, title: q.title, count: q.questions.length })));
  });

  socket.on('host:save_quiz', (input, ack) => {
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
    const list = loadQuizzes().filter((q) => q.id !== quizId);
    persistQuizzes(list);
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('host:create_room', ({ quizId }, ack) => {
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

  socket.on('host:rejoin', ({ code }, ack) => {
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
    if (room.qIndex >= 0) {
      hostSnapshot(room);
      if (room.state === 'question') {
        socket.emit('game:progress', { answered: room.answers.size, total: room.players.size });
      }
    }
  });

  socket.on('host:start', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    const res = startGame(room);
    if (!res.ok) socket.emit('host:error', res.error);
  });

  socket.on('host:next', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.state === 'question') {
      endQuestion(room);
    } else if (room.state === 'reveal') {
      showLeaderboard(room);
    } else if (room.state === 'leaderboard') {
      nextQuestion(room);
    }
  });

  socket.on('host:play_again', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    resetGame(room);
    io.to(room.code).emit('game:reset');
    io.to(room.code).emit('room:lobby', lobbyPayload(room));
  });

  socket.on('host:kick', ({ playerId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    const sock = socketOf(playerId);
    if (room.players.has(playerId)) {
      removePlayer(room, playerId);
      if (sock) {
        sock.leave(room.code);
        sock.emit('player:kicked');
      }
      io.to(room.code).emit('room:lobby', lobbyPayload(room));
      io.to(room.code).emit('host:player_left', { playerId });
    }
  });

  /* ---- player ---- */

  socket.on('player:join', ({ code, name, color }, ack) => {
    const room = rooms.get(String(code || '').trim());
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Kode room tidak ditemukan.' });
      return;
    }
    if (room.state !== 'lobby') {
      if (typeof ack === 'function') ack({ ok: false, error: 'Permainan sudah dimulai.' });
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
      connected: true,
      removeTimer: null,
    };
    room.players.set(socket.id, player);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.role = 'player';
    if (typeof ack === 'function') ack({ ok: true, playerId: player.id, color: player.color });
    io.to(room.code).emit('room:lobby', lobbyPayload(room));
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
    if (room.answers.has(existing.id)) {
      room.answers.set(socket.id, room.answers.get(existing.id));
      room.answers.delete(existing.id);
    }
    if (room.lastGain.has(existing.id)) {
      room.lastGain.set(socket.id, room.lastGain.get(existing.id));
      room.lastGain.delete(existing.id);
    }
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
    playerSnapshot(room, existing);
  });

  socket.on('player:answer', ({ qIndex, optionIndex }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'player') return;
    const player = room.players.get(socket.id);
    if (!player) return;
    submitAnswer(room, player, qIndex, optionIndex);
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
      // jangan langsung buang: beri kesempatan rejoin (refresh halaman) selama 2 menit
      player.connected = false;
      if (player.removeTimer) clearTimeout(player.removeTimer);
      player.removeTimer = setTimeout(() => {
        removePlayer(room, player.id);
        io.to(room.code).emit('room:lobby', lobbyPayload(room));
        io.to(room.code).emit('host:player_left', { playerId: player.id });
      }, 120000);
      io.to(room.code).emit('room:lobby', lobbyPayload(room));
      io.to(room.code).emit('host:player_left', { playerId: socket.id });
      // kalau tidak ada pemain aktif yang belum menjawab, tutup soal
      if (room.state === 'question' && pendingCount(room) === 0 && room.players.size > 0) {
        endQuestion(room);
      }
    }
    if (socket.data.role === 'host' && room.hostSocketId === socket.id) {
      room.hostSocketId = null; // room tetap hidup, host bisa rejoin dengan kode
    }
  });
});

server.listen(PORT, () => {
  console.log(`KuisLive berjalan di http://localhost:${PORT}`);
});
