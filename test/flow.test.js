'use strict';

/**
 * Integration test KuisLive 2.0 (mode mandiri + auth admin):
 * 1 guru (login password) + 4 siswa memainkan kuis 2 soal.
 * Setiap siswa menjawab dengan tempo sendiri → hasil → 3 detik → soal berikutnya OTOMATIS.
 *
 * Jalankan: npm test  (server harus berjalan di port 3000)
 *
 * Pola: SEMUA listener didaftarkan SEBELUM event pemicu dikirim,
 * agar tidak ada event yang terlewat karena race condition.
 */

const { io } = require('socket.io-client');

const URL = process.env.URL || 'http://localhost:3000';
const PASSWORD = process.env.ADMIN_PASSWORD || 'guru123';
let failed = 0;
let total = 0;

function check(name, cond, extra = '') {
  total++;
  const ok = !!cond;
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function once(socket, event, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout menunggu event "${event}"`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main() {
  /* ---------- 1. Autentikasi admin ---------- */
  const host = io(URL, { transports: ['websocket'] });
  await once(host, 'connect');

  const badLogin = await new Promise((r) => host.emit('admin:login', { password: 'salah' }, r));
  check('auth: password salah ditolak', !badLogin.ok, badLogin.error || '');

  const goodLogin = await new Promise((r) => host.emit('admin:login', { password: PASSWORD }, r));
  check('auth: password benar diterima', goodLogin.ok && !!goodLogin.token, goodLogin.error || '');
  const token = goodLogin.token;

  // aksi host dari socket yang TIDAK login harus ditolak
  const stranger = io(URL, { transports: ['websocket'] });
  await once(stranger, 'connect');
  const noToken = await new Promise((r) => stranger.emit('host:list_quizzes', {}, r));
  check('auth: aksi host tanpa login ditolak', Array.isArray(noToken) && noToken.length === 0);
  stranger.close();

  /* ---------- 2. Simpan kuis & buat room ---------- */
  const quiz = {
    title: 'Kuis Barudak Darul Bren Macum',
    questions: [
      { text: 'Siapa presiden pertama RI?', options: ['Soekarno', 'Hatta', 'Soeharto', 'Megawati'], correct: 0, timeLimit: 5, points: 500 },
      { text: '2 + 2 = ?', options: ['3', '4', '5', '6'], correct: 1, timeLimit: 30, points: 1000 },
    ],
    settings: { shuffleQuestions: false, shuffleOptions: false },
  };

  const saveRes = await new Promise((r) => host.emit('host:save_quiz', { ...quiz, token }, r));
  check('host: simpan kuis', saveRes.ok, saveRes.errors ? saveRes.errors.join('; ') : saveRes.error || '');

  const roomRes = await new Promise((r) => host.emit('host:create_room', { quizId: saveRes.quizId, token }, r));
  check('host: buat room', roomRes.ok, roomRes.error || '');
  const code = roomRes.code;
  check('host: kode room 6 digit', /^\d{6}$/.test(code), code);

  /* ---------- 3. Empat siswa join ---------- */
  const players = {};
  for (const name of ['Budi', 'Siti', 'Andi', 'Cici']) {
    const s = io(URL, { transports: ['websocket'] });
    await once(s, 'connect');
    const res = await new Promise((r) => s.emit('player:join', { code, name }, r));
    check(`siswa: ${name} join`, res.ok, res.error || '');
    players[name] = s;
  }

  const dup = io(URL, { transports: ['websocket'] });
  await once(dup, 'connect');
  const dupRes = await new Promise((r) => dup.emit('player:join', { code, name: 'budi' }, r));
  check('siswa: nama ganda ditolak', !dupRes.ok, dupRes.error || '');
  dup.close();

  const badCode = io(URL, { transports: ['websocket'] });
  await once(badCode, 'connect');
  const badRes = await new Promise((r) => badCode.emit('player:join', { code: '000000', name: 'X' }, r));
  check('siswa: kode salah ditolak', !badRes.ok && /tidak ditemukan/i.test(badRes.error), badRes.error);
  badCode.close();

  // listener lobby & dashboard aktif sejak sebelum start
  let latestLobby = null;
  let latestDash = null;
  host.on('room:lobby', (d) => { latestLobby = d; });
  host.on('host:dashboard', (d) => { latestDash = d; });

  /* ---------- 4. Mulai kuis → semua siswa dapat soal 1 ---------- */
  const q1Host = once(host, 'host:dashboard'); // dashboard update saat start
  const q1Listeners = {};
  for (const name of Object.keys(players)) q1Listeners[name] = once(players[name], 'game:question');

  host.emit('host:start', { token });
  const q1s = {};
  for (const name of Object.keys(players)) q1s[name] = await q1Listeners[name];
  check('game: semua siswa menerima soal 1', Object.values(q1s).every((q) => q.index === 1 && q.total === 2));
  await q1Host;
  check('dashboard: state playing', latestDash && latestDash.state === 'playing', latestDash && latestDash.state);
  check('dashboard: 4 siswa terdaftar', latestDash && latestDash.players.length === 4, latestDash && String(latestDash.players.length));

  /* ---------- 5. Jawab dengan tempo berbeda → skor berbeda ---------- */
  // daftarkan listener SEBELUM menjawab
  const resBudi = once(players.Budi, 'game:answer_result');
  const resSiti = once(players.Siti, 'game:answer_result');
  const resAndi = once(players.Andi, 'game:answer_result');
  const resCici = once(players.Cici, 'game:answer_result');
  const q2Budi = once(players.Budi, 'game:question'); // auto-advance Budi

  players.Budi.emit('player:answer', { optionIndex: 0 }); // benar, cepat
  await sleep(400);
  players.Siti.emit('player:answer', { optionIndex: 0 }); // benar, lebih lambat
  await sleep(400);
  players.Andi.emit('player:answer', { optionIndex: 2 }); // salah
  // Cici sengaja tidak menjawab → waktu habis

  const rBudi = await resBudi;
  const rSiti = await resSiti;
  const rAndi = await resAndi;
  check('skor: Budi benar cepat ≈ 500', rBudi.correct && rBudi.points >= 470 && rBudi.points <= 500, `+${rBudi.points}`);
  check('skor: Siti benar lebih lambat < Budi', rSiti.correct && rSiti.points < rBudi.points, `+${rSiti.points}`);
  check('skor: Andi salah = 0', !rAndi.correct && rAndi.points === 0, `+${rAndi.points}`);

  /* ---------- 6. Mode mandiri: Budi auto-advance tanpa menunggu yang lain ---------- */
  const q2B = await q2Budi; // Budi dapat soal 2 setelah ±3 detik
  check('mandiri: Budi otomatis dapat soal 2', q2B.index === 2, `soal ${q2B.index}`);
  await sleep(300);
  check('mandiri: Andi masih di soal 1 (progresi independen)',
    latestDash && latestDash.players.find((p) => p.name === 'Andi').qIndex === 0,
    latestDash && JSON.stringify(latestDash.players.map((p) => `${p.name}:${p.qIndex}`)));

  // Cici tidak menjawab → timeout otomatis
  const rCici = await resCici;
  check('mandiri: Cici timeout = 0 poin', !rCici.answered && rCici.points === 0, `answered=${rCici.answered}`);

  /* ---------- 7. Budi selesai lebih dulu → player_done + klasemen live ---------- */
  const doneBudi = once(players.Budi, 'game:player_done');
  players.Budi.emit('player:answer', { optionIndex: 1 }); // benar
  const dBudi = await doneBudi;
  check('mandiri: Budi selesai → dapat klasemen live', dBudi.standings.length === 4, `${dBudi.standings.length} pemain`);
  check('mandiri: Budi peringkat 1 sementara', dBudi.standings[0].name === 'Budi', dBudi.standings.map((s) => s.name).join(', '));

  // Budi belum boleh menerima game:finished (yang lain masih main)
  let budiFinishedEarly = false;
  players.Budi.once('game:finished', () => { budiFinishedEarly = true; });
  await sleep(500);
  check('mandiri: Budi belum dapat hasil akhir saat yang lain masih main', !budiFinishedEarly);

  /* ---------- 8. Siswa lain menyelesaikan → semua selesai → podium ---------- */
  const finHost = once(host, 'game:finished_host');
  const finBudi = once(players.Budi, 'game:finished');

  players.Siti.emit('player:answer', { optionIndex: 1 }); // benar
  players.Andi.emit('player:answer', { optionIndex: 1 }); // benar
  players.Cici.emit('player:answer', { optionIndex: 1 }); // benar

  const finH = await finHost;
  check('finish: podium 3 orang', finH.podium.length === 3, finH.podium.map((p) => p.name).join(', '));
  check('finish: juara 1 = Budi', finH.podium[0].name === 'Budi');
  check('finish: statistik per soal lengkap', finH.questionStats.length === 2, JSON.stringify(finH.questionStats));

  const finB = await finBudi;
  check('finish: Budi peringkat 1', finB.you.rank === 1, `#${finB.you.rank}`);
  check('finish: review Budi 2 soal, semua benar', finB.you.review.length === 2 && finB.you.review.every((r) => r.correct));

  /* ---------- 9. Main lagi → lobby, skor reset ---------- */
  const resetP = once(players.Budi, 'game:reset');
  const lobbyP = once(host, 'room:lobby');
  host.emit('host:play_again', { token });
  await resetP;
  await lobbyP;
  check('play again: kembali ke lobby', latestLobby && latestLobby.players.length === 4, `${latestLobby && latestLobby.players.length} pemain`);

  /* ---------- 10. Rejoin guru + akhiri paksa ---------- */
  host.close();
  const host2 = io(URL, { transports: ['websocket'] });
  await once(host2, 'connect');
  // host1 sudah ditutup → listener lobby/dashboard pindah ke host2
  host2.on('room:lobby', (d) => { latestLobby = d; });
  host2.on('host:dashboard', (d) => { latestDash = d; });
  const rejHost = await new Promise((r) => host2.emit('host:rejoin', { code, token }, r));
  check('rejoin: guru bisa rejoin dengan token', rejHost.ok, rejHost.error || '');
  const rejHostBad = await new Promise((r) => host2.emit('host:rejoin', { code, token: 'ngawang' }, r));
  check('rejoin: token salah ditolak', !rejHostBad.ok, rejHostBad.error || '');

  // mulai lagi, lalu akhiri paksa saat siswa mid-soal
  const q1b = {};
  for (const name of Object.keys(players)) q1b[name] = once(players[name], 'game:question');
  host2.emit('host:start', { token });
  for (const name of Object.keys(players)) await q1b[name];
  players.Budi.emit('player:answer', { optionIndex: 0 });

  const finHost2 = once(host2, 'game:finished_host');
  const finSiti = once(players.Siti, 'game:finished');
  host2.emit('host:end_game', { token }); // akhiri paksa
  const finH2 = await finHost2;
  check('end game: guru akhiri paksa → podium keluar', finH2.podium.length === 3, finH2.podium.map((p) => p.name).join(', '));
  const finS = await finSiti;
  check('end game: siswa mid-soal tetap dapat hasil akhir', finS.you.review.length === 2, `review ${finS.you.review.length} soal`);
  check('end game: Budi juara (satu-satunya menjawab)', finH2.podium[0].name === 'Budi', finH2.podium[0].name);

  /* ---------- 11. Join setelah selesai ditolak ---------- */
  const late = io(URL, { transports: ['websocket'] });
  await once(late, 'connect');
  const lateRes = await new Promise((r) => late.emit('player:join', { code, name: 'Dedi' }, r));
  check('join: setelah selesai ditolak', !lateRes.ok, lateRes.error || '');
  late.close();

  /* ---------- 12. Kick pemain ---------- */
  host2.emit('host:play_again', { token });
  await sleep(300);
  const kickedP = once(players.Cici, 'player:kicked');
  host2.emit('host:kick', { playerId: players.Cici.id }, () => {});
  await kickedP;
  await sleep(300);
  check('kick: pemain dikeluarkan', latestLobby && latestLobby.players.length === 3, `${latestLobby && latestLobby.players.length} pemain`);

  /* ---------- cleanup ---------- */
  host2.close();
  Object.values(players).forEach((s) => s.close());

  console.log('\n======================= RINGKASAN =======================');
  console.log(`Total: ${total} check, gagal: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ TEST ERROR:', err.message);
  process.exit(1);
});
