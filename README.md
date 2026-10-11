# ☁️ DriveUploader

**DriveUploader** adalah aplikasi web yang memungkinkan siapapun mengupload file langsung ke Google Drive milik pemilik — **tanpa perlu login Google account**. Cukup masukkan kode akses dan upload!

Ini adalah pasangan dari **FileDrive Portal** (sisi download). File yang diupload di sini akan langsung muncul di portal download karena menggunakan **Folder ID yang sama**.

---

## ✨ Fitur

- 🔐 **Proteksi Passcode** — Hanya yang tahu kode akses bisa upload
- 📂 **Drag & Drop** — Seret file langsung ke area upload
- 📋 **Multi-file** — Upload beberapa file sekaligus (max 10 per batch)
- 📊 **Progress Real-time** — Progress bar per file & keseluruhan
- 🌑 **Dark Mode Premium** — UI glassmorphism dengan animasi
- 📱 **Responsive** — Bekerja di PC dan Mobile
- 🔗 **Terintegrasi** — Folder ID sudah diisi otomatis (sama dengan filesharedrive)

---

## 🛠️ Arsitektur

```
Browser (HTML+JS)
    ↓  POST JSON (base64 file + passcode)
Google Apps Script Web App  (berjalan sebagai akun kamu)
    ↓  DriveApp.createFile()
Google Drive  →  Folder ID: 1h-L2Www0WneLByudxNpMRgENYttFFk54
    ↓  (folder yang sama dengan filesharedrive!)
FileDrive Portal  →  File langsung muncul di portal download publik ✅
```

---

## 🚀 Cara Setup (2 Langkah Saja)

### Langkah 1 — Buat Google Apps Script Backend (untuk UPLOAD)

> ⚠️ Ini **berbeda** dari Apps Script yang dipakai `filesharedrive`.
> Yang itu untuk READ (baca daftar file), ini untuk WRITE (upload file baru).

1. Buka **[script.google.com](https://script.google.com)**
2. Klik **"New Project"** (tombol + di kiri atas)
3. Hapus semua kode yang ada di editor
4. **Copy-paste seluruh kode berikut:**

```javascript
// ============================================================
// DriveUploader — Google Apps Script Backend
// Deploy: Web App | Execute as: Me | Who has access: Anyone
// ============================================================

// ── KONFIGURASI (hanya 1 baris yang perlu diubah!) ───────────
const UPLOAD_PASSCODE  = 'GANTI_PASSCODE_INI';             // ← Buat passcode sesukamu
const TARGET_FOLDER_ID = '1h-L2Www0WneLByudxNpMRgENYttFFk54'; // ← Sudah diisi (folder filesharedrive)

// ── Handler GET (health check) ───────────────────────────────
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'DriveUploader API siap ✅' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Handler POST (upload file) ───────────────────────────────
function doPost(e) {
  var out = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);

  try {
    var data = JSON.parse(e.postData.contents);

    // Validasi passcode
    if (!data.passcode || data.passcode !== UPLOAD_PASSCODE) {
      return out.setContent(JSON.stringify({ success: false, error: 'Kode akses salah.' }));
    }

    // Validasi data file
    if (!data.fileName || !data.fileData) {
      return out.setContent(JSON.stringify({ success: false, error: 'Data file tidak lengkap.' }));
    }

    // Decode base64 → blob
    var bytes  = Utilities.base64Decode(data.fileData);
    var blob   = Utilities.newBlob(bytes, data.mimeType || 'application/octet-stream', data.fileName);

    // Pilih folder tujuan (dari request atau default config)
    var fid    = (data.folderId && data.folderId.trim()) ? data.folderId.trim() : TARGET_FOLDER_ID;
    var folder = fid ? DriveApp.getFolderById(fid) : DriveApp.getRootFolder();

    // Simpan file ke Google Drive
    var file = folder.createFile(blob);

    // Return sukses
    return out.setContent(JSON.stringify({
      success:  true,
      fileId:   file.getId(),
      fileName: file.getName(),
      driveUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view'
    }));

  } catch (err) {
    return out.setContent(JSON.stringify({ success: false, error: err.message }));
  }
}
```

5. Klik **Save** (Ctrl+S) → beri nama project: `DriveUploader-Upload`
6. Klik **Deploy** → **New deployment**
7. Klik ikon ⚙️ → pilih tipe **Web app**
8. Set pengaturan:
   - **Execute as**: `Me` ← WAJIB
   - **Who has access**: `Anyone` ← WAJIB
9. Klik **Deploy** → Klik **Authorize access** → pilih akun Google kamu
10. ✅ Copy **Web app URL** yang muncul (format: `https://script.google.com/macros/s/AKfycbx.../exec`)

---

### Langkah 2 — Isi 2 Nilai di `js/uploader.js`

Buka file `js/uploader.js`, cari bagian `CONFIG` di atas, isi 2 baris ini:

```javascript
// Baris 24 — paste URL dari langkah 1:
APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbx.../exec',

// Baris 32 — buat passcode yang SAMA dengan di Apps Script:
UPLOAD_PASSCODE: 'GANTI_PASSCODE_INI',
```

> ⚠️ **Passcode di `uploader.js` dan di Apps Script harus SAMA persis!**

Selesai! Buka `index.html`, masukkan passcode, dan upload file. ✅

---

## 📁 Struktur Folder

```
uploadfile/
├── index.html          ← Halaman utama (3 screen: login, upload, hasil)
├── css/
│   ├── style.css       ← Desain premium dark mode glassmorphism
│   └── animations.css  ← Micro-animations & transitions
├── js/
│   └── uploader.js     ← Logika upload + CONFIG (isi APPS_SCRIPT_URL & PASSCODE)
└── README.md           ← Panduan ini
```

---

## 🔗 Koneksi dengan FileDrive Portal

| | `filesharedrive` (download) | `uploadfile` (upload) |
|---|---|---|
| **Folder Drive** | `1h-L2Www0WneLByudxNpMRgENYttFFk54` | `1h-L2Www0WneLByudxNpMRgENYttFFk54` |
| **Apps Script** | Script lama (baca file) | Script baru (tulis/upload file) |
| **Akses user** | Publik (siapapun bisa download) | Passcode (hanya yang tahu kode bisa upload) |

File yang diupload lewat **DriveUploader** → masuk ke folder yang sama → langsung muncul di **FileDrive Portal**. ✅

---

## ⚠️ Catatan Penting

| Hal | Detail |
|---|---|
| **Batas ukuran** | Maksimal ~50MB per file (batasan Google Apps Script) |
| **Keamanan** | Passcode divalidasi di sisi Apps Script (server-side) |
| **Deploy ulang** | Jika ubah kode Apps Script → harus **New deployment** (bukan edit existing) |
| **Gratis** | Tidak butuh billing, VPS, atau API key Google Cloud |

---

## 💡 Lisensi

Bebas digunakan, dimodifikasi, dan didistribusikan.
