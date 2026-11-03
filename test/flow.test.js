'use strict';

/**
 * Integration test KuisLive:
 * mensimulasikan 1 host + 3 pemain memainkan satu kuis 2 soal dari awal sampai selesai.
 * Jalankan: npm test  (server harus berjalan di port 3000)
 *
 * Pola: SEMUA listener didaftarkan SEBELUM event pemicu dikirim,
 * agar tidak ada event yang terlewat karena race condition.
 */

const { io } = require('socket.io-client');

const URL = process.env.URL || 'http://localhost:3000';
let failed = 0;
let total = 0;

function check(name, cond, extra = '') {
  total++;
  const ok = !!cond;
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function once(socket, event, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout menunggu event "${event}"`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main() {
  /* ---------- 1. Host simpan kuis & buat room ---------- */
  const host = io(URL, { transports: ['websocket'] });
  await once(host, 'connect');

  const quiz = {
    title: 'Kuis Uji Coba',
    questions: [
      { text: 'Siapa presiden pertama RI?', options: ['Soekarno', 'Hatta', 'Soeharto', 'Megawati'], correct: 0, timeLimit: 30, points: 500 },
      { text: '2 + 2 = ?', options: ['3', '4', '5', '6'], correct: 1, timeLimit: 30, points: 1000 },
    ],
    settings: { shuffleQuestions: false, shuffleOptions: false },
  };

  const saveRes = await new Promise((r) => host.emit('host:save_quiz', quiz, r));
  check('host: simpan kuis', saveRes.ok, saveRes.errors ? saveRes.errors.join('; ') : '');

  const roomRes = await new Promise((r) => host.emit('host:create_room', { quizId: saveRes.quizId }, r));
  check('host: buat room', roomRes.ok, roomRes.error || '');
  const code = roomRes.code;
  check('host: kode room 6 digit', /^\d{6}$/.test(code), code);

  // listener lobby aktif SEBELUM pemain join agar tidak ketinggalan event
  let latestLobby = null;
  host.on('room:lobby', (d) => { latestLobby = d; });

  /* ---------- 2. Validasi join ---------- */
  const badCode = io(URL, { transports: ['websocket'] });
  await once(badCode, 'connect');
  const badRes = await new Promise((r) => badCode.emit('player:join', { code: '000000', name: 'X' }, r));
  check('pemain: kode salah ditolak', !badRes.ok && /tidak ditemukan/i.test(badRes.error), badRes.error);
  badCode.close();

  /* ---------- 3. Tiga pemain join ---------- */
  const players = {};
  for (const name of ['Budi', 'Siti', 'Andi']) {
    const s = io(URL, { transports: ['websocket'] });
    await once(s, 'connect');
    const res = await new Promise((r) => s.emit('player:join', { code, name }, r));
    check(`pemain: ${name} join`, res.ok, res.error || '');
    players[name] = s;
  }

  const dup = io(URL, { transports: ['websocket'] });
  await once(dup, 'connect');
  const dupRes = await new Promise((r) => dup.emit('player:join', { code, name: 'budi' }, r));
  check('pemain: nama ganda ditolak', !dupRes.ok, dupRes.error || '');
  dup.close();

  await sleep(300); // beri waktu event lobby terakhir sampai
  check('lobby: 3 pemain terdaftar', latestLobby && latestLobby.players.length === 3, `dapat ${latestLobby ? latestLobby.players.length : 0}`);
  check('lobby: QR code join tersedia', latestLobby && typeof latestLobby.qr === 'string' && latestLobby.qr.startsWith('data:image/png'), latestLobby && latestLobby.qr ? 'ada' : 'tidak ada');
  check('lobby: URL join sesuai host', latestLobby && /^https?:\/\/.+\/play\.html\?code=\d{6}$/.test(latestLobby.joinUrl || ''), latestLobby && latestLobby.joinUrl);

  /* ---------- 4. Mulai game, soal 1 ---------- */
  // daftar listener SEBELUM host:start
  const q1Host = once(host, 'game:question');
  const q1Players = {};
  for (const name of Object.keys(players)) q1Players[name] = once(players[name], 'game:question');

  host.emit('host:start');
  const q1 = await q1Host;
  check('game: soal 1 tampil', q1.index === 1 && q1.total === 2 && q1.options.length === 4, q1.text);
  for (const name of Object.keys(players)) {
    const q = await q1Players[name];
    check(`game: ${name} menerima soal 1`, q.text === q1.text);
  }

  // Budi benar instan, Andi salah, Siti benar setelah ~1s (jawaban terakhir → memicu reveal)
  const youBudiP = once(players.Budi, 'game:reveal_you');
  const youSitiP = once(players.Siti, 'game:reveal_you');
  const youAndiP = once(players.Andi, 'game:reveal_you');
  const revealHostP = once(host, 'game:reveal');

  players.Budi.emit('player:answer', { qIndex: 0, optionIndex: 0 });
  await sleep(300);
  players.Andi.emit('player:answer', { qIndex: 0, optionIndex: 2 });
  await sleep(700);
  players.Siti.emit('player:answer', { qIndex: 0, optionIndex: 0 });

  const reveal = await revealHostP;
  check('reveal: kunci jawaban soal 1 = opsi 0', reveal.correctIndex === 0, `dapat ${reveal.correctIndex}`);
  check('reveal: distribusi jawaban [2,0,1,0]', JSON.stringify(reveal.optionCounts) === JSON.stringify([2, 0, 1, 0]), JSON.stringify(reveal.optionCounts));

  const youBudi = await youBudiP;
  const youSiti = await youSitiP;
  const youAndi = await youAndiP;
  check('skor: Budi benar cepat ≈ 500', youBudi.correct && youBudi.points >= 470 && youBudi.points <= 500, `+${youBudi.points}`);
  check('skor: Siti benar lebih lambat < Budi', youSiti.correct && youSiti.points >= 380 && youSiti.points < youBudi.points, `+${youSiti.points}`);
  check('skor: Andi salah = 0', !youAndi.correct && youAndi.points === 0, `+${youAndi.points}`);

  /* ---------- 5. Leaderboard round 1 ---------- */
  const lb1P = once(host, 'game:leaderboard');
  host.emit('host:next');
  const lb1 = await lb1P;
  check('leaderboard: urutan Budi > Siti > Andi',
    lb1.rows[0].name === 'Budi' && lb1.rows[1].name === 'Siti' && lb1.rows[2].name === 'Andi',
    lb1.rows.map((r) => `${r.name}:${r.score}`).join(', '));

  /* ---------- 6. Soal 2 ---------- */
  const q2Host = once(host, 'game:question');
  const q2Players = {};
  for (const name of Object.keys(players)) q2Players[name] = once(players[name], 'game:question');

  host.emit('host:next');
  const q2 = await q2Host;
  check('game: soal 2 tampil', q2.index === 2, q2.text);
  for (const name of Object.keys(players)) {
    await q2Players[name];
  }

  const reveal2P = once(host, 'game:reveal');
  players.Siti.emit('player:answer', { qIndex: 1, optionIndex: 1 }); // benar
  players.Budi.emit('player:answer', { qIndex: 1, optionIndex: 1 }); // benar
  players.Andi.emit('player:answer', { qIndex: 1, optionIndex: 0 }); // salah

  const reveal2 = await reveal2P;
  check('reveal: kunci jawaban soal 2 = opsi 1', reveal2.correctIndex === 1, `dapat ${reveal2.correctIndex}`);

  const lb2P = once(host, 'game:leaderboard');
  host.emit('host:next');
  const lb2 = await lb2P;
  check('leaderboard: Budi tetap juara 1', lb2.rows[0].name === 'Budi', lb2.rows.map((r) => `${r.name}:${r.score}`).join(', '));
  check('leaderboard: total Budi ≈ 1500', lb2.rows[0].score >= 1400, `${lb2.rows[0].score}`);

  /* ---------- 7. Selesai ---------- */
  const finHostP = once(host, 'game:finished_host');
  const finBudiP = once(players.Budi, 'game:finished');
  const finAndiP = once(players.Andi, 'game:finished');

  host.emit('host:next');
  const finHost = await finHostP;
  check('finish: podium 3 orang', finHost.podium.length === 3, finHost.podium.map((p) => p.name).join(', '));
  check('finish: juara 1 = Budi', finHost.podium[0].name === 'Budi');

  const finBudi = await finBudiP;
  check('finish: Budi dapat review 2 soal', finBudi.you.review.length === 2, `${finBudi.you.review.length}`);
  check('finish: Budi peringkat 1', finBudi.you.rank === 1, `#${finBudi.you.rank}`);
  check('finish: review Budi dua-duanya benar', finBudi.you.review.every((r) => r.correct));

  const finAndi = await finAndiP;
  check('finish: Andi peringkat 3', finAndi.you.rank === 3, `#${finAndi.you.rank}`);
  check('finish: review Andi dua-duanya salah', finAndi.you.review.every((r) => !r.correct));

  /* ---------- 8. Main lagi ---------- */
  const resetP = once(players.Budi, 'game:reset');
  const lobby2P = once(host, 'room:lobby');
  host.emit('host:play_again');
  await resetP;
  const lobby2 = await lobby2P;
  check('play again: 3 pemain tetap di lobby', lobby2.players.length === 3, `dapat ${lobby2.players.length}`);

  /* ---------- 9. Rejoin host & pemain di tengah soal ---------- */
  const q3Host = once(host, 'game:question');
  host.emit('host:start');
  const q3 = await q3Host;
  check('rejoin: game dimulai ulang', q3.index === 1, q3.text);

  players.Budi.emit('player:answer', { qIndex: 0, optionIndex: 0 });
  await sleep(200);

  // host "refresh halaman": socket lama ditutup, socket baru rejoin
  host.close();
  const host2 = io(URL, { transports: ['websocket'] });
  await once(host2, 'connect');
  const rejHost = await new Promise((r) => host2.emit('host:rejoin', { code }, r));
  check('rejoin: host bisa rejoin', rejHost.ok, rejHost.error || '');
  const q3HostSnap = await once(host2, 'game:question');
  check('rejoin: host dapat snapshot soal', q3HostSnap.text === q3.text, q3HostSnap.text);

  // pemain "refresh halaman"
  players.Budi.close();
  const budi2 = io(URL, { transports: ['websocket'] });
  await once(budi2, 'connect');
  const rejBudi = await new Promise((r) => budi2.emit('player:rejoin', { code, name: 'Budi' }, r));
  check('rejoin: pemain bisa rejoin', rejBudi.ok, rejBudi.error || '');
  const q3BudiSnap = await once(budi2, 'game:question');
  check('rejoin: pemain dapat snapshot soal', q3BudiSnap.text === q3.text);
  check('rejoin: status "sudah menjawab" terkirim', q3BudiSnap.youAnswered === true);

  // selesaikan game dengan socket baru
  players.Siti.emit('player:answer', { qIndex: 0, optionIndex: 1 });
  players.Andi.emit('player:answer', { qIndex: 0, optionIndex: 1 });
  const rev3 = await once(host2, 'game:reveal');
  check('rejoin: soal selesai setelah rejoin', rev3.correctIndex === 0, `dapat ${rev3.correctIndex}`);
  host2.emit('host:next');
  await once(host2, 'game:leaderboard');
  host2.emit('host:next');
  const q4 = await once(host2, 'game:question');
  check('rejoin: lanjut ke soal 2', q4.index === 2, q4.text);

  players.Siti.emit('player:answer', { qIndex: 1, optionIndex: 1 });
  players.Andi.emit('player:answer', { qIndex: 1, optionIndex: 1 });
  budi2.emit('player:answer', { qIndex: 1, optionIndex: 1 });
  await once(host2, 'game:reveal');
  host2.emit('host:next');
  await once(host2, 'game:leaderboard');
  host2.emit('host:next');
  const fin2 = await once(host2, 'game:finished_host');
  check('rejoin: game selesai normal', fin2.podium.length === 3, fin2.podium.map((p) => p.name).join(', '));

  /* ---------- 10. Rejoin setelah game selesai (regresi crash) ---------- */
  const budi3 = io(URL, { transports: ['websocket'] });
  await once(budi3, 'connect');
  const rejFin = await new Promise((r) => budi3.emit('player:rejoin', { code, name: 'Budi' }, r));
  check('rejoin: pemain bisa rejoin setelah selesai', rejFin.ok, rejFin.error || '');
  const fin3 = await once(budi3, 'game:finished');
  check('rejoin: snapshot hasil akhir diterima', fin3.you.rank === 1 && fin3.you.review.length === 2, `rank #${fin3.you.rank}, review ${fin3.you.review.length}`);
  budi3.close();

  const host3 = io(URL, { transports: ['websocket'] });
  await once(host3, 'connect');
  const rejHostFin = await new Promise((r) => host3.emit('host:rejoin', { code }, r));
  check('rejoin: host bisa rejoin setelah selesai', rejHostFin.ok, rejHostFin.error || '');
  const finHost3 = await once(host3, 'game:finished_host');
  check('rejoin: host dapat snapshot podium', finHost3.podium.length === 3);
  host3.close();

  /* ---------- cleanup ---------- */
  host2.close();
  budi2.close();
  Object.values(players).forEach((s) => s.close());

  console.log('\n======================= RINGKASAN =======================');
  console.log(`Total: ${total} check, gagal: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ TEST ERROR:', err.message);
  process.exit(1);
});
