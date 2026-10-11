// ============================================================
// DriveUploader — Google Apps Script Backend
// Deploy: Web App | Execute as: Me | Who has access: Anyone
// ============================================================

// ── KONFIGURASI ───────────────────────────────────────────────
const UPLOAD_PASSCODE = 'Upload1234!';                        // ← Sudah diisi, JANGAN diubah
const TARGET_FOLDER_ID = '1h-L2Www0WneLByudxNpMRgENYttFFk54'; // ← Folder filesharedrive

// ── Handler GET ───────────────────────────────────────────────
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'DriveUploader API siap ✅' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Handler POST (upload file) ────────────────────────────────
function doPost(e) {
  var out = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);

  try {
    var data = JSON.parse(e.postData.contents);

    // Validasi passcode
    if (!data.passcode || data.passcode !== UPLOAD_PASSCODE) {
      return out.setContent(JSON.stringify({ success: false, error: 'Kode akses salah. Passcode tidak cocok.' }));
    }

    // Validasi data file
    if (!data.fileName || !data.fileData) {
      return out.setContent(JSON.stringify({ success: false, error: 'Data file tidak lengkap.' }));
    }

    // Decode base64 → blob
    var bytes = Utilities.base64Decode(data.fileData);
    var blob = Utilities.newBlob(bytes, data.mimeType || 'application/octet-stream', data.fileName);

    // Pilih folder tujuan
    var fid = (data.folderId && data.folderId.trim()) ? data.folderId.trim() : TARGET_FOLDER_ID;
    var folder = fid ? DriveApp.getFolderById(fid) : DriveApp.getRootFolder();

    // Simpan file ke Google Drive
    var file = folder.createFile(blob);

    // Return sukses
    return out.setContent(JSON.stringify({
      success: true,
      fileId: file.getId(),
      fileName: file.getName(),
      driveUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view'
    }));

  } catch (err) {
    return out.setContent(JSON.stringify({ success: false, error: err.message }));
  }
}
