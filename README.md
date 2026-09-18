# Dashboard Monitoring KDA (Kecamatan Dalam Angka)

Aplikasi web sederhana untuk memantau progres penyusunan publikasi **Kecamatan Dalam Angka (KDA)** di seluruh kabupaten/kota dalam satu provinsi. Dibangun di atas **Google Sheets + Google Apps Script**, tanpa database atau hosting terpisah — semua data tersimpan langsung di spreadsheet.

## Daftar Isi

- [Fitur Utama](#fitur-utama)
- [Struktur Proyek](#struktur-proyek)
- [Cara Instalasi & Deploy](#cara-instalasi--deploy)
- [Struktur Data di Google Sheets](#struktur-data-di-google-sheets)
- [Level Akses & Peran](#level-akses--peran)
- [Panduan Pemakaian](#panduan-pemakaian)
- [Skema Warna Progres](#skema-warna-progres)
- [Konfigurasi (`CONFIG`)](#konfigurasi-config)
- [Setup Tahun Baru](#setup-tahun-baru)
- [Keamanan](#keamanan)
- [Troubleshooting](#troubleshooting)
- [Batasan yang Diketahui](#batasan-yang-diketahui)

## Fitur Utama

- **Checklist 10 aspek per kecamatan** (ARC, Tabulasi Data, Entri Data Tabel, Pendahuluan, Penjelasan Teknis, Ulasan, Cover, Infografis, Pdf Publikasi, Unggah Website), progres dihitung otomatis.
- **3 level akses**: Publik, Kabupaten/Kota, dan Admin Provinsi (lihat [Level Akses](#level-akses--peran)).
- **Ringkasan Provinsi**: kartu statistik, peringkat & grafik progres per kabupaten/kota, serta peringkat kecamatan tertinggi/terendah se-provinsi maupun per kab/kota.
- **Cari Kecamatan**: pilih satu kab/kota lalu cari kecamatan tertentu di dalamnya, lengkap dengan insight aspek yang paling sering tertinggal.
- **Riwayat Aktivitas**: log kronologis "apa dikerjakan di tanggal berapa", per kab/kota (untuk role kab/kota) atau seluruh provinsi dengan filter (untuk role admin).
- **Grafik progres**: bar chart horizontal per kecamatan (di level kab/kota) dan per kab/kota (di Ringkasan Provinsi) — dibuat manual dengan HTML/CSS, tanpa library eksternal.
- **Urutan kabupaten/kota** mengikuti kode wilayah resmi BPS (mis. 1801 Lampung Barat → 1872 Kota Metro), bukan alfabetis.
- Login berbasis kode wilayah + password, sesi disimpan sementara di server (bukan dipercaya dari browser).

## Struktur Proyek

| File | Peran |
|---|---|
| `Code.gs` | Backend (Google Apps Script): autentikasi, baca/tulis data ke Sheets, agregasi progres & riwayat, setup sheet tahunan. |
| `Index.html` | Frontend (satu halaman, HTML + CSS + vanilla JS), dilayani lewat `HtmlService` dan berkomunikasi ke `Code.gs` lewat `google.script.run`. |

Tidak ada dependency/npm/build step — cukup dua file ini yang di-paste ke dalam project Apps Script.

## Cara Instalasi & Deploy

1. Buka spreadsheet yang berisi sheet sumber per kab/kota (nama sheet 4 digit, mis. `1800`, `1801`, dst) → **Extensions > Apps Script**.
2. Hapus isi `Code.gs` default di editor Apps Script, lalu paste isi `Code.gs` dari proyek ini.
3. Buat file HTML baru (**File > New > HTML**), beri nama **`Index`** (harus persis, tanpa ekstensi `.html`), lalu paste isi `Index.html`.
4. Kembali ke Spreadsheet, refresh halaman. Menu **"Dashboard KDA"** akan muncul di menu bar.
5. Jalankan **Dashboard KDA > 1. Setup Sheet Tahun 2026** (sekali saja). Ini menduplikasi tiap sheet sumber 4-digit menjadi sheet baru `<kode>_2026` dengan kolom aspek & progres yang sudah dikosongkan.
6. Jalankan **Dashboard KDA > 2. Buat/Perbarui Sheet Password**. Ini membuat sheet baru bernama **"Password"** berisi daftar kode admin + semua kab/kota. **Isi kolom Password secara manual** untuk tiap baris — kode yang Password-nya masih kosong belum bisa dipakai login.
7. **Deploy > New deployment** → pilih tipe **Web app** → *Execute as*: **Me** → *Who has access*: sesuaikan kebutuhan (mis. hanya organisasi) → **Deploy**.
8. Salin URL web app yang muncul, itulah link dashboard. Bagikan ke masing-masing kab/kota beserta kode & password login-nya.

> Panduan langkah 7–8 juga tersedia di dalam aplikasi lewat menu **Dashboard KDA > 3. Cara Buka Dashboard (Deploy)**.

## Struktur Data di Google Sheets

Setiap kab/kota punya satu sheet sendiri. Sheet sumber (tahun sebelumnya) dikenali dari nama 4 digit (kode BPS wilayah, mis. `1801`), lalu di-*setup* menjadi sheet tahun berjalan bernama `<kode>_2026`.

| Kolom | Isi |
|---|---|
| A | Nomor urut |
| B | Publikasi (nama kecamatan + tahun, mis. "Kecamatan X Dalam Angka 2026") |
| C–L | 10 aspek (checklist ✓, atau tanggal khusus untuk aspek **ARC**) |
| M | Progres (formula referensi cepat; dashboard sendiri menghitung ulang dari isi kolom aspek, bukan dari formula ini) |

Baris data kecamatan dimulai dari **baris 5**. Baris 2 kolom A dipakai sebagai nama kab/kota yang ditampilkan di dashboard.

Sheet tambahan **"Password"** (dibuat otomatis lewat menu setup):

| Kode | Nama Wilayah | Password |
|---|---|---|
| `admin-1800` | Admin Provinsi | *(diisi manual)* |
| `1801` | Lampung Barat | *(diisi manual)* |
| `1802` | Tanggamus | *(diisi manual)* |
| … | … | … |

## Level Akses & Peran

| Peran | Cara login | Bisa lihat | Bisa edit |
|---|---|---|---|
| **Publik** | Tidak perlu login | Ringkasan Provinsi lengkap (kartu progres, peringkat & grafik semua kab/kota, peringkat kecamatan) — **tanpa** rincian checklist per kecamatan | Tidak bisa |
| **Kabupaten/Kota** | Kode wilayah 4 digit + password | Semua fitur, tapi hanya untuk wilayahnya sendiri | Checklist wilayahnya sendiri saja |
| **Admin Provinsi** | Kode admin (`admin-1800`) + password | Semua fitur, semua kab/kota | Checklist seluruh kab/kota |

Validasi hak edit dilakukan di server (`requireEditAccess_` di `Code.gs`), jadi kab/kota tidak bisa mengedit wilayah lain meski mencoba lewat console browser.

## Panduan Pemakaian

**Login** — klik menu "Login" di sidebar, masukkan kode akses (kode wilayah 4 digit atau kode admin) dan password. Sesi berlaku 6 jam, lalu perlu login ulang.

**Mengisi checklist** — buka kab/kota (dari sidebar, kartu, atau hasil pencarian), pilih tab kecamatan, centang aspek yang sudah selesai. Aspek **ARC** diisi lewat input tanggal, bukan checkbox. Setiap perubahan langsung tersimpan ke spreadsheet dan tercatat waktunya.

**Ringkasan Provinsi** — halaman utama, berisi statistik agregat, kartu progres tiap kab/kota, panel **Peringkat & Grafik Progres Kabupaten/Kota**, serta peringkat kecamatan tertinggi/terendah se-provinsi dan per kab/kota (dalam accordion).

**Cari Kecamatan** — pilih kab/kota dari dropdown (untuk admin; kab/kota otomatis terpilih untuk role kabkota), lihat aspek yang paling sering tertinggal di wilayah itu, lalu cari nama kecamatan spesifik.

**Riwayat Aktivitas** — log per tanggal berisi kecamatan mana yang dikerjakan dan aspek apa yang diselesaikan. Role kab/kota hanya melihat wilayahnya sendiri; role admin melihat seluruh provinsi secara default, dengan opsi filter ke satu kab/kota. Ada kotak pencarian nama kecamatan, dan tiap baris bisa diklik untuk lompat ke checklist kecamatan tsb.

> Riwayat hanya mencatat aspek yang dicentang **lewat dashboard ini** (lihat [Batasan yang Diketahui](#batasan-yang-diketahui)).

## Skema Warna Progres

| Rentang progres | Warna |
|---|---|
| `< 60%` | Merah |
| `60% – 89%` | Oranye |
| `90% – 99%` | Hijau muda |
| `100%` | Hijau |

Warna ini konsisten dipakai di semua badge, progress bar, dan grafik di seluruh dashboard (fungsi `colorFor()` di `Index.html`).

## Konfigurasi (`CONFIG`)

Semua pengaturan utama ada di objek `CONFIG` pada baris-baris awal `Code.gs`:

```js
var CONFIG = {
  YEAR: 2026,              // tahun berjalan yang sedang dimonitor
  SOURCE_YEAR: 2025,       // tahun sumber (dipakai saat setup sheet baru)
  SUFFIX: '_2026',         // akhiran nama sheet tahun berjalan
  ADMIN_CODE: 'admin-1800',// kode login khusus provinsi
  DATE_ASPECTS: ['ARC'],   // aspek yang diisi tanggal, bukan checkbox
  SESSION_TTL_SECONDS: 21600, // masa berlaku sesi login (6 jam)
  ASPECTS: [ /* 10 nama aspek checklist */ ]
  // ... lihat Code.gs untuk daftar lengkap (kolom, baris awal data, dll.)
};
```

Ubah nilai-nilai ini sesuai kebutuhan (mis. mengganti daftar aspek, posisi kolom, atau kode admin) sebelum menjalankan menu setup.

## Setup Tahun Baru

Saat pindah ke tahun monitoring berikutnya:

1. Update `CONFIG.YEAR` dan `CONFIG.SOURCE_YEAR` (serta `CONFIG.SUFFIX`) di `Code.gs`.
2. Jalankan **Dashboard KDA > 1. Setup Sheet Tahun <tahun baru>** — sheet lama tidak akan tertimpa (yang sudah ada otomatis dilewati).
3. Jalankan **Dashboard KDA > 2. Buat/Perbarui Sheet Password** untuk menambahkan baris kode wilayah baru (jika ada) tanpa menghapus password yang sudah diisi.
4. Deploy ulang versi web app jika perlu (**Deploy > Manage deployments**).

## Keamanan

- Password **tidak** disimpan di kode (`Code.gs`), hanya di sheet **"Password"** yang diisi manual oleh admin provinsi — supaya password bisa diganti langsung dari Sheets tanpa perlu edit kode.
- Token sesi disimpan di `CacheService` sisi server, bukan dipercaya begitu saja dari client, sehingga kab/kota tidak bisa mengaku sebagai admin atau kab/kota lain.
- Hak edit selalu divalidasi ulang di server sebelum setiap perubahan data (`toggleAspek`, `setAspekTanggal`).

## Troubleshooting

| Masalah | Penyebab / solusi |
|---|---|
| "Sheet tahun X belum dibuat" | Jalankan **Dashboard KDA > 1. Setup Sheet Tahun X** dari Google Sheets. |
| "Password untuk kode ... belum diisi" | Buka sheet **Password**, isi kolom Password untuk kode tsb. |
| Menu "Dashboard KDA" tidak muncul | Refresh halaman spreadsheet; pastikan `onOpen()` di `Code.gs` tidak error. |
| Login berhasil tapi data kosong | Pastikan sheet `<kode>_2026` untuk wilayah itu benar-benar ada dan namanya sesuai format. |
| Perubahan checklist tidak tersimpan | Cek apakah sesi login sudah kedaluwarsa (>6 jam) — login ulang. |

## Batasan yang Diketahui

- **Riwayat Aktivitas** hanya mencatat aspek yang dicentang **lewat dashboard**. Perubahan yang dilakukan langsung di Google Sheets (tanpa lewat toggle di dashboard) tetap terhitung "selesai" di checklist, tapi tidak akan muncul di Riwayat karena tidak ada catatan waktunya.
- Tidak ada mekanisme "undo" histori — menghapus centang akan menghapus juga catatan tanggalnya dari sel tsb.
- Aplikasi ini dirancang untuk satu provinsi per deployment (kode admin & seluruh kab/kota berada dalam satu spreadsheet yang sama).