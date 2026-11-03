# 🚀 Deploy KuisLive ke Internet (Gratis, 24 Jam, Tanpa Buka Laptop)

Panduan lengkap agar aplikasi bisa diakses siapa saja, kapan saja, **tanpa harus menyalakan laptop Anda**.

Metode: **GitHub** (simpan kode) + **Render** (jalankan server gratis) + **GitHub Actions** (jaga server tetap aktif).

Total waktu: ±15 menit. Biaya: **Rp 0**.

---

## Langkah 1 — Buat Repo di GitHub

1. Buka [github.com](https://github.com) → login (daftar gratis kalau belum punya)
2. Klik tombol **+** (pojok kanan atas) → **New repository**
3. Isi:
   - **Repository name**: `kuis-live`
   - **Visibility**: Private (aman) atau Public — dua-duanya bisa
4. Klik **Create repository**
5. Biarkan halaman itu terbuka

## Langkah 2 — Push Kode ke GitHub

Buka **PowerShell**, jalankan:

```powershell
cd "C:\Tugas Kuliah\PPKTI  ARTIKEL 2\kuis-live"

# ganti USERNAME dengan username GitHub Anda
git remote set-url origin https://github.com/USERNAME/kuis-live.git
git push -u origin main
```

> Saat diminta login: masukkan username GitHub + **Personal Access Token** (bukan password).
> Belum punya token? Buat di: github.com → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token → centang **repo** → copy tokennya.

## Langkah 3 — Deploy ke Render

1. Buka [dashboard.render.com](https://dashboard.render.com) → **Sign Up** (pakai akun GitHub, gratis, tanpa kartu kredit)
2. Klik **New +** → **Blueprint**
3. Pilih repo **kuis-live** → **Connect**
4. Render membaca `render.yaml` otomatis → klik **Apply**
5. Tunggu ±2-3 menit sampai status **Live** (warna hijau)
6. Klik nama service → copy URL-nya, bentuknya:
   ```
   https://kuislive-xxxx.onrender.com
   ```

**Selesai!** URL itu bisa langsung dibagikan ke siapa saja.

## Langkah 4 — Ganti Password Guru (WAJIB sebelum dibagikan)

1. Di halaman service Render → menu kiri **Environment**
2. Cari `ADMIN_PASSWORD` → klik **Edit** → ganti `guru123` dengan password Anda
3. **Save changes** (Render akan restart otomatis ±1 menit)

## Langkah 5 — Jaga Server Tetap Aktif 24 Jam

Paket gratis Render menidurkan server setelah ±15 menit tidak dipakai (orang pertama yang buka harus tunggu ±30 detik). Agar **selalu siang**:

1. Buka repo GitHub Anda → tab **Settings** → menu kiri **Secrets and variables** → **Actions**
2. Tab **Variables** → **New repository variable**
3. Isi:
   - **Name**: `APP_URL`
   - **Value**: `https://kuislive-xxxx.onrender.com` (URL dari Langkah 3)
4. **Save**

Workflow `keepalive.yml` akan otomatis ping server setiap 10 menit — server tidak pernah tidur, dan laptop Anda bisa mati total.

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
| **Kuis tersimpan** | Kuis demo selalu ada. Kuis yang dibuat guru tersimpan di server Render — bertahan selama service tidak di-redeploy. Untuk keamanan, simpan juga salinan soal di komputer |
| **Skor & data pemain** | Disimpan di memori server (hilang saat service restart) — cocok untuk kuis kelas |
| **Keamanan** | Password guru adalah satu-satunya pengaman. Jangan bagikan password ke siswa. Untuk penggunaan serius, pertimbangkan upgrade |
| **Batas gratis Render** | 750 jam/bulan (cukup untuk 1 service 24 jam), RAM 512 MB |
| **WebSocket** | Sudah didukung penuh — game real-time jalan normal |

---

## Alternatif Hosting Lain

| Platform | Kelebihan | Kekurangan |
|---|---|---|
| **Render** (panduan ini) | Paling mudah, gratis, tanpa kartu kredit | Tidur 15 menit (diatasi keep-alive) |
| **Northflank** | Gratis, **tidak tidur**, tanpa kartu kredit | Setup sedikit lebih rumit |
| **Koyeb** | Gratis, deploy dari GitHub | Instance "eco" bisa scale-to-zero |
| **Railway** | Tidak tidur, cepat | Kredit trial $5 habis → perlu bayar |
| **VPS** (Biznet, DigitalOcean) | Kontrol penuh, domain sendiri | Berbayar (±Rp 50-100rb/bulan) |

---

## Update Aplikasi Nanti

Setelah edit kode, cukup:

```powershell
git add -A
git commit -m "deskripsi perubahan"
git push
```

Render otomatis deploy ulang dalam ±2 menit.
