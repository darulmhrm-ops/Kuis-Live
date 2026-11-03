# 🚀 Deploy KuisLive ke Internet (Gratis, 24 Jam, Tanpa Buka Laptop)

Panduan lengkap agar aplikasi bisa diakses siapa saja, kapan saja, **tanpa harus menyalakan laptop Anda**.

**Pilih salah satu platform** (semua gratis, mendukung WebSocket/game real-time):

| Platform | Kartu Kredit? | Tidur? | Rekomendasi |
|---|---|---|---|
| **Northflank** | ❌ Tidak perlu | ❌ Tidak tidur | ⭐ **Paling direkomendasikan** |
| **Koyeb** | ❌ Tidak perlu | ⚠️ Bisa scale-to-zero | Alternatif bagus |
| **Glitch** | ❌ Tidak perlu | 😴 Tidur 5 menit | Paling simpel, perlu keep-alive |
| **Render** | ✅ Perlu verifikasi $1 | 😴 Tidur 15 menit | Kalau punya kartu |

---

## OPSI 1 — Northflank (⭐ Rekomendasi: gratis, tanpa kartu, tidak tidur)

### Langkah 1 — Push kode ke GitHub (kalau belum)

```powershell
cd "C:\Tugas Kuliah\PPKTI  ARTIKEL 2\kuis-live"
git remote set-url origin https://github.com/USERNAME/kuis-live.git
git push -u origin main
```

### Langkah 2 — Deploy di Northflank

1. Buka [northflank.com](https://northflank.com) → **Sign Up** (pakai login GitHub — **tanpa kartu kredit**)
2. Klik **+ Create New** → **Project** → beri nama (misal `kuislive`) → **Create Project**
3. Di dalam project: **+ Create New** → **Service** → pilih **Web Service**
4. **Deployment source**: pilih **GitHub** → authorize → pilih repo `kuis-live`
5. **Build type**: pilih **Dockerfile** (repo sudah ada `Dockerfile` siap pakai)
6. **Networking / Port**: isi port **3000**, centang **Publicly expose**
7. **Environment variables** (klik Add):
   - `ADMIN_PASSWORD` = password guru pilihan Anda (misal `kuisbarudak2024`)
8. Klik **Create Service** → tunggu build ±2-3 menit
9. Setelah Live, klik service → tab **Networking/URLs** → copy URL-nya:
   ```
   https://kuislive-xxxx.northflank.app
   ```

**Selesai!** URL itu bisa langsung dibagikan — server tidak tidur, laptop bisa dimatikan.

---

## OPSI 2 — Koyeb (gratis, tanpa kartu)

1. Buka [koyeb.com](https://koyeb.com) → **Sign Up** dengan GitHub
2. **Create** → **Create Service** → **GitHub deployment** → pilih repo `kuis-live`
3. **Builder**: Docker (pakai Dockerfile di repo)
4. **Instance**: pilih **Free (eco)**
5. **Environment variables**: tambahkan `ADMIN_PASSWORD` = password Anda
6. **Port**: 3000
7. **Deploy** → tunggu ±2 menit → URL: `https://kuis-live-xxxx.koyeb.app`

> Catatan: instance "eco" bisa tidur saat tidak dipakai, tapi bangun cepat saat ada akses.

---

## OPSI 3 — Glitch (paling simpel, tanpa kartu)

1. Buka [glitch.com](https://glitch.com) → **Sign Up** dengan GitHub
2. **New Project** → **Import from GitHub** → paste URL repo:
   ```
   https://github.com/USERNAME/kuis-live.git
   ```
3. Glitch otomatis mendeteksi Node.js dan menjalankan `npm start`
4. Klik **Share** → copy URL Live Site: `https://nama-project.glitch.me`
5. Project tidur setelah ±5 menit — pakai keep-alive di bawah supaya tetap aktif

---

## Keep-Alive 24 Jam (untuk platform yang tidur: Glitch/Koyeb/Render)

Repo sudah punya workflow `.github/workflows/keepalive.yml`. Cukup:

1. Buka repo GitHub → **Settings** → **Secrets and variables** → **Actions**
2. Tab **Variables** → **New repository variable**
3. Name: `APP_URL` → Value: URL aplikasi Anda → **Save**

Workflow akan ping aplikasi setiap 10 menit otomatis (gratis, di server GitHub).

---

## Setelah Deploy — Cara Pakai

| Peran | Cara |
|---|---|
| **Guru** | Buka URL → "Masuk sebagai Guru" → password → buat/pilih kuis → bagikan kode room |
| **Siswa** | Buka URL → "Masuk sebagai Siswa" → PIN + nama → main |

QR code di lobby guru otomatis berisi URL publik yang benar.

---

## Catatan Penting

| Hal | Keterangan |
|---|---|
| **Kuis tersimpan** | Kuis demo selalu ada. Kuis buatan guru tersimpan di server — bisa hilang saat service di-redeploy. Simpan salinan soal penting di komputer |
| **Skor & data pemain** | Disimpan di memori server (hilang saat restart) — cocok untuk kuis kelas |
| **Keamanan** | Password guru (`ADMIN_PASSWORD`) adalah satu-satunya pengaman — jangan bagikan ke siswa |
| **WebSocket** | Didukung penuh di semua platform di atas — game real-time jalan normal |

---

## Update Aplikasi Nanti

Setelah edit kode:

```powershell
git add -A
git commit -m "deskripsi perubahan"
git push
```

Semua platform di atas otomatis deploy ulang dalam ±2 menit.

---

## Troubleshoot

| Masalah | Solusi |
|---|---|
| Build gagal di Northflank/Koyeb | Pastikan build type = **Dockerfile** (bukan buildpack) |
| Aplikasi tidak bisa diakses | Cek port 3000 sudah di-expose dan status service "Live" |
| WebSocket tidak konek | Pastikan akses via HTTPS URL platform (bukan IP langsung) |
| Lupa password guru | Ganti env `ADMIN_PASSWORD` di dashboard platform → service restart otomatis |
| QR code salah URL | QR mengikuti host header — akses host lewat URL publik platform, bukan localhost |

