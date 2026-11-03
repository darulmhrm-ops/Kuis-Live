'use strict';
// verifikasi cepat: PORT & ADMIN_PASSWORD dari environment bekerja (simulasi Render)
const { io } = require('socket.io-client');

(async () => {
  const url = process.env.URL || 'http://localhost:10000';
  const pass = process.env.ADMIN_PASSWORD || 'rahasia123';
  const s = io(url, { transports: ['websocket'] });
  await new Promise((r) => s.on('connect', r));

  const bad = await new Promise((r) => s.emit('admin:login', { password: 'salah' }, r));
  const good = await new Promise((r) => s.emit('admin:login', { password: pass }, r));
  const list = await new Promise((r) => s.emit('host:list_quizzes', { token: good.token }, r));

  console.log(`URL              : ${url}`);
  console.log(`password salah   : ditolak (${!bad.ok})`);
  console.log(`password env     : diterima (${good.ok})`);
  console.log(`daftar kuis      : ${Array.isArray(list) ? list.length + ' kuis' : 'gagal'}`);
  if (Array.isArray(list)) list.forEach((q) => console.log(`   - ${q.title} (${q.count} soal)`));

  s.close();
  process.exit(bad.ok || !good.ok ? 1 : 0);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
