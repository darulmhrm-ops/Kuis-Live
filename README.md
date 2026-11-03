# ⚡ KuisLive — Aplikasi Kuis Interaktif Real-Time (ala Quizizz)

Aplikasi kuis multiplayer live: **host membuat kuis → pemain join pakai kode 6 digit → menjawab real-time di HP/laptop masing-masing → leaderboard & podium otomatis.**

Dibuat dengan Node.js + Express + Socket.IO, frontend vanilla JS (tanpa build step).

---

## 🚀 Cara Menjalankan

```bash
cd kuis-live
npm install
npm start
```

Buka **http://localhost:3000**

### Cara pakai

1. **Host**: buka http://localhost:3000 → klik **Buat Kuis** → isi judul, tulis soal (4 opsi + tandai kunci jawaban + batas waktu + poin) → **Simpan & Buat Room**.
2. **Bagikan kode room 6 digit** (atau link join) ke pemain.
3. **Pemain**: buka http://localhost:3000 → masukkan kode → isi nama → pilih avatar → **Masuk**.
4. **Host**: klik **Mulai Permainan** → pemain menjawab di device mereka → leaderboard tiap soal → podium di akhir.

> Buka dari HP? Jalankan `npm start` lalu akses `http://<IP-komputer>:3000` dari HP dalam jaringan WiFi yang sama.

---

## 📱 Main dari HP Lain

