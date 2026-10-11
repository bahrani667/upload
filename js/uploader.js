/* =============================================================
   DriveUploader — uploader.js
   Model: Public Upload via Google Apps Script Proxy
   Konsep: Siapapun bisa upload ke Google Drive pemilik
           tanpa perlu login Google account.
   
   CARA PAKAI:
   1. Buat Google Apps Script Web App (kode di bawah README)
   2. Deploy sebagai Web App → "Anyone" dapat akses
   3. Isi APPS_SCRIPT_URL dan UPLOAD_PASSCODE di bawah
   ============================================================= */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     KONFIGURASI — Isi sesuai dengan setup kamu
  ══════════════════════════════════════════════════════════ */
  const CONFIG = {
    /**
     * URL Google Apps Script Web App kamu.
     * Contoh: 'https://script.google.com/macros/s/AKfy.../exec'
     */
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwHzwQUktCF6q29YR1RUFva4ZANuZEdycHgRKrGT33mvlJqJz1dj7bNVHY8fZv4pdJEsg/exec',

    /**
     * Passcode/kode akses untuk proteksi upload.
     * Siapapun yang tahu kode ini bisa upload ke Drive kamu.
     * Ubah ke string apapun yang kamu inginkan.
     * Contoh: 'rahasia123', 'tim-alpha-2025'
     */
    // Buat passcode apapun yang kamu mau — harus SAMA dengan di Apps Script upload
    UPLOAD_PASSCODE: 'Herman1234!',

    /**
     * Folder ID tujuan upload (dari filesharedrive — sudah diisi otomatis!)
     * Folder ini SAMA dengan yang digunakan filesharedrive, sehingga
     * file yang diupload di sini langsung muncul di portal download.
     * Nilai ini bisa di-override oleh user lewat UI.
     */
    DEFAULT_FOLDER_ID: '1h-L2Www0WneLByudxNpMRgENYttFFk54',

    /**
     * URL Apps Script Web App filesharedrive (untuk MEMBACA daftar file di Drive).
     * Ini adalah Apps Script yang berbeda dari APPS_SCRIPT_URL (untuk upload).
     * Digunakan untuk menampilkan file yang sudah ada di Google Drive.
     */
    FILESHAREDRIVE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxuRTQ5RgEu6KZc_A-zhCSt_EBFAvu_17Q0-SCHRmGBUhrl8k5amDZ0LlDwlBfsfhgf/exec',

    /**
     * Batas ukuran file yang diizinkan (dalam bytes).
     * 50MB = 50 * 1024 * 1024 = 52428800
     * Apps Script punya limit payload ~50MB.
     */
    MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024,

    /**
     * Jumlah maksimal file dalam satu batch upload.
     */
    MAX_FILES_PER_BATCH: 10,

    /**
     * Timeout request ke Apps Script (ms).
     * 5 menit untuk file besar.
     */
    REQUEST_TIMEOUT_MS: 5 * 60 * 1000,
  };

  /* ══════════════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════════════ */
  const state = {
    isVerified: false,        // passcode sudah diverifikasi
    fileQueue: [],            // array of { id, file, status, progress }
    isUploading: false,       // sedang ada proses upload
    results: [],              // array of upload results
    nextFileId: 0,            // counter untuk ID file unik
  };

  /* ══════════════════════════════════════════════════════════
     UTILITY HELPERS
  ══════════════════════════════════════════════════════════ */

  /** Generate unique ID */
  function uid() {
    return 'f_' + (state.nextFileId++);
  }

  /**
   * Format bytes ke string yang terbaca manusia.
   * @param {number} bytes
   * @returns {string}
   */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Kembalikan emoji icon berdasarkan ekstensi file.
   * @param {string} filename
   * @returns {string}
   */
  function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
      // Documents
      pdf: '📄', doc: '📝', docx: '📝', txt: '📃', rtf: '📃',
      xls: '📊', xlsx: '📊', csv: '📊', ppt: '📊', pptx: '📊',
      // Archives
      zip: '🗜️', rar: '🗜️', '7z': '🗜️', tar: '🗜️', gz: '🗜️',
      // Images
      jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️',
      svg: '🖼️', bmp: '🖼️', tiff: '🖼️', ico: '🖼️',
      // Video
      mp4: '🎬', avi: '🎬', mkv: '🎬', mov: '🎬', wmv: '🎬',
      flv: '🎬', webm: '🎬',
      // Audio
      mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵',
      // Code
      js: '💻', ts: '💻', py: '💻', java: '💻', kt: '💻',
      html: '💻', css: '💻', json: '💻', xml: '💻', sh: '💻',
      // Disk images
      iso: '💿', img: '💿', dmg: '💿',
      // Executables
      exe: '⚙️', msi: '⚙️', apk: '📱', deb: '⚙️', rpm: '⚙️',
    };
    return map[ext] || '📎';
  }

  /**
   * Debounce — tunggu sebentar sebelum eksekusi.
   * @param {Function} fn
   * @param {number} delay
   */
  function debounce(fn, delay) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }

  /* ══════════════════════════════════════════════════════════
     TOAST NOTIFICATIONS
  ══════════════════════════════════════════════════════════ */
  const ToastManager = {
    container: null,

    init() {
      this.container = document.getElementById('toast-container');
    },

    /**
     * Tampilkan toast notification.
     * @param {string} message
     * @param {'info'|'success'|'error'|'warn'} type
     * @param {number} duration ms
     */
    show(message, type = 'info', duration = 4000) {
      const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' };
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.innerHTML = `<span aria-hidden="true">${icons[type]}</span><span>${message}</span>`;
      this.container.appendChild(toast);

      setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => toast.remove());
      }, duration);
    }
  };

  /* ══════════════════════════════════════════════════════════
     BACKGROUND CANVAS (particles)
  ══════════════════════════════════════════════════════════ */
  const CanvasManager = {
    canvas: null,
    ctx: null,
    particles: [],
    raf: null,

    init() {
      this.canvas = document.getElementById('bg-canvas');
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.resize();
      this.createParticles();
      this.loop();
      window.addEventListener('resize', () => this.resize());
    },

    resize() {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    },

    createParticles() {
      const count = Math.floor((window.innerWidth * window.innerHeight) / 18000);
      this.particles = Array.from({ length: count }, () => ({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        r: Math.random() * 1.5 + 0.5,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        alpha: Math.random() * 0.4 + 0.1,
      }));
    },

    loop() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      for (const p of this.particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = this.canvas.width;
        if (p.x > this.canvas.width) p.x = 0;
        if (p.y < 0) p.y = this.canvas.height;
        if (p.y > this.canvas.height) p.y = 0;

        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(108,99,255,${p.alpha})`;
        this.ctx.fill();
      }
      this.raf = requestAnimationFrame(() => this.loop());
    }
  };

  /* ══════════════════════════════════════════════════════════
     SCREEN MANAGER
  ══════════════════════════════════════════════════════════ */
  const ScreenManager = {
    current: 'login',

    /**
     * Ganti screen yang aktif.
     * @param {'login'|'upload'|'result'} name
     */
    show(name) {
      const prev = document.querySelector('.screen.active');
      const next = document.getElementById(`screen-${name}`);
      if (!next || prev === next) return;

      if (prev) {
        prev.classList.remove('active');
      }
      next.classList.add('active', 'screen-enter');
      next.addEventListener('animationend', () => {
        next.classList.remove('screen-enter');
      }, { once: true });

      this.current = name;
    }
  };

  /* ══════════════════════════════════════════════════════════
     AUTH / PASSCODE MANAGER
  ══════════════════════════════════════════════════════════ */
  const AuthManager = {
    elInput: null,
    elError: null,
    elBtnVerify: null,
    elToggle: null,
    elGateArea: null,

    init() {
      this.elInput = document.getElementById('access-code');
      this.elError = document.getElementById('access-error');
      this.elBtnVerify = document.getElementById('btn-verify-code');
      this.elToggle = document.getElementById('toggle-code-visibility');
      this.elGateArea = document.getElementById('access-gate');

      // Toggle visibility
      this.elToggle.addEventListener('click', () => {
        const isPass = this.elInput.type === 'password';
        this.elInput.type = isPass ? 'text' : 'password';
        this.elToggle.textContent = isPass ? '🙈' : '👁️';
      });

      // Verify on button click
      this.elBtnVerify.addEventListener('click', () => this.verifyCode());

      // Verify on Enter key
      this.elInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.verifyCode();
        this.clearError();
      });

      // Check if passcode is configured
      if (CONFIG.UPLOAD_PASSCODE === 'BUAT_PASSCODE_DISINI') {
        this.showConfigWarning();
      }
    },

    showConfigWarning() {
      ToastManager.show(
        'Konfigurasi belum lengkap! Isi APPS_SCRIPT_URL dan UPLOAD_PASSCODE di js/uploader.js',
        'warn',
        10000
      );
    },

    clearError() {
      this.elError.textContent = '';
    },

    setError(msg) {
      this.elError.textContent = msg;
      this.elInput.style.borderColor = 'var(--accent-danger)';
      this.elInput.style.boxShadow = '0 0 0 3px rgba(255,77,109,0.15)';
      // Shake animation
      this.elInput.animate([
        { transform: 'translateX(0)' },
        { transform: 'translateX(-6px)' },
        { transform: 'translateX(6px)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' },
      ], { duration: 400, easing: 'ease' });
    },

    verifyCode() {
      const entered = this.elInput.value.trim();

      if (!entered) {
        this.setError('Kode akses tidak boleh kosong.');
        return;
      }

      if (entered !== CONFIG.UPLOAD_PASSCODE) {
        this.setError('Kode akses salah. Coba lagi.');
        this.elInput.value = '';
        this.elInput.focus();
        return;
      }

      // Code is correct!
      state.isVerified = true;
      this.clearError();
      this.elInput.style.borderColor = '';
      this.elInput.style.boxShadow = '';

      // Hide gate, show "proceed" → go directly to upload screen
      this.elGateArea.innerHTML = `
        <div style="text-align:center;padding:12px 0;">
          <div style="font-size:2rem;margin-bottom:8px;animation:popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)">✅</div>
          <p style="color:var(--accent-success);font-weight:600;font-size:0.9rem;">Akses diberikan!</p>
        </div>
      `;

      // Short delay then switch to upload screen
      setTimeout(() => {
        ScreenManager.show('upload');
        UploadManager.init();
      }, 800);

      ToastManager.show('Selamat datang! Pilih file untuk diupload.', 'success');
    }
  };

  /* ══════════════════════════════════════════════════════════
     FILE QUEUE MANAGER
  ══════════════════════════════════════════════════════════ */
  const QueueManager = {
    /**
     * Tambah file ke antrian.
     * @param {FileList|File[]} files
     */
    addFiles(files) {
      let addedCount = 0;
      let skippedCount = 0;
      let skippedReason = '';

      for (const file of files) {
        // Check max batch
        if (state.fileQueue.length >= CONFIG.MAX_FILES_PER_BATCH) {
          skippedCount++;
          skippedReason = `Maksimal ${CONFIG.MAX_FILES_PER_BATCH} file per batch.`;
          break;
        }

        // Check duplicate
        const isDuplicate = state.fileQueue.some(
          item => item.file.name === file.name && item.file.size === file.size
        );
        if (isDuplicate) {
          skippedCount++;
          skippedReason = 'File duplikat dilewati.';
          continue;
        }

        // Check size limit
        if (file.size > CONFIG.MAX_FILE_SIZE_BYTES) {
          ToastManager.show(
            `"${file.name}" (${formatBytes(file.size)}) melebihi batas 50MB dan dilewati.`,
            'warn',
            6000
          );
          skippedCount++;
          continue;
        }

        const id = uid();
        state.fileQueue.push({ id, file, status: 'pending', progress: 0, driveUrl: null, error: null });
        addedCount++;
      }

      if (addedCount > 0) {
        UIManager.renderFileList();
        UIManager.showQueueSection();
        if (skippedCount > 0 && skippedReason) {
          ToastManager.show(skippedReason, 'warn');
        }
      } else if (skippedCount > 0) {
        ToastManager.show(skippedReason || `${skippedCount} file tidak ditambahkan.`, 'warn');
      }
    },

    /**
     * Hapus satu file dari antrian.
     * @param {string} id
     */
    removeFile(id) {
      const el = document.querySelector(`[data-file-id="${id}"]`);
      if (el) {
        el.classList.add('removing');
        el.addEventListener('animationend', () => {
          state.fileQueue = state.fileQueue.filter(f => f.id !== id);
          UIManager.renderFileList();
          UIManager.updateQueueCount();
          if (state.fileQueue.length === 0) UIManager.hideQueueSection();
        }, { once: true });
      } else {
        state.fileQueue = state.fileQueue.filter(f => f.id !== id);
        UIManager.renderFileList();
      }
    },

    /** Hapus semua file pending dari antrian */
    clearQueue() {
      state.fileQueue = state.fileQueue.filter(f => f.status === 'uploading');
      UIManager.renderFileList();
      UIManager.updateQueueCount();
      if (state.fileQueue.length === 0) UIManager.hideQueueSection();
    },

    /** Update status dan progress sebuah file */
    updateFile(id, updates) {
      const item = state.fileQueue.find(f => f.id === id);
      if (item) Object.assign(item, updates);
    }
  };

  /* ══════════════════════════════════════════════════════════
     UPLOAD MANAGER
  ══════════════════════════════════════════════════════════ */
  const UploadManager = {
    elDropZone: null,
    elFileInput: null,
    elFolderId: null,
    elBtnUpload: null,
    elBtnClear: null,
    elBtnLogout: null,

    init() {
      this.elDropZone = document.getElementById('drop-zone');
      this.elFileInput = document.getElementById('file-input');
      this.elFolderId = document.getElementById('folder-id');
      this.elBtnUpload = document.getElementById('btn-upload-all');
      this.elBtnClear = document.getElementById('btn-clear-queue');
      this.elBtnLogout = document.getElementById('btn-logout');

      // Auto-isi Folder ID dari config (sama dengan folder filesharedrive)
      if (this.elFolderId && CONFIG.DEFAULT_FOLDER_ID) {
        this.elFolderId.value = CONFIG.DEFAULT_FOLDER_ID;
        this.elFolderId.style.borderColor = 'var(--accent-success)';
        this.elFolderId.title = 'Folder ID otomatis diisi dari konfigurasi filesharedrive';
      }

      this._bindDropZone();
      this._bindButtons();

      // Initialize Drive file browser
      DriveBrowser.init();
    },

    _bindDropZone() {
      const dz = this.elDropZone;

      // Click to open file picker
      dz.addEventListener('click', (e) => {
        if (e.target !== this.elFileInput) {
          this.elFileInput.click();
        }
      });

      // Keyboard accessibility
      dz.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.elFileInput.click();
        }
      });

      // File input change
      this.elFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          QueueManager.addFiles(e.target.files);
          e.target.value = ''; // reset so same file can be re-added
        }
      });

      // Drag events
      dz.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.add('drag-over');
      });

      dz.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        dz.classList.add('drag-over');
      });

      dz.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!dz.contains(e.relatedTarget)) {
          dz.classList.remove('drag-over');
        }
      });

      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove('drag-over');
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          QueueManager.addFiles(files);
        }
      });
    },

    _bindButtons() {
      this.elBtnUpload.addEventListener('click', () => this.startUploadAll());
      this.elBtnClear.addEventListener('click', () => QueueManager.clearQueue());
      this.elBtnLogout.addEventListener('click', () => this.logout());
      document.getElementById('btn-upload-more').addEventListener('click', () => this.goBackToUpload());
      document.getElementById('btn-result-logout').addEventListener('click', () => this.logout());
    },

    logout() {
      state.isVerified = false;
      state.fileQueue = [];
      state.results = [];
      state.nextFileId = 0;
      state.isUploading = false;

      // Reset UI
      const gate = document.getElementById('access-gate');
      gate.innerHTML = `
        <div class="input-group">
          <label for="access-code" class="input-label">Kode Akses</label>
          <div class="input-wrap">
            <span class="input-icon">🔐</span>
            <input type="password" id="access-code" class="text-input"
              placeholder="Masukkan kode akses..." autocomplete="off" aria-required="true" />
            <button id="toggle-code-visibility" class="toggle-vis-btn" type="button"
              aria-label="Tampilkan/sembunyikan kode">👁️</button>
          </div>
          <p id="access-error" class="field-error" role="alert" aria-live="assertive"></p>
        </div>
        <button id="btn-verify-code" class="btn btn-primary btn-full" type="button">
          <span class="btn-icon">🔓</span>
          <span>Verifikasi Akses</span>
        </button>
      `;

      // Re-init auth listeners
      AuthManager.elInput = document.getElementById('access-code');
      AuthManager.elError = document.getElementById('access-error');
      AuthManager.elBtnVerify = document.getElementById('btn-verify-code');
      AuthManager.elToggle = document.getElementById('toggle-code-visibility');
      AuthManager.elGateArea = document.getElementById('access-gate');
      AuthManager.init();

      ScreenManager.show('login');
      ToastManager.show('Berhasil logout.', 'info');
    },

    goBackToUpload() {
      state.fileQueue = [];
      state.results = [];
      UIManager.renderFileList();
      UIManager.hideQueueSection();
      document.getElementById('overall-progress').classList.add('hidden');
      ScreenManager.show('upload');
    },

    /**
     * Mulai upload semua file pending di antrian.
     */
    async startUploadAll() {
      if (state.isUploading) return;

      const pending = state.fileQueue.filter(f => f.status === 'pending');
      if (pending.length === 0) {
        ToastManager.show('Tidak ada file yang menunggu untuk diupload.', 'warn');
        return;
      }

      // Validate config
      if (CONFIG.APPS_SCRIPT_URL === 'PASTE_URL_APPS_SCRIPT_DISINI') {
        ToastManager.show(
          'Error: APPS_SCRIPT_URL belum diisi di js/uploader.js!',
          'error',
          8000
        );
        return;
      }

      const folderId = this.elFolderId ? this.elFolderId.value.trim() : '';

      state.isUploading = true;
      state.results = [];

      // Update button state
      this.elBtnUpload.disabled = true;
      this.elBtnUpload.classList.add('loading');
      document.getElementById('btn-upload-label').textContent = 'Mengupload...';

      // Show overall progress
      const overallEl = document.getElementById('overall-progress');
      overallEl.classList.remove('hidden');

      let completedCount = 0;

      // Upload files one by one (sequential — Apps Script tidak bisa parallel)
      for (const item of pending) {
        QueueManager.updateFile(item.id, { status: 'uploading' });
        UIManager.updateFileItemState(item.id, 'uploading');

        try {
          const result = await this.uploadSingleFile(item, folderId);
          QueueManager.updateFile(item.id, {
            status: 'success',
            driveUrl: result.driveUrl,
            progress: 100
          });
          UIManager.updateFileItemState(item.id, 'success', result.driveUrl);
          state.results.push({ ...item, status: 'success', driveUrl: result.driveUrl });
        } catch (err) {
          const errMsg = err.message || 'Upload gagal.';
          QueueManager.updateFile(item.id, { status: 'error', error: errMsg });
          UIManager.updateFileItemState(item.id, 'error', null, errMsg);
          state.results.push({ ...item, status: 'error', error: errMsg });
        }

        completedCount++;
        const overallPct = Math.round((completedCount / pending.length) * 100);
        UIManager.updateOverallProgress(overallPct);
      }

      state.isUploading = false;

      // Reset button
      this.elBtnUpload.disabled = false;
      this.elBtnUpload.classList.remove('loading');
      document.getElementById('btn-upload-label').textContent = 'Upload ke Google Drive';

      // Go to result screen
      setTimeout(() => {
        ResultManager.show(state.results);
      }, 600);
    },

    /**
     * Upload satu file ke Apps Script Web App.
     * 
     * Apps Script menerima:
     * - file: File binary (via FormData)
     * - passcode: string
     * - folderId: string (optional)
     * 
     * Apps Script mengembalikan JSON:
     * - { success: true, fileId: "...", fileName: "...", driveUrl: "..." }
     * - { success: false, error: "..." }
     * 
     * @param {{ id: string, file: File }} item
     * @param {string} folderId
     * @returns {Promise<{ driveUrl: string }>}
     */
    uploadSingleFile(item, folderId) {
      return new Promise(async (resolve, reject) => {
        const { id, file } = item;

        try {
          // Step 1 — Baca file sebagai base64
          UIManager.updateFileProgress(id, 10);
          const base64Data = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload  = (e) => res(e.target.result.split(',')[1]);
            reader.onerror = () => rej(new Error('Gagal membaca file dari disk.'));
            reader.readAsDataURL(file);
          });

          // Step 2 — Siapkan payload
          UIManager.updateFileProgress(id, 25);
          const payload = {
            passcode: CONFIG.UPLOAD_PASSCODE,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            fileData: base64Data,
            folderId: folderId || '',
          };

          console.log('[DriveUploader] Mengirim ke Apps Script...', {
            url:      CONFIG.APPS_SCRIPT_URL,
            fileName: file.name,
            size:     file.size,
            folderId: folderId || '(root)',
          });

          // Step 3 — Kirim ke Apps Script via fetch
          // fetch menangani redirect 302 dari Apps Script dengan benar
          // Tidak ada custom header → tidak ada CORS preflight
          UIManager.updateFileProgress(id, 40);

          const controller = new AbortController();
          const timeoutId  = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

          let response;
          try {
            response = await fetch(CONFIG.APPS_SCRIPT_URL, {
              method:   'POST',
              body:     JSON.stringify(payload),
              signal:   controller.signal,
              // Tidak set Content-Type → browser kirim sebagai text/plain
              // Ini penting: menghindari CORS preflight OPTIONS
            });
          } finally {
            clearTimeout(timeoutId);
          }

          UIManager.updateFileProgress(id, 80);

          // Step 4 — Parse response
          const rawText = await response.text();
          console.log('[DriveUploader] Response raw:', rawText.substring(0, 300));

          let resp;
          try {
            resp = JSON.parse(rawText);
          } catch (_) {
            throw new Error('Response tidak valid dari server: ' + rawText.substring(0, 150));
          }

          console.log('[DriveUploader] Response parsed:', resp);

          if (resp.success) {
            UIManager.updateFileProgress(id, 100);
            resolve({ driveUrl: resp.driveUrl || `https://drive.google.com/file/d/${resp.fileId}/view` });
          } else {
            throw new Error(resp.error || 'Server mengembalikan error tidak diketahui.');
          }

        } catch (err) {
          if (err.name === 'AbortError') {
            reject(new Error('Request timeout — file terlalu besar atau koneksi lambat.'));
          } else {
            console.error('[DriveUploader] Upload error:', err);
            reject(err);
          }
        }
      });
    }

  };

  /* ══════════════════════════════════════════════════════════
     UI MANAGER
  ══════════════════════════════════════════════════════════ */
  const UIManager = {

    showQueueSection() {
      document.getElementById('file-queue-section').classList.remove('hidden');
      this.updateQueueCount();
    },

    hideQueueSection() {
      document.getElementById('file-queue-section').classList.add('hidden');
    },

    updateQueueCount() {
      const el = document.getElementById('queue-count');
      if (el) el.textContent = `${state.fileQueue.length} file`;
    },

    updateOverallProgress(pct) {
      const fill = document.getElementById('overall-progress-fill');
      const text = document.getElementById('overall-progress-text');
      const track = document.querySelector('.progress-bar-track');
      if (fill) fill.style.width = `${pct}%`;
      if (text) text.textContent = `${pct}%`;
      if (track) track.setAttribute('aria-valuenow', pct);
    },

    /**
     * Render ulang seluruh file list dari state.fileQueue
     */
    renderFileList() {
      const list = document.getElementById('file-list');
      if (!list) return;

      // Remove items that are no longer in queue
      const existingIds = new Set(Array.from(list.children).map(el => el.dataset.fileId));
      const queueIds = new Set(state.fileQueue.map(f => f.id));

      for (const id of existingIds) {
        if (!queueIds.has(id)) {
          const el = list.querySelector(`[data-file-id="${id}"]`);
          if (el) el.remove();
        }
      }

      // Add new items
      for (const item of state.fileQueue) {
        if (!existingIds.has(item.id)) {
          const el = this.createFileItemEl(item);
          list.appendChild(el);
        }
      }

      this.updateQueueCount();
    },

    /**
     * Buat elemen HTML untuk satu file di antrian.
     * @param {{ id, file, status, progress }} item
     * @returns {HTMLElement}
     */
    createFileItemEl(item) {
      const { id, file, status } = item;
      const li = document.createElement('div');
      li.className = 'file-item';
      li.setAttribute('role', 'listitem');
      li.setAttribute('data-file-id', id);

      li.innerHTML = `
        <div class="file-type-icon" aria-hidden="true">${getFileIcon(file.name)}</div>
        <div class="file-meta">
          <div class="file-name" title="${file.name}">${file.name}</div>
          <div class="file-size">${formatBytes(file.size)}</div>
          <div class="file-progress-wrap ${status === 'pending' ? 'hidden' : ''}">
            <div class="file-progress-track">
              <div class="file-progress-fill" style="width:${item.progress}%"></div>
            </div>
            <div class="file-status-text">Menunggu...</div>
          </div>
        </div>
        <div class="file-action">
          <button
            class="file-remove-btn"
            data-remove-id="${id}"
            aria-label="Hapus ${file.name} dari antrian"
            title="Hapus dari antrian"
          >✕</button>
        </div>
      `;

      // Bind remove button
      li.querySelector('.file-remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        QueueManager.removeFile(id);
      });

      return li;
    },

    /**
     * Update tampilan progress bar satu file.
     * @param {string} id
     * @param {number} pct
     */
    updateFileProgress(id, pct) {
      const el = document.querySelector(`[data-file-id="${id}"]`);
      if (!el) return;

      const fill = el.querySelector('.file-progress-fill');
      const text = el.querySelector('.file-status-text');
      const wrap = el.querySelector('.file-progress-wrap');

      if (wrap) wrap.classList.remove('hidden');
      if (fill) fill.style.width = `${pct}%`;
      if (text) text.textContent = `Mengupload... ${pct}%`;
    },

    /**
     * Update state visual sebuah file item (status class + icon).
     * @param {string} id
     * @param {'uploading'|'success'|'error'} status
     * @param {string|null} driveUrl
     * @param {string|null} errorMsg
     */
    updateFileItemState(id, status, driveUrl = null, errorMsg = null) {
      const el = document.querySelector(`[data-file-id="${id}"]`);
      if (!el) return;

      el.classList.remove('uploading', 'success', 'error');
      el.classList.add(status);

      const actionEl = el.querySelector('.file-action');
      const textEl = el.querySelector('.file-status-text');
      const wrapEl = el.querySelector('.file-progress-wrap');

      if (wrapEl) wrapEl.classList.remove('hidden');

      if (status === 'uploading') {
        if (actionEl) actionEl.innerHTML = `<span class="file-status-icon" aria-label="Mengupload">⏳</span>`;
        if (textEl) { textEl.textContent = 'Mengupload...'; textEl.className = 'file-status-text'; }
      } else if (status === 'success') {
        if (actionEl) actionEl.innerHTML = `<span class="file-status-icon" aria-label="Berhasil">✅</span>`;
        if (textEl) {
          textEl.className = 'file-status-text success';
          if (driveUrl) {
            textEl.innerHTML = `Berhasil! <a href="${driveUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-end)">Lihat di Drive ↗</a>`;
          } else {
            textEl.textContent = 'Berhasil diupload!';
          }
        }
      } else if (status === 'error') {
        if (actionEl) actionEl.innerHTML = `<span class="file-status-icon" aria-label="Gagal">❌</span>`;
        if (textEl) {
          textEl.className = 'file-status-text error';
          textEl.textContent = errorMsg || 'Upload gagal.';
        }
      }
    }
  };

  /* ══════════════════════════════════════════════════════════
     DRIVE FILE BROWSER — Menampilkan file yang sudah ada di Drive
  ══════════════════════════════════════════════════════════ */
  const DriveBrowser = {
    files: [],
    filteredFiles: [],
    isLoading: false,

    init() {
      // Bind refresh button
      const btnRefresh = document.getElementById('btn-refresh-drive');
      if (btnRefresh) {
        btnRefresh.addEventListener('click', () => this.fetchFiles());
      }

      // Bind retry button
      const btnRetry = document.getElementById('btn-retry-drive');
      if (btnRetry) {
        btnRetry.addEventListener('click', () => this.fetchFiles());
      }

      // Bind search
      const searchInput = document.getElementById('drive-search');
      if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
          this.filterFiles(searchInput.value.trim().toLowerCase());
        }, 250));
      }

      // Fetch files on init
      this.fetchFiles();
    },

    async fetchFiles() {
      if (this.isLoading) return;
      this.isLoading = true;

      const listEl = document.getElementById('drive-file-list');
      const loadingEl = document.getElementById('drive-loading');
      const emptyEl = document.getElementById('drive-empty');
      const errorEl = document.getElementById('drive-error');
      const countEl = document.getElementById('drive-file-count');

      // Reset states
      if (listEl) listEl.innerHTML = '';
      if (loadingEl) {
        loadingEl.remove(); // remove old if exists
      }
      // Show loading
      if (listEl) {
        listEl.innerHTML = `
          <div class="drive-loading" id="drive-loading">
            <div class="drive-spinner"></div>
            <span>Mengambil data dari Google Drive...</span>
          </div>
        `;
      }
      if (emptyEl) emptyEl.classList.add('hidden');
      if (errorEl) errorEl.classList.add('hidden');
      if (countEl) countEl.textContent = 'Memuat...';

      // Update refresh button
      const btnRefresh = document.getElementById('btn-refresh-drive');
      if (btnRefresh) {
        btnRefresh.disabled = true;
        btnRefresh.innerHTML = '⏳ Memuat...';
      }

      try {
        const response = await fetch(CONFIG.FILESHAREDRIVE_SCRIPT_URL);
        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        const rawFiles = data.files || [];

        // Normalize files
        this.files = rawFiles.map((f, idx) => {
          const name = f.name || f.fileName || f.title || `File_${idx + 1}`;
          const ext = name.split('.').pop().toLowerCase();

          // Handle size
          let sizeDisplay = '';
          let sizeBytes = f.sizeBytes || f.fileSize || f.sizeInBytes || 0;
          if (sizeBytes && sizeBytes > 0) {
            sizeDisplay = formatBytes(Number(sizeBytes));
          } else if (typeof f.size === 'number' && f.size > 0) {
            sizeDisplay = formatBytes(f.size);
            sizeBytes = f.size;
          } else if (typeof f.size === 'string' && f.size) {
            sizeDisplay = f.size;
          } else {
            sizeDisplay = '—';
          }

          // Handle type
          let type = f.type || ext || '';
          if (type.includes('/')) {
            type = ext || type.split('/').pop();
          }

          return {
            id: f.id || f.driveId || `file-${idx}`,
            driveId: f.driveId || f.id || f.fileId || '',
            name: name,
            type: type.toLowerCase(),
            ext: ext,
            size: sizeDisplay,
            sizeBytes: Number(sizeBytes) || 0,
            desc: f.desc || f.description || '',
          };
        });

        this.filteredFiles = [...this.files];
        this.renderFiles();

        // Update count
        if (countEl) {
          const totalSize = this.files.reduce((sum, f) => sum + f.sizeBytes, 0);
          const sizeStr = totalSize > 0 ? ` · ${formatBytes(totalSize)}` : '';
          countEl.textContent = `${this.files.length} file${sizeStr}`;
        }

        if (this.files.length === 0) {
          if (emptyEl) emptyEl.classList.remove('hidden');
        }

        console.log(`[DriveBrowser] Berhasil memuat ${this.files.length} file dari Drive.`);

      } catch (err) {
        console.error('[DriveBrowser] Error fetching files:', err);
        if (listEl) listEl.innerHTML = '';
        if (errorEl) {
          errorEl.classList.remove('hidden');
          const errMsg = document.getElementById('drive-error-msg');
          if (errMsg) errMsg.textContent = `Gagal mengambil data: ${err.message}`;
        }
        if (countEl) countEl.textContent = 'Error';
      } finally {
        this.isLoading = false;
        if (btnRefresh) {
          btnRefresh.disabled = false;
          btnRefresh.innerHTML = '🔄 Refresh';
        }
      }
    },

    filterFiles(query) {
      if (!query) {
        this.filteredFiles = [...this.files];
      } else {
        this.filteredFiles = this.files.filter(f =>
          f.name.toLowerCase().includes(query) ||
          f.type.toLowerCase().includes(query) ||
          f.ext.toLowerCase().includes(query)
        );
      }
      this.renderFiles();

      const countEl = document.getElementById('drive-file-count');
      if (countEl) {
        if (query && this.filteredFiles.length !== this.files.length) {
          countEl.textContent = `${this.filteredFiles.length} / ${this.files.length} file`;
        } else {
          const totalSize = this.files.reduce((sum, f) => sum + f.sizeBytes, 0);
          const sizeStr = totalSize > 0 ? ` · ${formatBytes(totalSize)}` : '';
          countEl.textContent = `${this.files.length} file${sizeStr}`;
        }
      }
    },

    renderFiles() {
      const listEl = document.getElementById('drive-file-list');
      const emptyEl = document.getElementById('drive-empty');
      if (!listEl) return;

      listEl.innerHTML = '';

      if (this.filteredFiles.length === 0 && this.files.length > 0) {
        // Search returned no results
        listEl.innerHTML = `
          <div class="drive-no-results">
            <span>🔍</span>
            <span>Tidak ada file yang cocok.</span>
          </div>
        `;
        return;
      }

      if (this.filteredFiles.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }

      if (emptyEl) emptyEl.classList.add('hidden');

      this.filteredFiles.forEach((file, i) => {
        const el = document.createElement('div');
        el.className = 'drive-file-item';
        el.setAttribute('role', 'listitem');
        el.style.animationDelay = `${i * 0.03}s`;

        const icon = getFileIcon(file.name);
        const viewUrl = `https://drive.google.com/file/d/${file.driveId}/view`;

        el.innerHTML = `
          <div class="drive-file-icon" aria-hidden="true">${icon}</div>
          <div class="drive-file-info">
            <div class="drive-file-name" title="${file.name}">${file.name}</div>
            <div class="drive-file-meta">
              <span class="drive-file-size">${file.size}</span>
              <span class="drive-file-type-badge">${file.ext.toUpperCase() || file.type.toUpperCase()}</span>
            </div>
          </div>
          <div class="drive-file-actions">
            <a href="${viewUrl}" target="_blank" rel="noopener noreferrer" class="drive-file-link" title="Buka di Google Drive" aria-label="Buka ${file.name} di Google Drive">
              Buka ↗
            </a>
          </div>
        `;

        listEl.appendChild(el);
      });
    }
  };

  /* ══════════════════════════════════════════════════════════
     RESULT MANAGER
  ══════════════════════════════════════════════════════════ */
  const ResultManager = {
    show(results) {
      const successList = results.filter(r => r.status === 'success');
      const failList = results.filter(r => r.status === 'error');
      const totalBytes = results.reduce((sum, r) => sum + r.file.size, 0);

      // Update stats
      document.getElementById('stat-success').textContent = successList.length;
      document.getElementById('stat-failed').textContent = failList.length;
      document.getElementById('stat-total-size').textContent = formatBytes(totalBytes);

      // Update header
      const icon = document.getElementById('result-icon');
      const title = document.getElementById('result-title');
      const subtitle = document.getElementById('result-subtitle');

      if (failList.length === 0) {
        icon.textContent = '🎉';
        title.textContent = 'Semua Berhasil!';
        subtitle.textContent = `${successList.length} file berhasil diupload ke Google Drive.`;
      } else if (successList.length === 0) {
        icon.textContent = '😢';
        title.textContent = 'Upload Gagal';
        subtitle.textContent = 'Semua file gagal diupload. Periksa koneksi dan konfigurasi.';
      } else {
        icon.textContent = '⚠️';
        title.textContent = 'Sebagian Berhasil';
        subtitle.textContent = `${successList.length} berhasil, ${failList.length} gagal.`;
      }

      // Render file result list
      const listEl = document.getElementById('result-file-list');
      listEl.innerHTML = '';

      results.forEach((r, i) => {
        const el = document.createElement('div');
        el.className = `result-file-item ${r.status}`;
        el.setAttribute('role', 'listitem');
        el.style.animationDelay = `${i * 0.06}s`;

        const icon = getFileIcon(r.file.name);
        let actionHtml = '';

        if (r.status === 'success' && r.driveUrl) {
          actionHtml = `<a href="${r.driveUrl}" target="_blank" rel="noopener noreferrer" class="result-file-link" aria-label="Buka ${r.file.name} di Google Drive">Buka ↗</a>`;
        } else if (r.status === 'error') {
          actionHtml = `<span class="result-file-error" title="${r.error || ''}">❌ Gagal</span>`;
        }

        el.innerHTML = `
          <span aria-hidden="true" style="font-size:1.3rem;">${icon}</span>
          <span class="result-file-name" title="${r.file.name}">${r.file.name}</span>
          <span style="font-size:0.75rem;color:var(--text-muted);flex-shrink:0;">${formatBytes(r.file.size)}</span>
          ${actionHtml}
        `;

        listEl.appendChild(el);
      });

      ScreenManager.show('result');

      if (successList.length > 0) {
        ToastManager.show(
          `${successList.length} file berhasil diupload ke Google Drive!`,
          'success',
          5000
        );
      }
    }
  };

  /* ══════════════════════════════════════════════════════════
     INIT — Entry Point
  ══════════════════════════════════════════════════════════ */
  function init() {
    // Init canvas background
    CanvasManager.init();

    // Init toast
    ToastManager.init();

    // Init auth/passcode
    AuthManager.init();

    // Show login screen
    ScreenManager.show('login');
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
