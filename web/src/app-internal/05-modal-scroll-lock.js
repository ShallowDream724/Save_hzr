    /** ---------------------------
     * 2.1) Modal scroll lock (prevents background scroll chaining)
     * --------------------------- */
    var modalPageLock = null;
    var modalObserverInstalled = false;

    function lockPageScrollForModal() {
      if (modalPageLock) return;
      // Drag lock already uses fixed-body; do not interfere.
      try { if (drag && drag.pageLock) return; } catch (_) {}

      var y = getScrollY();
      modalPageLock = {
        scrollY: y,
        bodyPos: document.body.style.position,
        bodyTop: document.body.style.top,
        bodyLeft: document.body.style.left,
        bodyRight: document.body.style.right,
        bodyWidth: document.body.style.width,
        htmlOverflow: document.documentElement.style.overflow
      };

      document.documentElement.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = (-y) + 'px';
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
    }

    function unlockPageScrollForModal() {
      if (!modalPageLock) return;
      try { if (drag && drag.pageLock) return; } catch (_) {}

      var lock = modalPageLock;
      modalPageLock = null;

      document.documentElement.style.overflow = lock.htmlOverflow;
      document.body.style.position = lock.bodyPos;
      document.body.style.top = lock.bodyTop;
      document.body.style.left = lock.bodyLeft;
      document.body.style.right = lock.bodyRight;
      document.body.style.width = lock.bodyWidth;

      window.scrollTo(0, lock.scrollY);
    }

    function anyModalOpen() {
      try {
        return !!document.querySelector('.modal-overlay.open');
      } catch (_) {
        return false;
      }
    }

    function syncModalScrollLock() {
      var on = anyModalOpen();
      try { document.body.classList.toggle('modal-open', on); } catch (_) {}
      if (on) lockPageScrollForModal();
      else unlockPageScrollForModal();
    }

    function installModalScrollWatcher() {
      if (modalObserverInstalled) return;
      modalObserverInstalled = true;
      if (typeof MutationObserver === 'undefined') return;

      try {
        var nodes = [
          els.importModal,
          els.folderModal,
          els.bookModal,
          els.authModal,
          els.settingsModal,
          els.aiChatModal,
          els.aiImportModal,
          els.aiHistoryModal
        ];
        var obs = new MutationObserver(function () { syncModalScrollLock(); });
        for (var i = 0; i < nodes.length; i++) {
          if (!nodes[i]) continue;
          obs.observe(nodes[i], { attributes: true, attributeFilter: ['class'] });
        }
        syncModalScrollLock();
      } catch (_) {}
    }

    function formatLocalTime(iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function formatDateTag(iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
    }

    function shortId(id) {
      try {
        var s = String(id || '').trim();
        if (!s) return '';
        s = s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (s.length <= 5) return s;
        return s.slice(-5);
      } catch (e) {
        return '';
      }
    }

    function detectPlatformLabel() {
      var ua = '';
      try { ua = String(navigator.userAgent || ''); } catch (e) { ua = ''; }
      var lower = ua.toLowerCase();

      if (lower.indexOf('iphone') !== -1) return 'iPhone';
      if (lower.indexOf('ipad') !== -1) return 'iPad';
      if (lower.indexOf('android') !== -1) {
        // Very rough: Android tablet tends to lack 'mobile'
        return (lower.indexOf('mobile') !== -1) ? 'Android手机' : 'Android平板';
      }
      if (lower.indexOf('windows') !== -1) return 'Windows';
      if (lower.indexOf('macintosh') !== -1 || lower.indexOf('mac os') !== -1) return 'macOS';
      if (lower.indexOf('linux') !== -1) return 'Linux';
      return '未知设备';
    }

    function detectBrowserLabel() {
      var ua = '';
      try { ua = String(navigator.userAgent || ''); } catch (e) { ua = ''; }
      var lower = ua.toLowerCase();
      if (lower.indexOf('edg/') !== -1) return 'Edge';
      if (lower.indexOf('chrome/') !== -1 && lower.indexOf('chromium') === -1) return 'Chrome';
      if (lower.indexOf('safari/') !== -1 && lower.indexOf('chrome/') === -1) return 'Safari';
      if (lower.indexOf('firefox/') !== -1) return 'Firefox';
      return 'Browser';
    }

    function getOrCreateDeviceId() {
      var KEY = 'hzr_device_id_v1';
      try {
        var existing = localStorage.getItem(KEY);
        if (existing && String(existing).trim()) return String(existing).trim();
      } catch (e) {}

      var id = 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(KEY, id); } catch (e2) {}
      return id;
    }

    function getDeviceLabel() {
      var name = '';
      try { name = String(localStorage.getItem('hzr_device_name_v1') || '').trim(); } catch (e) { name = ''; }
      var base = detectPlatformLabel() + ' · ' + detectBrowserLabel();
      var sid = shortId(getOrCreateDeviceId());
      var suffix = sid ? ('#' + sid) : '';
      if (name) return name + '（' + base + (suffix ? (' ' + suffix) : '') + '）';
      return base + (suffix ? (' ' + suffix) : '');
    }

    function deviceLabelFromArchive(a) {
      if (!a) return '';
      if (a.deviceLabel && String(a.deviceLabel).trim()) return String(a.deviceLabel).trim();
      return '';
    }

    function escapeAttr(s) {
      return escapeHtml(s).replace(/"/g, '&quot;');
    }

    function bookCoverColors(id) {
      var palette = [
        ['#BFD9FF', '#D8C7FF'], // blue -> lilac
        ['#BFEBDD', '#BFD9FF'], // mint -> blue
        ['#F7B4C9', '#FFD0A6'], // pink -> peach
        ['#FFE08A', '#FFD0A6'], // lemon -> peach
        ['#D8C7FF', '#F7B4C9'], // lilac -> pink
        ['#BFEAF2', '#BFEBDD'], // cyan -> mint
        ['#F2E6D8', '#BFD9FF']  // cream -> blue
      ];
      var h = hashStr(String(id || ''));
      return palette[h % palette.length];
    }

    function downloadJson(filename, obj) {
      try {
        var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        alert('导出失败');
      }
    }

    var toastState = { timer: 0, el: null, action: null, removeTimer: 0 };
    function showToast(message, opts) {
      opts = opts || {};
      if (!els.toastHost) return;

      if (toastState.timer) { window.clearTimeout(toastState.timer); toastState.timer = 0; }
      if (toastState.removeTimer) { window.clearTimeout(toastState.removeTimer); toastState.removeTimer = 0; }
      if (toastState.el && toastState.el.remove) toastState.el.remove();
      toastState.el = null;
      toastState.action = null;

      var el = document.createElement('div');
      el.className = 'toast';
      el.innerHTML = '<div class="toast-msg"></div>';
      el.querySelector('.toast-msg').textContent = String(message || '');

      if (opts.actionText && typeof opts.onAction === 'function') {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-btn';
        btn.textContent = opts.actionText;
        btn.onclick = function () {
          try { opts.onAction(); } catch (e) {}
          hideToast(true);
        };
        el.appendChild(btn);
      }

      els.toastHost.appendChild(el);
      toastState.el = el;

      var ms = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 5000;
      toastState.timer = window.setTimeout(function () {
        hideToast(false);
      }, ms);
    }

    function hideToast(immediate) {
      immediate = !!immediate;
      if (toastState.timer) { window.clearTimeout(toastState.timer); toastState.timer = 0; }
      if (toastState.removeTimer) { window.clearTimeout(toastState.removeTimer); toastState.removeTimer = 0; }

      var el = toastState.el;
      if (!el) return;

      if (immediate) {
        if (el.remove) el.remove();
        toastState.el = null;
        toastState.action = null;
        return;
      }

      try { el.classList.add('closing'); } catch (_) {}
      toastState.removeTimer = window.setTimeout(function () {
        if (el.remove) el.remove();
        toastState.removeTimer = 0;
        toastState.el = null;
        toastState.action = null;
      }, 180);
      toastState.el = null;
      toastState.action = null;
    }

    function summarizeLibrary(data) {
      if (!data || typeof data !== 'object') return { books: 0, folders: 0, chapters: 0, deleted: 0 };
      // New app format
      if (Array.isArray(data.books)) {
        var books = data.books;
        var totalFolders = 0;
        var totalChapters = 0;
        var totalDeleted = 0;
        for (var i = 0; i < books.length; i++) {
          var b = books[i] || {};
          totalFolders += Array.isArray(b.folders) ? b.folders.length : 0;
          totalChapters += Array.isArray(b.chapters) ? b.chapters.length : 0;
          totalDeleted += Array.isArray(b.deletedChapterIds) ? b.deletedChapterIds.length : 0;
        }
        return { books: books.length, folders: totalFolders, chapters: totalChapters, deleted: totalDeleted };
      }
      // Legacy
      return {
        books: 1,
        folders: Array.isArray(data.folders) ? data.folders.length : 0,
        chapters: Array.isArray(data.chapters) ? data.chapters.length : 0,
        deleted: Array.isArray(data.deletedChapterIds) ? data.deletedChapterIds.length : 0
      };
    }

    function appHasAnyContent(data) {
      if (!data || typeof data !== 'object') return false;
      if (Array.isArray(data.books)) {
        for (var i = 0; i < data.books.length; i++) {
          var b = data.books[i] || {};
          if ((Array.isArray(b.chapters) && b.chapters.length) || (Array.isArray(b.folders) && b.folders.length)) return true;
        }
        return false;
      }
      return (Array.isArray(data.chapters) && data.chapters.length) || (Array.isArray(data.folders) && data.folders.length);
    }

    function hash32(str) {
      try {
        var s = String(str || '');
        var h = 2166136261;
        for (var i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0; // FNV-1a
        }
        return h >>> 0;
      } catch (e) {
        return 0;
      }
    }

    function librarySignature(data) {
      // 用于“是否需要备份”判断：忽略纯 UI 状态（folder.isOpen）+ 忽略全局 UI 配色
      try {
        if (!data || typeof data !== 'object') return '';
        // New app format
        if (Array.isArray(data.books)) {
          var sigApp = {
            books: data.books.map(function (b) {
              b = b || {};
              var deleted = Array.isArray(b.deletedChapterIds) ? b.deletedChapterIds.slice() : [];
              deleted.sort();
              return {
                id: b.id,
                title: b.title,
                includePresets: !!b.includePresets,
                folders: Array.isArray(b.folders) ? b.folders.map(function (f) { return { id: f && f.id, title: f && f.title }; }) : [],
                chapters: Array.isArray(b.chapters) ? b.chapters : [],
                layoutMap: (b.layoutMap && typeof b.layoutMap === 'object') ? b.layoutMap : {},
                deletedChapterIds: deleted
              };
            }),
            currentBookId: data.currentBookId || null
          };
          return JSON.stringify(sigApp);
        }
        // Legacy
        var sig = {
          folders: Array.isArray(data.folders) ? data.folders.map(function (f) { return { id: f && f.id, title: f && f.title }; }) : [],
          chapters: Array.isArray(data.chapters) ? data.chapters : [],
          layoutMap: data.layoutMap && typeof data.layoutMap === 'object' ? data.layoutMap : {},
          deletedChapterIds: Array.isArray(data.deletedChapterIds) ? data.deletedChapterIds.slice() : []
        };
        sig.deletedChapterIds.sort();
        return JSON.stringify(sig);
      } catch (e) {
        return '';
      }
    }
  