**Pemain di luar jaringan WiFi?** Lihat [Publikasi ke Internet](#-publikasi-ke-internet-biar-bisa-main-dari-mana-saja) — deploy ke Render atau pakai tunnel Cloudflare, lalu semua orang buka URL yang sama dari mana saja.

**Pemain satu WiFi dengan komputer host** (tanpa internet):

Semua pemain cukup terhubung ke **WiFi yang sama** dengan komputer host.

### Langkah

1. **Host** jalankan `npm start` di komputer.
2. Host buka halaman host lewat **IP komputer**, bukan localhost:
   ```
   http://192.168.1.79:3000/host.html
   ```
   (ganti dengan IP komputer Anda — lihat cara cek di bawah)
3. Buat room → di lobby akan muncul **kode 6 digit**, alamat join, dan **QR code**.
4. **Pemain di HP**: scan QR code itu dengan kamera/browser, atau buka alamat `http://192.168.1.79:3000` → masukkan kode → main!

### Cek IP komputer (Windows)

```powershell
ipconfig
```
Lihat bagian **"IPv4 Address"** pada adapter WiFi yang aktif, misalnya `192.168.1.79`.

### Kalau HP tidak bisa konek

| Masalah | Solusi |
|---|---|
| Windows Firewall memblokir | Saat pertama kali `npm start`, Windows biasanya menampilkan popup firewall → centang **Private** dan **Public** → Allow. Kalau popup-nya terlewat: *Windows Defender Firewall → Allow an app through firewall → Pastikan Node.js di-centang untuk Private & Public* |
| Jaringan WiFi berstatus "Public" | *Settings → Network & Internet → WiFi → pilih jaringan → ganti ke **Private*** |
| HP dan komputer beda WiFi | Pastikan keduanya di jaringan yang sama (bukan salah satu pakai data seluler) |
| IP komputer berubah | Cek ulang `ipconfig` — IP bisa berubah tiap reconnect WiFi |

> Catatan: koneksi ini hanya bekerja dalam jaringan lokal (rumah/sekolah/kantor). Untuk main antar jaringan yang berbeda (misal teman dari luar kota), aplikasi perlu di-deploy ke server publik.

---

## ✨ Fitur

### Host
- **Editor kuis**: tambah/hapus/duplikat/urutkan soal, 4 opsi berwarna, tandai kunci jawaban, batas waktu 5–180 detik, poin 500/1000/2000
- **Pengaturan**: acak urutan soal, acak urutan opsi
- **Kuis tersimpan**: kuis disimpan otomatis ke `data/quizzes.json`, bisa dipakai ulang & dihapus
- **Lobby**: kode room, link join + tombol salin, **QR code untuk di-scan HP pemain**, daftar pemain (avatar), keluarkan pemain
- **Konsol live**: timer bar, hitungan "x/y menjawab", grafik bar distribusi jawaban per opsi, kunci jawaban ditandai
- **Kontrol**: Lanjut, **Lewati Soal** (akhiri soal lebih awal), Main Lagi
- **Podium**: juara 1/2/3 dengan animasi + tabel skor akhir

### Pemain
- Join dengan kode + nama + pilih avatar (18 pilihan)
- Soal dengan 4 tombol warna (merah/biru/kuning/hijau) + timer bar
- **Skor berbasis kecepatan**: jawab cepat = poin penuh, makin lambat makin sedikit (min. setengah poin dasar)
- Streak (jawaban benar beruntun), meme penyemangat, reaksi emoji mengambang
- Leaderboard tiap soal (peringkat & poin round), hasil akhir: peringkat, skor, streak terbaik, podium mini, **review semua jawaban** (termasuk soal yang tidak dijawab)

### Teknis
- Real-time penuh via WebSocket (Socket.IO)
- Server-authoritative: skor & waktu dihitung di server (anti curang)
- **Rejoin otomatis**: host/pemain yang refresh halaman di tengah permainan langsung kembali ke state yang sama (skor & jawaban aman)
- Pemain yang koneksinya terputus diberi grace period 2 menit untuk kembali
- Validasi input & sanitasi teks

---

## 📁 Struktur Project

```
kuis-live/
├── server.js            # Express + Socket.IO + seluruh game logic
├── package.json
├── data/
│   └── quizzes.json     # kuis tersimpan (otomatis dibuat)
├── public/
│   ├── index.html       # beranda (buat / ikut kuis)
│   ├── host.html        # editor kuis + lobby + konsol host
│   ├── play.html        # halaman pemain
│   ├── css/style.css    # tema ala Quizizz
│   └── js/
│       ├── host.js      # logika host
│       └── play.js      # logika pemain
├── test/
│   └── flow.test.js     # integration test (44 skenario)
└── screenshots/         # tangkapan layar hasil pengujian
```

---

## 🧪 Testing

```bash
npm start          # terminal 1: jalankan server
npm test           # terminal 2: integration test
```

Test mensimulasikan 1 host + 3 pemain memainkan kuis 2 soal dari awal sampai selesai (44 pengecekan): join/validasi, alur soal, perhitungan skor berbasis kecepatan, leaderboard, podium, review jawaban, main lagi, dan rejoin host/pemain di berbagai state permainan.

---

## 🔧 Konfigurasi

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port server |

---

## 🌍 Publikasi ke Internet (biar bisa main dari mana saja)

### Opsi A — Tunnel instan (Cloudflare, gratis, tanpa akun)

Cocok untuk tes cepat atau main sebentar. URL publik muncul **seketika**, tapi hanya aktif selama komputer Anda menyala.

```bash
# 1. jalankan server (biarkan terbuka)
npm start

# 2. di terminal baru, jalankan tunnel
tools\cloudflared.exe tunnel --url http://localhost:3000 --no-autoupdate
```

Output akan menampilkan URL seperti:

```
https://nama-acak.trycloudflare.com
```

Bagikan URL itu ke semua pemain — host maupun pemain buka URL yang sama. Kode room, QR code, dan WebSocket semuanya jalan lewat URL publik ini.

> Catatan: URL berubah setiap tunnel dijalankan ulang. Untuk URL tetap, pakai Opsi B.

### Opsi B — Deploy permanen ke Render (gratis, 24 jam)

Repo ini sudah siap deploy (ada `render.yaml`):

1. **Buat repo GitHub** dan push project ini:
   ```bash
   git remote add origin https://github.com/<username>/kuis-live.git
   git push -u origin main
   ```
2. Buka [dashboard.render.com](https://dashboard.render.com) → daftar/login (bisa pakai akun GitHub)
3. **New +** → **Blueprint** → pilih repo `kuis-live` → Render otomatis membaca `render.yaml`
4. Tunggu build selesai (±2 menit) → dapat URL tetap: `https://kuis-live-xxxx.onrender.com`
5. Bagikan URL itu — siapa saja di internet bisa buka dan main

Catatan paket gratis Render:
- Server "tidur" setelah ~15 menit tidak ada aktivitas; pemain pertama yang buka akan menunggu ±30 detun server bangun
- Kuis yang dibuat tersimpan di filesystem server (bertahan saat restart, hilang saat redeploy) — kuis demo selalu ada karena ikut di repo
- WebSocket didukung penuh (sudah diverifikasi end-to-end)

### Alternatif lain

| Platform | Cara | Catatan |
|---|---|---|
| **Railway** | New Project → Deploy from GitHub | Gratis $5 kredit/bulan, tidak sleep |
| **Fly.io** | `fly launch` (perlu Dockerfile) | Gratu 3 VM kecil |
| **VPS** (DigitalOcean, Biznet, dll) | `npm install && npm start` + PM2 | Berbayar, kontrol penuh |

Semua platform di atas mendukung Node.js + WebSocket, jadi aplikasi ini jalan tanpa perubahan kode.

---

## 🎨 Catatan Desain

Desain modern dan bersih — **tanpa emoji**, semua ikon memakai SVG inline (lucide-style):

- **Tipografi**: Inter, hierarki jelas, letter-heading rapat pada judul
- **Warna**: aksen indigo-violet (`#5b5bd6`), surface putih, border tipis, bayangan lembut berlapis (`--shadow-sm/md/lg`)
- **Avatar**: lingkaran berwarna + inisial nama (8 warna palet), dipilih pemain saat join
- **Opsi jawaban**: 4 warna modern (merah/biru/amber/hijau) dengan simbol geometris ▲ ◆ ● ■
- **Papan skor**: badge peringkat melingkap — emas/perak/perunggu untuk 3 besar
- **Podium**: kolom bergradien dengan animasi naik, avatar + skor
- **Detail**: timer bar gradien 5px, focus ring pada input, transisi halus di semua interaksi, layout responsif
