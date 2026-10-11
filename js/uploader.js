/* =============================================================
   DriveUploader — uploader.js
   Model: Public Upload via Google Apps Script Proxy
   Konsep: Siapapun yang memiliki kode akses dapat mengupload
           ke Google Drive pemilik tanpa perlu login Google account.
   ============================================================= */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     KONFIGURASI — Nilai Terkonfigurasi
  ══════════════════════════════════════════════════════════ */
  const CONFIG = {
    /**
     * URL Google Apps Script Web App untuk Upload.
     */
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwHzwQUktCF6q29YR1RUFva4ZANuZEdycHgRKrGT33mvlJqJz1dj7bNVHY8fZv4pdJEsg/exec',

    /**
     * Passcode/kode akses untuk proteksi upload.
     */
    UPLOAD_PASSCODE: 'Upload1234!',

    /**
     * Folder ID tujuan upload (terkoneksi langsung ke portal filesharedrive).
     */
    DEFAULT_FOLDER_ID: '1h-L2Www0WneLByudxNpMRgENYttFFk54',

    /**
     * URL Apps Script Web App filesharedrive (untuk MEMBACA daftar file di Drive).
     */
    FILESHAREDRIVE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxuRTQ5RgEu6KZc_A-zhCSt_EBFAvu_17Q0-SCHRmGBUhrl8k5amDZ0LlDwlBfsfhgf/exec',

    /**
     * Batas ukuran file yang diizinkan (dalam bytes).
     * 50MB = 50 * 1024 * 1024 = 52428800
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
     STATE APLIKASI
  ══════════════════════════════════════════════════════════ */
  const state = {
    isVerified: false,
    fileQueue: [],      // array of { id, file, status, progress, driveUrl, error }
    isUploading: false,
    results: [],
    nextFileId: 0,
  };

  /* ══════════════════════════════════════════════════════════
     UTILITY HELPERS
  ══════════════════════════════════════════════════════════ */

  /** Generate unique file ID */
  function uid() {
    return 'f_' + (state.nextFileId++);
  }

  /**
   * Format bytes ke ukuran yang terbaca manusia.
   * @param {number} bytes
   * @returns {string}
   */
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Mengembalikan icon berdasarkan ekstensi file.
   * @param {string} filename
   * @returns {string}
   */
  function getFileIcon(filename) {
    if (!filename) return '📎';
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
      // Documents
      pdf: '📄', doc: '📝', docx: '📝', txt: '📃', rtf: '📃',
      xls: '📊', xlsx: '📊', csv: '📊', ppt: '📊', pptx: '📊',
      // Archives
      zip: '🗜️', rar: '🗜️', '7z': '🗜️', tar: '🗜️', gz: '🗜️', iso: '💿',
      // Images
      jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️',
      svg: '🖼️', bmp: '🖼️', tiff: '🖼️', ico: '🖼️',
      // Video
      mp4: '🎬', avi: '🎬', mkv: '🎬', mov: '🎬', wmv: '🎬', flv: '🎬', webm: '🎬',
      // Audio
      mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵',
      // Code
      js: '💻', ts: '💻', py: '💻', java: '💻', kt: '💻',
      html: '💻', css: '💻', json: '💻', xml: '💻', sh: '💻',
      // Executables
      exe: '⚙️', msi: '⚙️', apk: '📱', deb: '⚙️', rpm: '⚙️',
    };
    return map[ext] || '📎';
  }

  /**
   * Debounce execution
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

    show(message, type = 'info', duration = 4000) {
      if (!this.container) return;
      const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' };
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.innerHTML = `<span aria-hidden="true" style="font-size:1.1rem;flex-shrink:0;">${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
      this.container.appendChild(toast);

      setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => toast.remove());
      }, duration);
    }
  };

  /* ══════════════════════════════════════════════════════════
     BACKGROUND CANVAS (Constellation Particles)
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
      window.addEventListener('resize', debounce(() => {
        this.resize();
        this.createParticles();
      }, 200));
    },

    resize() {
      if (!this.canvas) return;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    },

    createParticles() {
      if (!this.canvas) return;
      const count = Math.min(Math.floor((window.innerWidth * window.innerHeight) / 16000), 80);
      this.particles = Array.from({ length: count }, () => ({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        r: Math.random() * 1.5 + 0.6,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        alpha: Math.random() * 0.45 + 0.15,
      }));
    },

    loop() {
      if (!this.ctx || !this.canvas) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      const len = this.particles.length;

      // Draw subtle connecting constellation lines
      for (let i = 0; i < len; i++) {
        for (let j = i + 1; j < len; j++) {
          const dx = this.particles[i].x - this.particles[j].x;
          const dy = this.particles[i].y - this.particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            this.ctx.beginPath();
            this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
            this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
            this.ctx.strokeStyle = `rgba(99, 102, 241, ${(1 - dist / 100) * 0.12})`;
            this.ctx.lineWidth = 0.7;
            this.ctx.stroke();
          }
        }
      }

      // Draw and move particles
      for (const p of this.particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = this.canvas.width;
        if (p.x > this.canvas.width) p.x = 0;
        if (p.y < 0) p.y = this.canvas.height;
        if (p.y > this.canvas.height) p.y = 0;

        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(129, 140, 248, ${p.alpha})`;
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  /* ══════════════════════════════════════════════════════════
     TAB MANAGER (Mobile / Tablet Segmented Control)
  ══════════════════════════════════════════════════════════ */
  const TabManager = {
    activeTab: 'upload',

    init() {
      const btnUpload = document.getElementById('tab-btn-upload');
      const btnDrive = document.getElementById('tab-btn-drive');
      const paneUpload = document.getElementById('pane-upload');
      const paneDrive = document.getElementById('pane-drive');

      if (paneUpload) paneUpload.classList.add('active-tab');

      if (btnUpload) {
        btnUpload.addEventListener('click', () => this.switchTab('upload'));
      }
      if (btnDrive) {
        btnDrive.addEventListener('click', () => this.switchTab('drive'));
      }
    },

    switchTab(tab) {
      this.activeTab = tab;
      const btnUpload = document.getElementById('tab-btn-upload');
      const btnDrive = document.getElementById('tab-btn-drive');
      const paneUpload = document.getElementById('pane-upload');
      const paneDrive = document.getElementById('pane-drive');

      if (tab === 'upload') {
        if (btnUpload) { btnUpload.classList.add('active'); btnUpload.setAttribute('aria-selected', 'true'); }
        if (btnDrive) { btnDrive.classList.remove('active'); btnDrive.setAttribute('aria-selected', 'false'); }
        if (paneUpload) paneUpload.classList.add('active-tab');
        if (paneDrive) paneDrive.classList.remove('active-tab');
      } else {
        if (btnDrive) { btnDrive.classList.add('active'); btnDrive.setAttribute('aria-selected', 'true'); }
        if (btnUpload) { btnUpload.classList.remove('active'); btnUpload.setAttribute('aria-selected', 'false'); }
        if (paneDrive) paneDrive.classList.add('active-tab');
        if (paneUpload) paneUpload.classList.remove('active-tab');
      }
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

      if (!this.elInput || !this.elBtnVerify) return;

      // Toggle visibility
      if (this.elToggle) {
        this.elToggle.addEventListener('click', () => {
          const isPass = this.elInput.type === 'password';
          this.elInput.type = isPass ? 'text' : 'password';
          this.elToggle.innerHTML = isPass ? `
            <svg class="eye-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
              <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
          ` : `
            <svg class="eye-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          `;
        });
      }

      // Verify on click
      this.elBtnVerify.addEventListener('click', () => this.verifyCode());

      // Verify on Enter key
      this.elInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.verifyCode();
        this.clearError();
      });
    },

    clearError() {
      if (this.elError) this.elError.textContent = '';
      if (this.elInput) {
        this.elInput.style.borderColor = '';
        this.elInput.style.boxShadow = '';
      }
    },

    setError(msg) {
      if (this.elError) this.elError.textContent = msg;
      if (this.elInput) {
        this.elInput.style.borderColor = 'var(--accent-danger)';
        this.elInput.style.boxShadow = '0 0 0 3px rgba(244, 63, 94, 0.2)';
        this.elInput.animate([
          { transform: 'translateX(0)' },
          { transform: 'translateX(-6px)' },
          { transform: 'translateX(6px)' },
          { transform: 'translateX(-4px)' },
          { transform: 'translateX(4px)' },
          { transform: 'translateX(0)' },
        ], { duration: 380, easing: 'ease' });
      }
    },

    verifyCode() {
      const entered = this.elInput ? this.elInput.value.trim() : '';

      if (!entered) {
        this.setError('Kode akses tidak boleh kosong.');
        return;
      }

      if (entered !== CONFIG.UPLOAD_PASSCODE) {
        this.setError('Kode akses salah. Silakan periksa kembali.');
        this.elInput.value = '';
        this.elInput.focus();
        return;
      }

      // Valid passcode!
      state.isVerified = true;
      this.clearError();

      if (this.elGateArea) {
        this.elGateArea.innerHTML = `
          <div style="text-align:center;padding:16px 0;animation:popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)">
            <div style="width:48px;height:48px;border-radius:50%;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;color:var(--accent-success);font-size:1.4rem;">✓</div>
            <p style="color:var(--accent-success);font-weight:700;font-size:0.95rem;">Akses Terverifikasi!</p>
            <span style="font-size:0.8rem;color:var(--text-muted);">Membuka ruang kerja upload...</span>
          </div>
        `;
      }

      setTimeout(() => {
        ScreenManager.show('upload');
        UploadManager.init();
      }, 700);

      ToastManager.show('Akses berhasil diverifikasi. Selamat datang!', 'success');
    }
  };

  /* ══════════════════════════════════════════════════════════
     FILE QUEUE MANAGER
  ══════════════════════════════════════════════════════════ */
  const QueueManager = {
    addFiles(files) {
      let addedCount = 0;
      let skippedCount = 0;
      let skippedReason = '';

      for (const file of files) {
        if (state.fileQueue.length >= CONFIG.MAX_FILES_PER_BATCH) {
          skippedCount++;
          skippedReason = `Maksimal ${CONFIG.MAX_FILES_PER_BATCH} file per batch upload.`;
          break;
        }

        const isDuplicate = state.fileQueue.some(
          item => item.file.name === file.name && item.file.size === file.size
        );
        if (isDuplicate) {
          skippedCount++;
          skippedReason = 'File duplikat dilewati.';
          continue;
        }

        if (file.size > CONFIG.MAX_FILE_SIZE_BYTES) {
          ToastManager.show(
            `"${file.name}" (${formatBytes(file.size)}) melebihi batas 50MB.`,
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
        UIManager.updateQueueCount();
        if (state.fileQueue.length === 0) UIManager.hideQueueSection();
      }
    },

    clearQueue() {
      state.fileQueue = state.fileQueue.filter(f => f.status === 'uploading');
      UIManager.renderFileList();
      UIManager.updateQueueCount();
      if (state.fileQueue.length === 0) UIManager.hideQueueSection();
    },

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
    isInitialized: false,

    init() {
      this.elDropZone = document.getElementById('drop-zone');
      this.elFileInput = document.getElementById('file-input');
      this.elFolderId = document.getElementById('folder-id');
      this.elBtnUpload = document.getElementById('btn-upload-all');
      this.elBtnClear = document.getElementById('btn-clear-queue');
      this.elBtnLogout = document.getElementById('btn-logout');

      // Auto-isi Folder ID dari konfigurasi
      if (this.elFolderId && CONFIG.DEFAULT_FOLDER_ID) {
        this.elFolderId.value = CONFIG.DEFAULT_FOLDER_ID;
        this.elFolderId.title = 'Folder ID otomatis diisi dari konfigurasi filesharedrive';
      }

      if (!this.isInitialized) {
        this._bindDropZone();
        this._bindButtons();
        TabManager.init();
        DriveBrowser.init();
        this.isInitialized = true;
      }
    },

    _bindDropZone() {
      const dz = this.elDropZone;
      if (!dz) return;

      // Click to trigger input
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

      // Input change
      this.elFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          QueueManager.addFiles(e.target.files);
          e.target.value = '';
        }
      });

      // Drag and drop events
      ['dragenter', 'dragover'].forEach(eventName => {
        dz.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dz.classList.add('drag-over');
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        });
      });

      ['dragleave', 'dragend'].forEach(eventName => {
        dz.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!dz.contains(e.relatedTarget)) {
            dz.classList.remove('drag-over');
          }
        });
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
      if (this.elBtnUpload) {
        this.elBtnUpload.addEventListener('click', () => this.startUploadAll());
      }
      if (this.elBtnClear) {
        this.elBtnClear.addEventListener('click', () => QueueManager.clearQueue());
      }
      if (this.elBtnLogout) {
        this.elBtnLogout.addEventListener('click', () => this.logout());
      }

      const btnUploadMore = document.getElementById('btn-upload-more');
      if (btnUploadMore) {
        btnUploadMore.addEventListener('click', () => this.goBackToUpload());
      }

      const btnResultLogout = document.getElementById('btn-result-logout');
      if (btnResultLogout) {
        btnResultLogout.addEventListener('click', () => this.logout());
      }
    },

    logout() {
      state.isVerified = false;
      state.fileQueue = [];
      state.results = [];
      state.nextFileId = 0;
      state.isUploading = false;

      // Reset login card HTML
      const gate = document.getElementById('access-gate');
      if (gate) {
        gate.innerHTML = `
          <div class="input-group">
            <label for="access-code" class="input-label">
              <span>Kode Akses Pengunggah</span>
              <span class="label-badge">Diperlukan</span>
            </label>
            <div class="input-wrap">
              <span class="input-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0110 0v4"></path>
                </svg>
              </span>
              <input
                type="password"
                id="access-code"
                class="text-input"
                placeholder="Masukkan kode akses Anda..."
                autocomplete="current-password"
                aria-required="true"
              />
              <button id="toggle-code-visibility" class="toggle-vis-btn" type="button" aria-label="Tampilkan atau sembunyikan kode akses">
                <svg class="eye-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
            </div>
            <p id="access-error" class="field-error" role="alert" aria-live="assertive"></p>
          </div>
          <button id="btn-verify-code" class="btn btn-primary btn-full btn-glow" type="button">
            <span class="btn-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"></path>
              </svg>
            </span>
            <span>Masuk & Mulai Upload</span>
          </button>
        `;
      }

      AuthManager.init();
      ScreenManager.show('login');
      ToastManager.show('Berhasil keluar dari sesi.', 'info');
    },

    goBackToUpload() {
      state.fileQueue = [];
      state.results = [];
      UIManager.renderFileList();
      UIManager.hideQueueSection();
      const overallEl = document.getElementById('overall-progress');
      if (overallEl) overallEl.classList.add('hidden');
      ScreenManager.show('upload');
      TabManager.switchTab('upload');
    },

    async startUploadAll() {
      if (state.isUploading) return;

      const pending = state.fileQueue.filter(f => f.status === 'pending');
      if (pending.length === 0) {
        ToastManager.show('Tidak ada file pending dalam antrian.', 'warn');
        return;
      }

      const folderId = this.elFolderId ? this.elFolderId.value.trim() : '';

      state.isUploading = true;
      state.results = [];

      this.elBtnUpload.disabled = true;
      this.elBtnUpload.classList.add('loading');
      const labelEl = document.getElementById('btn-upload-label');
      if (labelEl) labelEl.textContent = 'Mengupload ke Google Drive...';

      const overallEl = document.getElementById('overall-progress');
      if (overallEl) overallEl.classList.remove('hidden');

      let completedCount = 0;

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
      this.elBtnUpload.disabled = false;
      this.elBtnUpload.classList.remove('loading');
      if (labelEl) labelEl.textContent = 'Mulai Upload ke Google Drive';

      // Refresh drive list in background
      DriveBrowser.fetchFiles();

      setTimeout(() => {
        ResultManager.show(state.results);
      }, 650);
    },

    uploadSingleFile(item, folderId) {
      return new Promise(async (resolve, reject) => {
        const { id, file } = item;

        try {
          UIManager.updateFileProgress(id, 10);
          const base64Data = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = (e) => res(e.target.result.split(',')[1]);
            reader.onerror = () => rej(new Error('Gagal membaca file dari disk.'));
            reader.readAsDataURL(file);
          });

          UIManager.updateFileProgress(id, 25);
          const payload = {
            passcode: CONFIG.UPLOAD_PASSCODE,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            fileData: base64Data,
            folderId: folderId || '',
          };

          UIManager.updateFileProgress(id, 45);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

          let response;
          try {
            response = await fetch(CONFIG.APPS_SCRIPT_URL, {
              method: 'POST',
              body: JSON.stringify(payload),
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeoutId);
          }

          UIManager.updateFileProgress(id, 80);

          const rawText = await response.text();
          let resp;
          try {
            resp = JSON.parse(rawText);
          } catch (_) {
            throw new Error('Response tidak valid dari server: ' + rawText.substring(0, 150));
          }

          if (resp.success) {
            UIManager.updateFileProgress(id, 100);
            resolve({ driveUrl: resp.driveUrl || `https://drive.google.com/file/d/${resp.fileId}/view` });
          } else {
            throw new Error(resp.error || 'Server mengembalikan kesalahan.');
          }

        } catch (err) {
          if (err.name === 'AbortError') {
            reject(new Error('Request timeout — koneksi lambat atau file besar.'));
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
      const el = document.getElementById('file-queue-section');
      if (el) el.classList.remove('hidden');
      this.updateQueueCount();
    },

    hideQueueSection() {
      const el = document.getElementById('file-queue-section');
      if (el) el.classList.add('hidden');
    },

    updateQueueCount() {
      const el = document.getElementById('queue-count');
      if (el) el.textContent = `${state.fileQueue.length} file`;

      const mobBadge = document.getElementById('mobile-queue-badge');
      if (mobBadge) {
        mobBadge.textContent = state.fileQueue.length;
        if (state.fileQueue.length > 0) {
          mobBadge.classList.remove('hidden');
        } else {
          mobBadge.classList.add('hidden');
        }
      }
    },

    updateOverallProgress(pct) {
      const fill = document.getElementById('overall-progress-fill');
      const text = document.getElementById('overall-progress-text');
      const track = document.querySelector('.progress-bar-track');
      if (fill) fill.style.width = `${pct}%`;
      if (text) text.textContent = `${pct}%`;
      if (track) track.setAttribute('aria-valuenow', pct);
    },

    renderFileList() {
      const list = document.getElementById('file-list');
      if (!list) return;

      const existingIds = new Set(Array.from(list.children).map(el => el.dataset.fileId));
      const queueIds = new Set(state.fileQueue.map(f => f.id));

      for (const id of existingIds) {
        if (!queueIds.has(id)) {
          const el = list.querySelector(`[data-file-id="${id}"]`);
          if (el) el.remove();
        }
      }

      for (const item of state.fileQueue) {
        if (!existingIds.has(item.id)) {
          const el = this.createFileItemEl(item);
          list.appendChild(el);
        }
      }

      this.updateQueueCount();
    },

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
            <div class="file-status-text">Menunggu antrian...</div>
          </div>
        </div>
        <div class="file-action">
          <button
            class="file-remove-btn"
            data-remove-id="${id}"
            aria-label="Hapus ${file.name} dari antrian"
            title="Hapus dari antrian"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `;

      li.querySelector('.file-remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        QueueManager.removeFile(id);
      });

      return li;
    },

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
            textEl.innerHTML = `Berhasil! <a href="${driveUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-cyan);text-decoration:none;font-weight:600;">Lihat di Drive ↗</a>`;
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
     DRIVE FILE BROWSER
  ══════════════════════════════════════════════════════════ */
  const DriveBrowser = {
    files: [],
    filteredFiles: [],
    isLoading: false,
    activeCategory: 'all',

    init() {
      const btnRefresh = document.getElementById('btn-refresh-drive');
      if (btnRefresh) {
        btnRefresh.addEventListener('click', () => this.fetchFiles());
      }

      const btnRetry = document.getElementById('btn-retry-drive');
      if (btnRetry) {
        btnRetry.addEventListener('click', () => this.fetchFiles());
      }

      const searchInput = document.getElementById('drive-search');
      const searchClear = document.getElementById('drive-search-clear');

      if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
          if (searchClear) {
            searchClear.classList.toggle('hidden', !searchInput.value);
          }
          this.applyFilters();
        }, 200));
      }

      if (searchClear && searchInput) {
        searchClear.addEventListener('click', () => {
          searchInput.value = '';
          searchClear.classList.add('hidden');
          this.applyFilters();
          searchInput.focus();
        });
      }

      // Filter chips
      const chips = document.querySelectorAll('.filter-chip');
      chips.forEach(chip => {
        chip.addEventListener('click', () => {
          chips.forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          this.activeCategory = chip.dataset.filter || 'all';
          this.applyFilters();
        });
      });

      this.fetchFiles();
    },

    async fetchFiles() {
      if (this.isLoading) return;
      this.isLoading = true;

      const listEl = document.getElementById('drive-file-list');
      const emptyEl = document.getElementById('drive-empty');
      const errorEl = document.getElementById('drive-error');
      const countEl = document.getElementById('drive-file-count');
      const btnRefresh = document.getElementById('btn-refresh-drive');

      if (listEl) {
        listEl.innerHTML = `
          <div class="drive-loading" id="drive-loading">
            <div class="drive-spinner"></div>
            <div class="drive-loading-text">
              <strong>Menghubungkan ke Google Drive...</strong>
              <span>Mengambil data file terbaru</span>
            </div>
          </div>
        `;
      }
      if (emptyEl) emptyEl.classList.add('hidden');
      if (errorEl) errorEl.classList.add('hidden');
      if (countEl) countEl.textContent = 'Memuat...';
      if (btnRefresh) {
        btnRefresh.disabled = true;
        btnRefresh.classList.add('loading');
      }

      try {
        const response = await fetch(CONFIG.FILESHAREDRIVE_SCRIPT_URL);
        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        const rawFiles = data.files || [];

        this.files = rawFiles.map((f, idx) => {
          const name = f.name || f.fileName || f.title || `File_${idx + 1}`;
          const ext = name.split('.').pop().toLowerCase();

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

        this.applyFilters();

        const mobDriveCount = document.getElementById('mobile-drive-count');
        if (mobDriveCount) mobDriveCount.textContent = this.files.length;

      } catch (err) {
        console.error('[DriveBrowser] Error fetching files:', err);
        if (listEl) listEl.innerHTML = '';
        if (errorEl) {
          errorEl.classList.remove('hidden');
          const errMsg = document.getElementById('drive-error-msg');
          if (errMsg) errMsg.textContent = `Gagal memuat: ${err.message}`;
        }
        if (countEl) countEl.textContent = 'Gagal';
      } finally {
        this.isLoading = false;
        if (btnRefresh) {
          btnRefresh.disabled = false;
          btnRefresh.classList.remove('loading');
        }
      }
    },

    applyFilters() {
      const searchInput = document.getElementById('drive-search');
      const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
      const category = this.activeCategory;

      const categoryExts = {
        docs: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'gdoc', 'gsheet'],
        images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff'],
        media: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'webm'],
        archives: ['zip', 'rar', '7z', 'tar', 'gz', 'iso']
      };

      this.filteredFiles = this.files.filter(f => {
        // Query match
        const matchesQuery = !query ||
          f.name.toLowerCase().includes(query) ||
          f.type.toLowerCase().includes(query) ||
          f.ext.toLowerCase().includes(query);

        if (!matchesQuery) return false;

        // Category match
        if (category === 'all') return true;
        const validExts = categoryExts[category];
        if (validExts) {
          return validExts.includes(f.ext) || validExts.includes(f.type);
        }
        return true;
      });

      this.renderFiles();

      const countEl = document.getElementById('drive-file-count');
      if (countEl) {
        if (query || category !== 'all') {
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
        listEl.innerHTML = `
          <div class="drive-no-results">
            <span>🔍</span>
            <span>Tidak ada file yang cocok dengan kriteria pencarian.</span>
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
        el.style.animationDelay = `${Math.min(i * 0.025, 0.4)}s`;

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
              <span>Buka</span>
              <span aria-hidden="true">↗</span>
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
      const totalBytes = results.reduce((sum, r) => sum + (r.file?.size || 0), 0);

      const statSuccess = document.getElementById('stat-success');
      const statFailed = document.getElementById('stat-failed');
      const statTotalSize = document.getElementById('stat-total-size');

      if (statSuccess) statSuccess.textContent = successList.length;
      if (statFailed) statFailed.textContent = failList.length;
      if (statTotalSize) statTotalSize.textContent = formatBytes(totalBytes);

      const icon = document.getElementById('result-icon');
      const title = document.getElementById('result-title');
      const subtitle = document.getElementById('result-subtitle');

      if (failList.length === 0) {
        if (icon) icon.textContent = '🎉';
        if (title) title.textContent = 'Semua Berhasil Diunggah!';
        if (subtitle) subtitle.textContent = `${successList.length} file berhasil tersimpan di Google Drive.`;
      } else if (successList.length === 0) {
        if (icon) icon.textContent = '❌';
        if (title) title.textContent = 'Unggahan Gagal';
        if (subtitle) subtitle.textContent = 'Semua file gagal diunggah. Periksa koneksi dan coba lagi.';
      } else {
        if (icon) icon.textContent = '⚠️';
        if (title) title.textContent = 'Sebagian Berhasil';
        if (subtitle) subtitle.textContent = `${successList.length} berhasil diunggah, ${failList.length} file gagal.`;
      }

      const listEl = document.getElementById('result-file-list');
      if (listEl) {
        listEl.innerHTML = '';
        results.forEach((r, i) => {
          const el = document.createElement('div');
          el.className = `result-file-item ${r.status}`;
          el.setAttribute('role', 'listitem');
          el.style.animationDelay = `${i * 0.04}s`;

          const fileName = r.file?.name || 'File';
          const fileSize = r.file?.size ? formatBytes(r.file.size) : '';
          const icon = getFileIcon(fileName);

          let actionHtml = '';
          if (r.status === 'success' && r.driveUrl) {
            actionHtml = `<a href="${r.driveUrl}" target="_blank" rel="noopener noreferrer" class="result-file-link" aria-label="Buka ${fileName} di Google Drive">Buka di Drive ↗</a>`;
          } else if (r.status === 'error') {
            actionHtml = `<span class="result-file-error" title="${r.error || ''}">Gagal: ${r.error || 'Error'}</span>`;
          }

          el.innerHTML = `
            <span aria-hidden="true" style="font-size:1.3rem;flex-shrink:0;">${icon}</span>
            <span class="result-file-name" title="${fileName}">${fileName}</span>
            <span style="font-size:0.75rem;color:var(--text-muted);flex-shrink:0;">${fileSize}</span>
            ${actionHtml}
          `;

          listEl.appendChild(el);
        });
      }

      ScreenManager.show('result');

      if (successList.length > 0) {
        ToastManager.show(`${successList.length} file berhasil diunggah ke Google Drive!`, 'success', 5000);
      }
    }
  };

  /* ══════════════════════════════════════════════════════════
     ENTRY POINT
  ══════════════════════════════════════════════════════════ */
  function init() {
    CanvasManager.init();
    ToastManager.init();
    AuthManager.init();
    ScreenManager.show('login');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
