<div align="center">

# JOYBOT

**Bot WhatsApp Modular Berbasis Node.js & Baileys**

![Node.js](https://img.shields.io/badge/Node.js-v24.22.1-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Baileys](https://img.shields.io/badge/Baileys-v6.7.17-25D366?style=flat-square&logo=whatsapp&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-CommonJS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

</div>

---

## 📋 Daftar Isi

- [Tentang Projek](#-tentang-projek)
- [Fitur Utama](#-fitur-utama)
- [Tech Stack](#-tech-stack)
- [Prasyarat & Instalasi](#-prasyarat--instalasi)
- [Konfigurasi Environment](#-konfigurasi-environment)
- [Menjalankan Bot](#-menjalankan-bot)
- [Daftar Perintah](#-daftar-perintah)
- [Lisensi & Kredit](#-lisensi--kredit)

---

## 📌 Tentang Projek

**JOYBOT** adalah bot WhatsApp berbasis **Node.js** yang dibangun menggunakan library **Baileys** dan dikembangkan oleh **Hilal**. Bot ini dirancang dengan arsitektur *command* modular agar mudah dipelihara, dikembangkan, serta ditambahkan fitur-fitur baru sesuai kebutuhan.

---

## ✨ Fitur Utama

JOYBOT membagi fungsionalitasnya ke dalam beberapa kategori utama dengan pemisahan hak akses antara **Pengguna Umum (Public)** dan **Owner**:

| Kategori | Deskripsi | Hak Akses |
| :--- | :--- | :--- |
| **AI Chat** | Interaksi dan percakapan cerdas berbasis kecerdasan buatan. | Public |
| **Downloader** | Mengunduh berbagai media dari platform eksternal secara langsung. | Public |
| **Sticker Maker** | Mengonversi gambar atau foto menjadi stiker WhatsApp. | Public |
| **Sound Sticker** | Membuat stiker animasi WhatsApp yang dilengkapi dengan audio dari video. | Public |
| **Media Tools** | Utilitas pemrosesan media dan konten WhatsApp. | Public |
| **Games & Fun** | Permainan interaktif dilengkapi dengan sistem hadiah virtual. | Public |
| **Owner Tools** | Perintah administratif dan kontrol khusus untuk pemilik bot. | Owner |

---

## 🛠️ Tech Stack

* **Runtime & Module:** Node.js (`v24.22.1`) dengan sistem modul CommonJS (`require`).
* **WhatsApp Engine:** `baileys` (`v6.7.17`).
* **Media Processing:**
  * `ffmpeg-static` — Pemrosesan audio dan video (termasuk ekstraksi audio untuk *Sound Sticker*).
  * `sharp` — Pengolahan dan penyesuaian ukuran gambar.
  * `node-webpmux` — Pengelolaan metadata stiker berformat WebP.
* **Logging & Storage:** `pino` untuk pencatatan log aktivitas dan penyimpanan lokal untuk sesi autentikasi serta data bot.

---

## 📦 Prasyarat & Instalasi

### Prasyarat Sistem
* **Node.js** versi `>=18` (disarankan `v24.22.1`)
* **npm** (terpasang otomatis bersama Node.js)
* **Git** *(opsional, untuk melakukan clone repository)*
* Koneksi internet yang stabil

> **Catatan:** Kamu tidak perlu menginstal FFmpeg secara manual di sistem operasi karena projek ini sudah menyertakan `ffmpeg-static`.

### Langkah Instalasi

1. **Clone repository** (atau unduh source code projek):
   ```bash
   git clone https://github.com/hiiell/Joy-bot
   cd Joy-bot
   ```

2. **Instal seluruh dependencies:**
   ```bash
   npm install
   ```

---

## ⚙️ Konfigurasi Environment

JOYBOT menggunakan file **`api.env`** (dimuat melalui `dotenv`) untuk menyimpan konfigurasi sensitif dan API key.

1. Pastikan file `api.env` tersedia di direktori utama (*root*) projek.
2. Sesuaikan nilai pada **1 variabel environment** yang diperlukan di dalam file `api.env`:

```env
# Sesuaikan nama dan nilai variabel berdasarkan konfigurasi di api.env
GROQ_API_KEY=API_KEY
```

*(Periksa file `api.env` atau pemanggilan `process.env` pada source code untuk memastikan nama kunci variabel yang tepat sebelum menjalankan bot).*

---

## 🚀 Menjalankan Bot

1. Jalankan perintah berikut dari direktori utama projek:
   ```bash
   npm start
   ```

2. **Autentikasi WhatsApp (Pairing Code):**
   * JOYBOT dikonfigurasi menggunakan metode autentikasi **Pairing Code**.
   * Masukkan nomor WhatsApp bot sesuai instruksi yang muncul di terminal, lalu tautkan kode yang diberikan melalui menu **Perangkat Tertaut** di aplikasi WhatsApp.

---

## 💬 Daftar Perintah

Berikut adalah beberapa contoh perintah yang tersedia pada JOYBOT:

| Perintah | Alias | Deskripsi | Akses |
| :--- | :--- | :--- | :--- |
| `.sticker` | `.s` | Mengubah gambar atau foto menjadi stiker WhatsApp. | Public |
| `.audis` | - | Mengubah video menjadi *Sound Sticker* WhatsApp bersuara. | Public |
| `.say` | - | Mengirimkan pesan melalui bot. | Owner |
| `.botrestart` | - | Menghentikan bot dan menjalankan ulang `npm start`. | Owner |

---

## 📄 Lisensi & Kredit

* **Lisensi:** Didistribusikan di bawah lisensi [MIT](LICENSE).
* **Developer:** [Hilal](https://github.com/hiiell)
* **Kontribusi:** [AntiGravity]
