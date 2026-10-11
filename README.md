# ☁️ DriveUploader

**DriveUploader** adalah aplikasi web yang memungkinkan siapapun mengupload file langsung ke Google Drive milik pemilik — **tanpa perlu login Google account**. Cukup masukkan kode akses dan upload!

Aplikasi ini dapat dipasangkan dengan portal download publik (seperti FileDrive Portal). File yang diupload akan tersimpan di Google Drive dan langsung muncul di portal download jika menggunakan **Folder ID yang sama**.

---

## ✨ Fitur

- 🔐 **Proteksi Passcode** — Hanya pengguna dengan kode akses yang dapat mengupload
- 📂 **Drag & Drop** — Seret file langsung ke area upload
- 📋 **Multi-file** — Upload beberapa file sekaligus (maksimal 10 per batch)
- 📊 **Progress Real-time** — Progress bar per file dan keseluruhan
- 🌑 **Dark Mode Premium** — UI glassmorphism dengan micro-animations
- 📱 **Responsive** — Optimal di perangkat desktop dan mobile
- 🔗 **Terintegrasi** — Dapat diarahkan ke folder Google Drive tujuan yang ditentukan

---

## 🛠️ Arsitektur

```
Browser (HTML + JS)
    ↓  POST JSON (base64 file + passcode)
Google Apps Script Web App  (berjalan dengan izin akun Google pemilik)
    ↓  DriveApp.createFile()
Google Drive  →  Folder Tujuan: YOUR_TARGET_FOLDER_ID
    ↓  (dihubungkan ke portal download)
Download Portal  →  File langsung dapat diakses/diunduh ✅
```

---

## 🚀 Panduan Setup (2 Langkah)

### Langkah 1 — Buat Google Apps Script Backend (untuk UPLOAD)

1. Buka **[script.google.com](https://script.google.com)**
2. Klik **"New Project"** (tombol + di kiri atas)
3. Hapus semua kode default di editor
4. **Copy-paste kode backend berikut:**

```javascript
// ============================================================
// DriveUploader — Google Apps Script Backend
// Deploy: Web App | Execute as: Me | Who has access: Anyone
// ============================================================

// ── KONFIGURASI ──────────────────────────────────────────────
const UPLOAD_PASSCODE  = 'GANTI_DENGAN_PASSCODE_ANDA';        // ← Buat passcode rahasia
const TARGET_FOLDER_ID = 'GANTI_DENGAN_FOLDER_ID_DRIVE_ANDA'; // ← ID folder Google Drive tujuan

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

5. Klik **Save** (Ctrl+S) → beri nama project, misal: `DriveUploader-Backend`
6. Klik **Deploy** → **New deployment**
7. Klik ikon gerigi (⚙️) di sebelah "Select type" → pilih **Web app**
8. Konfigurasi deployment:
   - **Execute as**: `Me` (**Wajib**)
   - **Who has access**: `Anyone` (**Wajib**)
9. Klik **Deploy** → Klik **Authorize access** → pilih akun Google Anda dan izinkan akses
10. ✅ Salin **Web app URL** yang dihasilkan (format: `https://script.google.com/macros/s/AKfycbx.../exec`)

---

### Langkah 2 — Konfigurasi di `js/uploader.js`

Buka file `js/uploader.js`, temukan bagian `CONFIG` di baris atas, lalu sesuaikan nilainya:

```javascript
// Paste Web App URL dari Langkah 1:
APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbx.../exec',

// Buat passcode yang SAMA dengan di script Google Apps Script:
UPLOAD_PASSCODE: 'GANTI_DENGAN_PASSCODE_ANDA',

// ID folder Google Drive tujuan:
DEFAULT_FOLDER_ID: 'GANTI_DENGAN_FOLDER_ID_DRIVE_ANDA',
```

> ⚠️ **Catatan Penting:** Nilai `UPLOAD_PASSCODE` pada `uploader.js` dan di script Google Apps Script harus **persis sama**.

Selesai! Buka `index.html` di browser, masukkan passcode yang telah dibuat, dan aplikasi siap digunakan. ✅

---

## 📁 Struktur Folder

```
uploadfile/
├── index.html          ← Halaman antarmuka (Login, Upload, Status Hasil)
├── css/
│   ├── style.css       ← Styling dark mode modern & glassmorphism
│   └── animations.css  ← Animasi & transisi UI
├── js/
│   └── uploader.js     ← Logika upload & konfigurasi client
└── README.md           ← Dokumentasi proyek
```

---

## 🔗 Integrasi dengan Portal Download

Jika Anda menghubungkan aplikasi ini dengan portal download publik:

| Parameter | Portal Download | DriveUploader (Upload) |
|---|---|---|
| **Folder Google Drive** | `ID_FOLDER_DRIVE` | `ID_FOLDER_DRIVE` (Gunakan folder yang sama) |
| **Fungsi Script** | Membaca daftar file | Mengunggah file baru |
| **Hak Akses** | Terbuka untuk umum (unduh) | Dilindungi Passcode (unggah) |

File yang diunggah melalui **DriveUploader** akan langsung tersimpan di folder Google Drive tersebut dan dapat ditampilkan secara instan di portal download. ✅

---

## ⚠️ Informasi Teknis & Batasan

| Hal | Keterangan |
|---|---|
| **Batas Ukuran File** | Maksimal ~50MB per file (batasan payload Google Apps Script) |
| **Keamanan** | Verifikasi passcode dilakukan di sisi server (Google Apps Script) |
| **Pembaruan Kode** | Jika ada perubahan kode di Apps Script, lakukan **New deployment** |
| **Biaya** | Gratis, tidak memerlukan Google Cloud Billing atau VPS |

---

## 💡 Lisensi

Bebas digunakan, dimodifikasi, dan didistribusikan untuk keperluan pribadi maupun komersial.
