# JOYBOT

Bot WhatsApp berbasis Node.js dan Baileys. Fitur utamanya mencakup AI, downloader, sticker, permainan, saldo pengguna, leaderboard, dan dashboard terminal Joy Console.

## Persyaratan

- Node.js 18 atau lebih baru
- FFmpeg tersedia di `PATH` untuk konversi video/audio pada command `.mp3`
- API key Groq untuk fitur AI

## Instalasi

1. Pasang dependency:

   ```bash
   npm install
   ```

2. Salin `api.env.example` menjadi `api.env`, lalu isi `GROQ_API_KEY`.
3. Jalankan bot:

   ```bash
   npm start
   ```

4. Pada koneksi pertama, ikuti instruksi pairing WhatsApp di terminal. Folder `sessions/` dibuat otomatis di komputer/server tempat bot dijalankan.

Jangan membagikan `api.env`, folder `sessions/`, atau folder `backups/`.

## Command

| Kategori | Command |
|---|---|
| Menu | `.menu`, `.gamesmenu`, `.toolsmenu`, `.downloadermenu`, `.funmenu`, `.accountmenu` |
| AI | `.ai <pertanyaan>` |
| Downloader | `.ttdl <link TikTok>`, `.mp3 <link media>` |
| Media | `.s` / `.sticker`, `.tomed` / `.toimg`, `.brat [a] <teks>` |
| Games | `.tebakangka`, `.tebakgambar` / `.tg`, `.tebaklogo` / `.tl`, `.quiz`, `.qumath <mode>`, `.777` |
| Game tools | `.clue`, `.nyerah` |
| Akun & saldo | `.reg`, `.daily`, `.balance`, `.shop`, `.buy`, `.inventory`, `.tf` |
| Leaderboard | `.ldbalance`, `.leadtg`, `.leadquiz`, `.leadqumath <mode>` |
| Statistik | `.stats` |

Mode `.qumath`: `e`, `m`, `h`, `ex`, `ma`, atau `in`.

Command owner: `.say`, `.restart`, `.debug`, `.ping`, `.uptime`, `.jid`, `.dlmsg`, dan `.aaeiilnndraatt`. Nomor owner dikonfigurasi di `config/bot.js`.

## Joy Console

Joy Console berjalan bersama bot di terminal interaktif. Dashboard ini menampilkan status koneksi, statistik proses, aktivitas, grup, dan log. Konfigurasinya berada di `config/joyConsole.js`.

## Struktur data

- `commands/`: implementasi command WhatsApp
- `handlers/`: dispatcher pesan
- `scrape/`: provider AI
- `database/`: fungsi dan data aplikasi
- `console/`: dashboard Joy Console
- `config/`: konfigurasi bot dan console
- `utils/`: utilitas proses dan statistik

Data akun dan statistik yang sudah ada tetap dipertahankan pada file JSON di `database/` dan `utils/`. Folder autentikasi WhatsApp, backup sesi, file log, dan API key asli tidak disertakan; bot perlu dipasangkan ulang pada perangkat/server tujuan.
