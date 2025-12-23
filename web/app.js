/**
 * 药理学复习系统 - Reliable Drag + Full-Structure JSON Import
 * 目标：
 * 1) 移动端长按拖拽，拖拽时“只让侧边栏按需自动滚动”，主页面绝不跟着滚
 * 2) 桌面端按住移动即拖拽（阈值触发），点击灵敏
 * 3) 拖入文件夹：拖到文件夹标题/文件夹内部任意位置都算，并有反馈（高亮文件夹标题）
 * 4) JSON 导入：支持
 *    - 单 sheet：{title, questions}
 *    - 多 sheet：[{title, questions}, ...] 或 {sheets:[...]} / {chapters:[...]}
 *    - 多文件夹多 sheet（树形）：{folders:[{title, sheets:[...]}, ...], sheets:[...]}
 *    - 完整结构（含布局）：{folders, chapters/sheets, layoutMap, deletedChapterIds}
 *
 * 注意：不要求你改 CSS。拖拽幽灵元素用 inline style。
 * 存储 KEY 保持原来的，尽量兼容你已有本地数据。
 */
(function () {
    'use strict';
  
    /** ---------------------------
     * 0) 兼容：passive listener 检测 + 简易封装
     * --------------------------- */
    var supportsPassive = false;
    try {
      var _opts = Object.defineProperty({}, 'passive', {
        get: function () { supportsPassive = true; }
      });
      window.addEventListener('testPassive', null, _opts);
      window.removeEventListener('testPassive', null, _opts);
    } catch (e) {}
  
    function addEvt(target, type, handler, options) {
      if (!target) return;
      if (supportsPassive) target.addEventListener(type, handler, options || false);
      else target.addEventListener(type, handler, (options && options.capture) ? true : false);
    }
    function rmEvt(target, type, handler, options) {
      if (!target) return;
      if (supportsPassive) target.removeEventListener(type, handler, options || false);
      else target.removeEventListener(type, handler, (options && options.capture) ? true : false);
    }
  
    /** ---------------------------
     * 0.1) DOM polyfill：matches/closest（尽量兼容旧浏览器）
     * --------------------------- */
    if (!Element.prototype.matches) {
      Element.prototype.matches =
        Element.prototype.msMatchesSelector ||
        Element.prototype.webkitMatchesSelector ||
        function (s) {
          var matches = (this.document || this.ownerDocument).querySelectorAll(s);
          var i = matches.length;
          while (--i >= 0 && matches.item(i) !== this) {}
          return i > -1;
        };
    }
    if (!Element.prototype.closest) {
      Element.prototype.closest = function (s) {
        var el = this;
        while (el && el.nodeType === 1) {
          if (el.matches(s)) return el;
          el = el.parentElement || el.parentNode;
        }
        return null;
      };
    }
  
    /** ---------------------------
     * 1) 常量 / 数据
     * --------------------------- */
    var STORAGE_KEY = 'pharm_data_v4_1';
    var AUTH_TOKEN_KEY = 'pharm_sync_token_v1';
    var API_BASE = (typeof window !== 'undefined' && window.API_BASE) ? String(window.API_BASE) : '';
  
    function defaultAppData() {
      return {
        chapters: [],            // local sheets
        folders: [],             // folders
        layoutMap: {},           // { chapterId: folderId }
        deletedChapterIds: []    // deleted ids (static/local)
      };
    }
  
    var staticData = []; // preset chapters (read-only)
    var appData = defaultAppData();
    var currentChapterId = null;

    var dataLoaded = false;
    var presetsLoaded = false;

    var initialized = false;
    var uiBound = false;
    var guardsInstalled = false;
  
    var SUPPORT_POINTER = !!window.PointerEvent;

    function pushStaticChapter(title, questions) {
      var id = 'static_' + (staticData.length + 1);
      staticData.push({
        id: id,
        title: title,
        questions: questions,
        isStatic: true
      });
      return id;
    }

    function loadStaticPresets() {
      if (presetsLoaded) return Promise.resolve(true);
      presetsLoaded = true;

      // CodePen / embed fallback: allow injecting preset chapters via a global
      // window.__PRESET_CHAPTERS__ = [{ title, questions }, ...]
      try {
        if (typeof window !== 'undefined' && Array.isArray(window.__PRESET_CHAPTERS__)) {
          for (var i = 0; i < window.__PRESET_CHAPTERS__.length; i++) {
            var ch = window.__PRESET_CHAPTERS__[i];
            if (ch && typeof ch.title === 'string' && Array.isArray(ch.questions)) {
              pushStaticChapter(ch.title, ch.questions);
            }
          }
          return Promise.resolve(true);
        }
      } catch (e) {}

      if (typeof fetch !== 'function') return Promise.resolve(false);

      return fetch('./presets.json', { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) return null;
          return res.json();
        })
        .then(function (json) {
          if (!json) return false;
          var chapters = null;
          if (Array.isArray(json)) chapters = json;
          else if (json && Array.isArray(json.chapters)) chapters = json.chapters;
          if (!Array.isArray(chapters)) return false;

          for (var i = 0; i < chapters.length; i++) {
            var ch = chapters[i];
            if (ch && typeof ch.title === 'string' && Array.isArray(ch.questions)) {
              pushStaticChapter(ch.title, ch.questions);
            }
          }
          return true;
        })
        .catch(function () { return false; });
    }
  
    /** ---------------------------
     * 2) DOM 缓存
     * --------------------------- */
    var els = {};
  
    function cacheEls() {
      els.sidebarList = document.getElementById('chapterList');
      els.questionsContainer = document.getElementById('questionsContainer');
      els.chapterTitle = document.getElementById('currentChapterTitle');
      els.menuToggle = document.getElementById('menuToggle');
      els.sidebar = document.getElementById('sidebar');

      els.addFolderBtn = document.getElementById('addFolderBtn');
      els.openPasteModalBtn = document.getElementById('openPasteModalBtn');
      els.clearDataBtn = document.getElementById('clearDataBtn');
      els.fileInput = document.getElementById('fileInput');
      els.syncBtn = document.getElementById('syncBtn');
      els.syncStatus = document.getElementById('syncStatus');

      els.pasteModal = document.getElementById('pasteModal');
      els.pasteTextarea = document.getElementById('pasteTextarea');
      els.cancelPasteBtn = document.getElementById('cancelPasteBtn');
      els.confirmPasteBtn = document.getElementById('confirmPasteBtn');

      // auth modal (optional)
      els.authModal = document.getElementById('authModal');
      els.authTabLogin = document.getElementById('authTabLogin');
      els.authTabRegister = document.getElementById('authTabRegister');
      els.authLogoutBtn = document.getElementById('authLogoutBtn');
      els.authUsername = document.getElementById('authUsername');
      els.authPassword = document.getElementById('authPassword');
      els.authHint = document.getElementById('authHint');
      els.authCancelBtn = document.getElementById('authCancelBtn');
      els.authSubmitBtn = document.getElementById('authSubmitBtn');
    }
  
    /** ---------------------------
     * 3) 工具
     * --------------------------- */
    function escapeHtml(text) {
      if (text === null || text === undefined) return '';
      return String(text).replace(/[&<>"']/g, function (m) {
        return ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;'
        })[m];
      });
    }

    function applyRandomHighlights(rootEl) {
      if (!rootEl || !rootEl.querySelectorAll) return;
      var spans = rootEl.querySelectorAll('span.highlight');
      if (!spans || !spans.length) return;

      var colorClasses = ['highlight--yellow', 'highlight--pink', 'highlight--orange'];
      for (var i = 0; i < spans.length; i++) {
        var el = spans[i];
        if (!el || !el.classList) continue;
        // 如果作者已经指定了颜色，就不改
        if (el.classList.contains('highlight--yellow') ||
            el.classList.contains('highlight--pink') ||
            el.classList.contains('highlight--orange')) {
          continue;
        }
        var idx = Math.floor(Math.random() * colorClasses.length);
        el.classList.add(colorClasses[idx]);
      }
    }

    function formatInlineEmphasis(html) {
      if (html === null || html === undefined) return '';
      var s = String(html);
      // 支持常见的 Markdown 强调（AI 常写）：**加粗**、__下划线__、*斜体*
      s = s.replace(/\*\*([\s\S]+?)\*\*/g, "<span class='bold-em'>$1</span>");
      s = s.replace(/__([\s\S]+?)__/g, "<span class='underline-em'>$1</span>");
      // 仅匹配单星号，不吞掉 **...**
      s = s.replace(/(^|[^*])\*([^*]+?)\*([^*]|$)/g, "$1<span class='italic-em'>$2</span>$3");
      return s;
    }
  
    function uid(prefix) {
      prefix = prefix || 'id';
      return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }
  
    function isObject(x) {
      return x && typeof x === 'object' && !Array.isArray(x);
    }
  
    function pointInRect(x, y, rect) {
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }
  
    function getScrollY() {
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }
  
    /** ---------------------------
     * 4) 本地存储
     * --------------------------- */
    function loadLocalData() {
      if (dataLoaded) return;
      dataLoaded = true;
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          appData = defaultAppData();
          return;
        }
        var parsed = JSON.parse(raw);
        appData = {
          chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
          folders: Array.isArray(parsed.folders) ? parsed.folders : [],
          layoutMap: isObject(parsed.layoutMap) ? parsed.layoutMap : {},
          deletedChapterIds: Array.isArray(parsed.deletedChapterIds)
            ? parsed.deletedChapterIds
            : (Array.isArray(parsed.deleted) ? parsed.deleted : [])
        };
      } catch (e) {
        console.error('Data load error', e);
        appData = defaultAppData();
      }
    }
  
    function saveData() {
      // 本地缓存：可能会因容量不足失败（此时仍然允许继续使用云端同步）
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
      } catch (e) {}
      scheduleCloudSave();
    }

    function ensureDataLoaded() {
      loadLocalData();
    }

    /** ---------------------------
     * 4.1) 云端同步（注册/登录 + per-user 数据）
     * --------------------------- */
    var cloud = {
      token: null,
      version: 0,
      savingTimer: 0,
      isSaving: false,
      authMode: 'login' // login | register
    };

    function getToken() {
      if (cloud.token) return cloud.token;
      try { cloud.token = localStorage.getItem(AUTH_TOKEN_KEY) || null; } catch (e) { cloud.token = null; }
      return cloud.token;
    }
    function setToken(token) {
      cloud.token = token || null;
      try {
        if (cloud.token) localStorage.setItem(AUTH_TOKEN_KEY, cloud.token);
        else localStorage.removeItem(AUTH_TOKEN_KEY);
      } catch (e) {}
      updateSyncStatus();
    }

    function updateSyncStatus(text) {
      if (!els.syncStatus) return;
      if (text) {
        els.syncStatus.textContent = text;
        return;
      }
      var t = getToken();
      els.syncStatus.textContent = t ? '已登录 · 自动同步' : '未登录 · 仅本地';
    }

    function apiFetch(path, options) {
      options = options || {};
      var headers = options.headers || {};
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      var t = getToken();
      if (t) headers['Authorization'] = 'Bearer ' + t;
      options.headers = headers;
      return fetch(API_BASE + path, options);
    }

    function cloudLoadLibrary() {
      return apiFetch('/api/library', { method: 'GET' }).then(function (res) {
        if (!res.ok) throw new Error('load failed');
        return res.json();
      });
    }

    function cloudSaveLibrary(expectedVersion) {
      var headers = {};
      if (typeof expectedVersion === 'number') headers['If-Match'] = String(expectedVersion);
      return apiFetch('/api/library', {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify({ data: appData })
      }).then(function (res) {
        if (res.status === 409) return res.json().then(function (j) { var e = new Error('conflict'); e.conflict = j; throw e; });
        if (!res.ok) throw new Error('save failed');
        return res.json();
      });
    }

    function scheduleCloudSave() {
      if (!getToken()) return;
      if (cloud.savingTimer) window.clearTimeout(cloud.savingTimer);
      cloud.savingTimer = window.setTimeout(function () {
        cloud.savingTimer = 0;
        doCloudSave();
      }, 1200);
    }

    function doCloudSave() {
      if (!getToken()) return;
      if (cloud.isSaving) return;
      cloud.isSaving = true;
      updateSyncStatus('同步中…');

      cloudSaveLibrary(cloud.version).then(function (r) {
        cloud.version = r.version || cloud.version;
        cloud.isSaving = false;
        updateSyncStatus();
      }).catch(function (err) {
        cloud.isSaving = false;
        if (err && err.message === 'conflict') {
          updateSyncStatus('同步冲突');
          // 简易冲突处理：提示用户选覆盖/拉取
          var overwrite = confirm('检测到云端已更新（版本冲突）。\n确定=用本地覆盖云端\n取消=拉取云端覆盖本地');
          if (overwrite) {
            cloudSaveLibrary(null).then(function (r2) {
              cloud.version = r2.version || cloud.version;
              updateSyncStatus();
            }).catch(function () { updateSyncStatus('同步失败'); });
          } else {
            cloudLoadLibrary().then(function (j) {
              if (j && j.data) {
                appData = j.data;
                cloud.version = j.version || 0;
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); } catch (e2) {}
                renderSidebar();
              }
              updateSyncStatus();
            }).catch(function () { updateSyncStatus('同步失败'); });
          }
          return;
        }
        updateSyncStatus('同步失败');
      });
    }

    function tryBootstrapFromCloud() {
      if (!getToken()) { updateSyncStatus(); return Promise.resolve(false); }
      updateSyncStatus('同步中…');

      return cloudLoadLibrary().then(function (j) {
        cloud.version = (j && typeof j.version === 'number') ? j.version : 0;
        var remote = j && j.data ? j.data : null;

        if (!remote) {
          // 云端无数据：推送本地（若本地为空则也无所谓）
          return cloudSaveLibrary(0).then(function (r) {
            cloud.version = r.version || cloud.version;
            updateSyncStatus();
            return true;
          }).catch(function () {
            updateSyncStatus('同步失败');
            return false;
          });
        }

        // 云端有数据：如本地也有内容，询问用哪边
        var localHas = (appData && ((appData.chapters && appData.chapters.length) || (appData.folders && appData.folders.length)));
        var remoteHas = (remote.chapters && remote.chapters.length) || (remote.folders && remote.folders.length);

        if (localHas && remoteHas) {
          var useRemote = confirm('检测到云端和本地都有数据。\n确定=使用云端覆盖本地\n取消=保留本地并覆盖云端');
          if (!useRemote) {
            return cloudSaveLibrary(cloud.version).then(function (r2) {
              cloud.version = r2.version || cloud.version;
              updateSyncStatus();
              return true;
            }).catch(function () {
              updateSyncStatus('同步失败');
              return false;
            });
          }
        }

        appData = remote;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); } catch (e) {}
        updateSyncStatus();
        return true;
      }).catch(function () {
        updateSyncStatus('同步失败');
        return false;
      });
    }
  
    /** ---------------------------
     * 5) 章节接口（兼容旧 addChapter）
     * --------------------------- */
    window.addChapter = function (title, questions) {
      var id = pushStaticChapter(title, questions);
      if (initialized) renderSidebar();
      return id;
    };

    window.getStaticChapterIds = function () {
      var ids = [];
      for (var i = 0; i < staticData.length; i++) ids.push(staticData[i].id);
      return ids;
    };

    // 将指定章节（可含 static_*）放入某个文件夹（不存在则创建）
    window.addChaptersToFolder = function (folderTitle, chapterIds) {
      ensureDataLoaded();
      if (!folderTitle) folderTitle = '预设题库';

      if (!Array.isArray(chapterIds)) chapterIds = [];

      var changed = false;

      // find or create folder by title
      if (!Array.isArray(appData.folders)) appData.folders = [];
      var folderId = null;
      for (var i = 0; i < appData.folders.length; i++) {
        if (appData.folders[i] && appData.folders[i].title === folderTitle) {
          folderId = appData.folders[i].id;
          break;
        }
      }
      if (!folderId) {
        folderId = uid('f');
        appData.folders.push({ id: folderId, title: folderTitle, isOpen: true });
        changed = true;
      }

      if (!isObject(appData.layoutMap)) appData.layoutMap = {};
      for (var j = 0; j < chapterIds.length; j++) {
        var cid = chapterIds[j];
        if (typeof cid !== 'string' || !cid) continue;
        if (!appData.layoutMap[cid]) {
          appData.layoutMap[cid] = folderId;
          changed = true;
        }
      }

      if (changed) saveData();
      if (initialized && changed) renderSidebar();
      return folderId;
    };
  
    /** ---------------------------
     * 6) 获取 / 查找章节
     * --------------------------- */
    function isDeleted(id) {
      var del = appData.deletedChapterIds || [];
      for (var i = 0; i < del.length; i++) {
        if (del[i] === id) return true;
      }
      return false;
    }
  
    function getAllChapters() {
      var all = staticData.concat(appData.chapters || []);
      var out = [];
      for (var i = 0; i < all.length; i++) {
        if (!isDeleted(all[i].id)) out.push(all[i]);
      }
      return out;
    }
  
    function findChapterById(id) {
      for (var i = 0; i < staticData.length; i++) if (staticData[i].id === id) return staticData[i];
      var chs = appData.chapters || [];
      for (var j = 0; j < chs.length; j++) if (chs[j].id === id) return chs[j];
      return null;
    }
  
    /** ---------------------------
     * 7) 渲染侧边栏
     * --------------------------- */
    function renderSidebar() {
      if (!els.sidebarList) return;
      els.sidebarList.innerHTML = '';
  
      var allChapters = getAllChapters();
  
      var folderContents = {};
      var rootChapters = [];
  
      var folders = appData.folders || [];
      for (var i = 0; i < folders.length; i++) folderContents[folders[i].id] = [];
  
      for (var k = 0; k < allChapters.length; k++) {
        var ch = allChapters[k];
        var fid = appData.layoutMap ? appData.layoutMap[ch.id] : null;
        if (fid && folderContents[fid]) folderContents[fid].push(ch);
        else rootChapters.push(ch);
      }
  
      // folders first
      for (var f = 0; f < folders.length; f++) {
        var folderEl = createFolderElement(folders[f]);
        var contentEl = folderEl.querySelector('.folder-content');
  
        var list = folderContents[folders[f].id] || [];
        for (var c = 0; c < list.length; c++) {
          contentEl.appendChild(createChapterElement(list[c]));
        }
        els.sidebarList.appendChild(folderEl);
      }
  
      // root chapters
      for (var r = 0; r < rootChapters.length; r++) {
        els.sidebarList.appendChild(createChapterElement(rootChapters[r]));
      }
    }
  
    function createFolderElement(folder) {
      var container = document.createElement('div');
      container.className = 'folder-container' + (folder.isOpen ? ' open' : '');
      container.dataset.id = folder.id;
  
      var header = document.createElement('div');
      header.className = 'list-item folder-header';
      header.innerHTML =
        '<div style="display:flex; align-items:center; flex:1; overflow:hidden; pointer-events:none;">' +
          '<i class="fa-solid fa-caret-right folder-arrow"></i>' +
          '<i class="fa-solid fa-folder folder-icon"></i>' +
          '<span class="item-title">' + escapeHtml(folder.title) + '</span>' +
        '</div>' +
        '<div class="item-actions">' +
          '<i class="fa-solid fa-pen action-icon" title="重命名"></i>' +
          '<i class="fa-solid fa-trash action-icon delete" title="删除"></i>' +
        '</div>';
  
      // toggle open
      header.onclick = function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('action-icon')) return;
        folder.isOpen = !folder.isOpen;
        saveData();
        renderSidebar();
      };
  
      // actions
      var actions = header.querySelector('.item-actions');
      if (actions) {
        var renBtn = actions.children[0];
        var delBtn = actions.children[1];
  
        if (renBtn) renBtn.onclick = function (e) {
          e.stopPropagation();
          var name = prompt('重命名:', folder.title);
          if (name) {
            folder.title = name;
            saveData();
            renderSidebar();
          }
        };
  
        if (delBtn) delBtn.onclick = function (e) {
          e.stopPropagation();
          if (!confirm('删除文件夹？(内部章节将移回根目录)')) return;
          // remove folder
          var newFolders = [];
          for (var i = 0; i < appData.folders.length; i++) {
            if (appData.folders[i].id !== folder.id) newFolders.push(appData.folders[i]);
          }
          appData.folders = newFolders;
  
          // cleanup layoutMap
          var map = appData.layoutMap || {};
          for (var chId in map) {
            if (map[chId] === folder.id) delete map[chId];
          }
          appData.layoutMap = map;
  
          saveData();
          renderSidebar();
        };
      }
  
      container.appendChild(header);
  
      var content = document.createElement('div');
      content.className = 'folder-content';
      container.appendChild(content);
  
      return container;
    }
  
    function createChapterElement(chapter) {
      var div = document.createElement('div');
      div.className = 'list-item chapter-item' + (chapter.id === currentChapterId ? ' active' : '');
      div.dataset.id = chapter.id;
  
      // iOS 长按不弹出系统选择/菜单（尽量）
      div.style.webkitTouchCallout = 'none';
  
      var icon = chapter.isStatic
        ? '<i class="fa-solid fa-code" title="预设内容" style="color:#95a5a6;"></i>'
        : '<i class="fa-regular fa-file-lines" title="导入内容" style="color:#7f8c8d;"></i>';
  
      div.innerHTML =
        '<div style="display:flex; align-items:center; gap:8px; overflow:hidden; pointer-events:none;">' +
          icon +
          '<span class="item-title">' + escapeHtml(chapter.title) + '</span>' +
        '</div>' +
        '<div class="item-actions">' +
          '<i class="fa-solid fa-grip-lines drag-handle" title="拖拽"></i>' +
          '<i class="fa-solid fa-trash action-icon delete" title="删除章节"></i>' +
        '</div>';
  
      // click to load (拖拽结束后短时间内忽略 click，防误触)
      div.onclick = function (e) {
        if (e.target && e.target.closest && e.target.closest('.action-icon, .drag-handle')) return;
        if (Date.now() < drag.suppressClickUntil) return;
        loadChapter(chapter.id);
      };
  
      // delete
      var delIcon = div.querySelector('.action-icon.delete');
      if (delIcon) {
        delIcon.onclick = function (e) {
          e.stopPropagation();
          deleteChapter(chapter.id);
        };
      }
  
      // drag bind
      bindDragStart(div, chapter.id);
  
      // prevent context menu
      div.oncontextmenu = function (e) { e.preventDefault(); return false; };
  
      return div;
    }
  
    /** ---------------------------
     * 8) 章节加载与题卡（保持你原逻辑）
     * --------------------------- */
    function loadChapter(id) {
      currentChapterId = id;
      var chapter = findChapterById(id);
      if (!chapter || isDeleted(id)) return;
  
      if (els.chapterTitle) els.chapterTitle.innerText = chapter.title;
  
      renderSidebar();
  
      if (els.questionsContainer) {
        els.questionsContainer.innerHTML = '';
        for (var i = 0; i < (chapter.questions || []).length; i++) {
          els.questionsContainer.appendChild(createQuestionCard(chapter.questions[i]));
        }
      }
  
      window.scrollTo(0, 0);
      if (window.innerWidth <= 768 && els.sidebar) els.sidebar.classList.remove('active');
    }
  
    function createQuestionCard(q) {
      var card = document.createElement('div');
      card.className = 'question-card';
  
      var html = '<div class="q-header"><span class="q-id">' + q.id + '</span><div class="q-text">' + q.text + '</div></div><ul class="options-list">';
      for (var i = 0; i < (q.options || []).length; i++) {
        var opt = q.options[i];
        var isCorrect = opt.label === q.answer;
        html += '<li class="option-item ' + (isCorrect ? 'correct' : '') + '">' +
          '<span class="option-label">' + opt.label + '</span>' +
          '<span class="option-content">' + opt.content + '</span>' +
          (isCorrect ? '<i class="fa-solid fa-check" style="margin-left:auto; color:green;"></i>' : '') +
        '</li>';
      }
      html += '</ul>';
  
      if (q.explanation) {
        html += '<div class="analysis-box"><div class="analysis-title"><i class="fa-solid fa-lightbulb"></i> 解析</div><div class="analysis-content">' + formatInlineEmphasis(q.explanation) + '</div></div>';
      }
      if (q.knowledge) {
        html += '<details class="knowledge-details"><summary class="knowledge-summary"><i class="fa-solid fa-book-medical"></i> 知识点：' + escapeHtml(q.knowledgeTitle || '相关考点') + '</summary><div class="knowledge-content">' + formatInlineEmphasis(q.knowledge) + '</div></details>';
      }
  
      card.innerHTML = html;
      applyRandomHighlights(card);
      return card;
    }
  
    /** ---------------------------
     * 9) 删除章节（static/local 一视同仁）
     * --------------------------- */
    function deleteChapter(id) {
      if (!confirm('删除此章节？')) return;
  
      // remove from local chapters if exists
      var isLocal = false;
      for (var i = 0; i < appData.chapters.length; i++) {
        if (appData.chapters[i].id === id) { isLocal = true; break; }
      }
  
      if (isLocal) {
        var kept = [];
        for (var j = 0; j < appData.chapters.length; j++) {
          if (appData.chapters[j].id !== id) kept.push(appData.chapters[j]);
        }
        appData.chapters = kept;
      } else {
        // static: mark deleted
        if (!appData.deletedChapterIds) appData.deletedChapterIds = [];
        if (appData.deletedChapterIds.indexOf(id) === -1) appData.deletedChapterIds.push(id);
      }
  
      // cleanup layout
      if (appData.layoutMap && appData.layoutMap[id]) delete appData.layoutMap[id];
  
      // clear view if current
      if (currentChapterId === id) {
        currentChapterId = null;
        if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
        if (els.questionsContainer) els.questionsContainer.innerHTML = '';
      }
  
      saveData();
      renderSidebar();
    }
  
    /** ---------------------------
     * 10) 可靠拖拽系统
     * --------------------------- */
    var DRAG_MOUSE_THRESHOLD = 6;     // mouse moved px to start drag
    var TOUCH_CANCEL_THRESHOLD = 18;  // touch moved px during long-press waiting => cancel
    var LONG_PRESS_MS = 300;          // touch long-press delay
    var AUTO_SCROLL_EDGE = 55;        // px near top/bottom triggers autoscroll
    var AUTO_SCROLL_MAX_SPEED = 18;   // px per frame
  
    var drag = {
      mode: 'idle', // idle | pending | dragging
  
      chapterId: null,
      sourceEl: null,
  
      pointerType: null,
      pointerId: null,
  
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
  
      longPressTimer: 0,
  
      ghostEl: null,

      overFolderId: null,
      overFolderEl: null,
  
      autoScrollSpeed: 0,
      autoScrollRaf: 0,
  
      // click suppression window
      suppressClickUntil: 0,
  
      // locks
      pageLock: null,
      sidebarLock: null,
  
      // doc listeners attached?
      docAttached: false
    };
  
    function installGuardsOnce() {
      if (guardsInstalled) return;
      guardsInstalled = true;
  
      // 关键：拖拽时全局阻断“触摸滚动”和“滚轮滚动”
      addEvt(document, 'touchmove', function (e) {
        if (drag.mode === 'dragging') e.preventDefault();
      }, { passive: false, capture: true });
  
      addEvt(document, 'wheel', function (e) {
        if (drag.mode === 'dragging') e.preventDefault();
      }, { passive: false, capture: true });
  
      // iOS 上有时还会触发 gesture（缩放/双指），拖拽时直接禁掉
      addEvt(document, 'gesturestart', function (e) {
        if (drag.mode === 'dragging') e.preventDefault();
      }, { passive: false, capture: true });

      // 移动端长按可能触发 contextmenu（导致拖拽被系统打断）
      addEvt(document, 'contextmenu', function (e) {
        if (drag.mode !== 'idle') e.preventDefault();
      }, { passive: false, capture: true });

      addEvt(document, 'selectstart', function (e) {
        if (drag.mode !== 'idle') e.preventDefault();
      }, { passive: false, capture: true });
    }

    function bindDragStart(el, chapterId) {
      if (SUPPORT_POINTER) {
        addEvt(el, 'pointerdown', function (e) {
          if (e.button !== 0) return;
          // 触摸设备优先走 touchstart/touchmove（更可控；避免 PointerEvents 的 touch-action 限制）
          if ((e.pointerType || 'mouse') === 'touch') return;
          if (e.target && e.target.closest && e.target.closest('.action-icon')) return;
          var isHandle = !!(e.target && e.target.closest && e.target.closest('.drag-handle'));
          if (isHandle) e.preventDefault();
          beginPendingDrag(chapterId, el, e.pointerType || 'mouse', e.pointerId, e.clientX, e.clientY);
          if (isHandle) startDrag(e.clientX, e.clientY);
        }, { passive: false });

        // iOS/移动端：TouchEvents 更稳定
        addEvt(el, 'touchstart', function (e) {
          if (!e.touches || !e.touches[0]) return;
          if (e.target && e.target.closest && e.target.closest('.action-icon')) return;
          var isHandle = !!(e.target && e.target.closest && e.target.closest('.drag-handle'));
          if (isHandle) e.preventDefault();
          var t = e.touches[0];
          beginPendingDrag(chapterId, el, 'touch', 1, t.clientX, t.clientY);
          if (isHandle) startDrag(t.clientX, t.clientY);
        }, { passive: false });
      } else {
        // fallback: mouse + touch
        addEvt(el, 'mousedown', function (e) {
          if (e.button !== 0) return;
          if (e.target && e.target.closest && e.target.closest('.action-icon')) return;
          var isHandle = !!(e.target && e.target.closest && e.target.closest('.drag-handle'));
          beginPendingDrag(chapterId, el, 'mouse', 1, e.clientX, e.clientY);
          if (isHandle) startDrag(e.clientX, e.clientY);
        });

        addEvt(el, 'touchstart', function (e) {
          if (!e.touches || !e.touches[0]) return;
          var isHandle = !!(e.target && e.target.closest && e.target.closest('.drag-handle'));
          if (isHandle) e.preventDefault();
          var t = e.touches[0];
          beginPendingDrag(chapterId, el, 'touch', 1, t.clientX, t.clientY);
          if (isHandle) startDrag(t.clientX, t.clientY);
        }, { passive: false });
      }
    }

    function beginPendingDrag(chapterId, el, pointerType, pointerId, x, y) {
      if (drag.mode !== 'idle') return;
  
      drag.mode = 'pending';
      drag.chapterId = chapterId;
      drag.sourceEl = el;
      drag.pointerType = pointerType;
      drag.pointerId = pointerId;
      drag.startX = x;
      drag.startY = y;
      drag.lastX = x;
      drag.lastY = y;

      attachDocListeners();

      // PointerEvents：尽量捕获 pointer，避免移动端拖到元素外后丢事件
      if (SUPPORT_POINTER && el && el.setPointerCapture && pointerType === 'pen') {
        try { el.setPointerCapture(pointerId); } catch (err) {}
      }

      // touch/pen: long press to start
      if (pointerType === 'touch' || pointerType === 'pen') {
        drag.longPressTimer = window.setTimeout(function () {
          // 进入拖拽使用最新坐标（允许轻微微动）
          startDrag(drag.lastX, drag.lastY);
        }, LONG_PRESS_MS);
      } else {
        drag.longPressTimer = 0; // mouse no timer
      }
    }
  
    function attachDocListeners() {
      if (drag.docAttached) return;
      drag.docAttached = true;

      if (drag.pointerType === 'touch') {
        addEvt(document, 'touchmove', onDocTouchMove, { passive: false });
        addEvt(document, 'touchend', onDocTouchEnd, { passive: false });
        addEvt(document, 'touchcancel', onDocTouchEnd, { passive: false });
      } else if (SUPPORT_POINTER) {
        addEvt(document, 'pointermove', onDocPointerMove, { passive: false });
        addEvt(document, 'pointerup', onDocPointerUp, { passive: false });
        addEvt(document, 'pointercancel', onDocPointerUp, { passive: false });
      } else {
        addEvt(document, 'mousemove', onDocMouseMove);
        addEvt(document, 'mouseup', onDocMouseUp);
        addEvt(document, 'touchmove', onDocTouchMove, { passive: false });
        addEvt(document, 'touchend', onDocTouchEnd, { passive: false });
        addEvt(document, 'touchcancel', onDocTouchEnd, { passive: false });
      }
    }

    function detachDocListeners() {
      if (!drag.docAttached) return;
      drag.docAttached = false;

      // 直接清理所有可能的监听，避免 pointerType 先被置空导致漏卸载
      rmEvt(document, 'touchmove', onDocTouchMove, { passive: false });
      rmEvt(document, 'touchend', onDocTouchEnd, { passive: false });
      rmEvt(document, 'touchcancel', onDocTouchEnd, { passive: false });

      rmEvt(document, 'mousemove', onDocMouseMove);
      rmEvt(document, 'mouseup', onDocMouseUp);

      if (SUPPORT_POINTER) {
        rmEvt(document, 'pointermove', onDocPointerMove, { passive: false });
        rmEvt(document, 'pointerup', onDocPointerUp, { passive: false });
        rmEvt(document, 'pointercancel', onDocPointerUp, { passive: false });
      }
    }
  
    function dist(x1, y1, x2, y2) {
      var dx = x2 - x1, dy = y2 - y1;
      return Math.sqrt(dx * dx + dy * dy);
    }
  
    // PointerEvents path
    function onDocPointerMove(e) {
      if (drag.mode === 'idle') return;
      if (e.pointerId !== drag.pointerId) return;
  
      var x = e.clientX, y = e.clientY;
      drag.lastX = x; drag.lastY = y;
  
      if (drag.mode === 'pending') {
        if (drag.pointerType === 'touch' || drag.pointerType === 'pen') {
          if (dist(drag.startX, drag.startY, x, y) > TOUCH_CANCEL_THRESHOLD) {
            cancelPending();
          }
        } else {
          if (dist(drag.startX, drag.startY, x, y) > DRAG_MOUSE_THRESHOLD) {
            startDrag(x, y);
          }
        }
        return;
      }
  
      if (drag.mode === 'dragging') {
        e.preventDefault();
        onDragMove(x, y);
      }
    }
  
    function onDocPointerUp(e) {
      if (drag.mode === 'idle') return;
      if (e.pointerId !== drag.pointerId) return;
  
      if (drag.mode === 'pending') {
        cancelPending();
        return;
      }
      if (drag.mode === 'dragging') {
        finishDrag(e.clientX, e.clientY);
      }
    }
  
    // Fallback path (no PointerEvent)
    function onDocMouseMove(e) {
      if (drag.mode === 'idle') return;
      if (drag.pointerType !== 'mouse') return;
  
      var x = e.clientX, y = e.clientY;
      drag.lastX = x; drag.lastY = y;
  
      if (drag.mode === 'pending') {
        if (dist(drag.startX, drag.startY, x, y) > DRAG_MOUSE_THRESHOLD) startDrag(x, y);
        return;
      }
      if (drag.mode === 'dragging') onDragMove(x, y);
    }
  
    function onDocMouseUp(e) {
      if (drag.mode === 'idle') return;
      if (drag.pointerType !== 'mouse') return;
  
      if (drag.mode === 'pending') cancelPending();
      else if (drag.mode === 'dragging') finishDrag(e.clientX, e.clientY);
    }
  
    function onDocTouchMove(e) {
      if (drag.mode === 'idle') return;
      if (drag.pointerType !== 'touch') return;
      if (!e.touches || !e.touches[0]) return;
  
      var t = e.touches[0];
      var x = t.clientX, y = t.clientY;
      drag.lastX = x; drag.lastY = y;
  
      if (drag.mode === 'pending') {
        if (dist(drag.startX, drag.startY, x, y) > TOUCH_CANCEL_THRESHOLD) cancelPending();
        return;
      }
      if (drag.mode === 'dragging') {
        e.preventDefault();
        onDragMove(x, y);
      }
    }
  
    function onDocTouchEnd(e) {
      if (drag.mode === 'idle') return;
      if (drag.pointerType !== 'touch') return;
  
      var t = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
      var x = t ? t.clientX : drag.lastX;
      var y = t ? t.clientY : drag.lastY;
  
      if (drag.mode === 'pending') cancelPending();
      else if (drag.mode === 'dragging') finishDrag(x, y);
    }
  
    function cancelPending() {
      if (drag.longPressTimer) window.clearTimeout(drag.longPressTimer);
      drag.longPressTimer = 0;
  
      drag.mode = 'idle';
      drag.chapterId = null;
      drag.sourceEl = null;
      drag.pointerType = null;
      drag.pointerId = null;
  
      detachDocListeners();
    }
  
    function lockPageScrollIfTouch() {
      // 只在 touch/pen 时锁住页面（桌面鼠标拖拽不需要锁页面）
      if (!(drag.pointerType === 'touch' || drag.pointerType === 'pen')) return;
      if (drag.pageLock) return;
  
      var y = getScrollY();
      drag.pageLock = {
        scrollY: y,
        bodyPos: document.body.style.position,
        bodyTop: document.body.style.top,
        bodyLeft: document.body.style.left,
        bodyRight: document.body.style.right,
        bodyWidth: document.body.style.width,
        htmlOverflow: document.documentElement.style.overflow
      };
  
      // 组合拳：fixed body + html overflow hidden（对 iOS 更稳）
      document.documentElement.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = (-y) + 'px';
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
    }
  
    function unlockPageScrollIfTouch() {
      if (!drag.pageLock) return;
  
      var lock = drag.pageLock;
      drag.pageLock = null;
  
      document.documentElement.style.overflow = lock.htmlOverflow;
      document.body.style.position = lock.bodyPos;
      document.body.style.top = lock.bodyTop;
      document.body.style.left = lock.bodyLeft;
      document.body.style.right = lock.bodyRight;
      document.body.style.width = lock.bodyWidth;
  
      window.scrollTo(0, lock.scrollY);
    }
  
    function lockSidebarNativeScroll() {
      if (!els.sidebarList) return;
      if (drag.sidebarLock) return;
  
      drag.sidebarLock = {
        overflowY: els.sidebarList.style.overflowY,
        touchAction: els.sidebarList.style.touchAction,
        webkitOverflowScrolling: els.sidebarList.style.webkitOverflowScrolling
      };
  
      // 关键：拖拽中禁用原生滚动，全部由 JS 自动滚动接管
      els.sidebarList.style.overflowY = 'hidden';
      els.sidebarList.style.touchAction = 'none';
      els.sidebarList.style.webkitOverflowScrolling = 'auto';
    }
  
    function unlockSidebarNativeScroll() {
      if (!els.sidebarList) return;
      if (!drag.sidebarLock) return;
  
      var s = drag.sidebarLock;
      drag.sidebarLock = null;
  
      els.sidebarList.style.overflowY = s.overflowY;
      els.sidebarList.style.touchAction = s.touchAction;
      els.sidebarList.style.webkitOverflowScrolling = s.webkitOverflowScrolling;
    }
  
    function createGhost(title, widthHint) {
      var g = document.createElement('div');
      g.className = 'drag-ghost'; // 有 CSS 就用，没有也无所谓（我们用 inline）
      g.textContent = title || '拖拽中...';
  
      // inline 样式：不依赖你的 CSS
      g.style.position = 'fixed';
      g.style.left = '0';
      g.style.top = '0';
      g.style.zIndex = '9999';
      g.style.pointerEvents = 'none';
      g.style.background = '#fff';
      g.style.border = '1px solid #3498db';
      g.style.borderRadius = '8px';
      g.style.boxShadow = '0 10px 25px rgba(0,0,0,0.15)';
      g.style.padding = '10px 12px';
      g.style.fontSize = '14px';
      g.style.fontWeight = '600';
      g.style.opacity = '0.95';
      g.style.maxWidth = '260px';
      g.style.whiteSpace = 'nowrap';
      g.style.overflow = 'hidden';
      g.style.textOverflow = 'ellipsis';
      g.style.transform = 'translate3d(0,0,0)';
  
      if (widthHint) g.style.width = widthHint + 'px';
  
      document.body.appendChild(g);
      return g;
    }
  
    function updateGhostPosition(x, y) {
      if (!drag.ghostEl) return;
      var ox = 12, oy = 12;
      drag.ghostEl.style.transform = 'translate3d(' + (x + ox) + 'px,' + (y + oy) + 'px,0)';
    }
  
    function clearFolderHover() {
      if (drag.overFolderEl) {
        drag.overFolderEl.classList.remove('drag-target');
        drag.overFolderEl = null;
      }
      drag.overFolderId = null;
    }
  
    function hitTestFolder(x, y) {
      if (!els.sidebarList) return;
  
      // 只在侧边栏内部才显示投放反馈
      var sidebarRect = els.sidebar ? els.sidebar.getBoundingClientRect() : null;
      if (!sidebarRect || !pointInRect(x, y, sidebarRect)) {
        clearFolderHover();
        return;
      }
  
      // 避免 elementFromPoint 命中 ghost
      if (drag.ghostEl) drag.ghostEl.style.display = 'none';
      var elBelow = document.elementFromPoint(x, y);
      if (drag.ghostEl) drag.ghostEl.style.display = '';
  
      clearFolderHover();
      if (!elBelow) return;
  
      // 关键：拖到文件夹内部任意元素都算 -> 找最近的 folder-container
      var folderContainer = elBelow.closest('.folder-container');
      if (!folderContainer) return;
  
      folderContainer.classList.add('drag-target');
      drag.overFolderEl = folderContainer;
      drag.overFolderId = folderContainer.dataset.id || null;
    }
  
    function startAutoScrollIfNeeded(y) {
      if (!els.sidebarList) return;
      var rect = els.sidebarList.getBoundingClientRect();
  
      var speed = 0;
      if (y < rect.top + AUTO_SCROLL_EDGE) {
        var t1 = (rect.top + AUTO_SCROLL_EDGE - y) / AUTO_SCROLL_EDGE;
        speed = -Math.ceil(AUTO_SCROLL_MAX_SPEED * Math.min(1, t1));
      } else if (y > rect.bottom - AUTO_SCROLL_EDGE) {
        var t2 = (y - (rect.bottom - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE;
        speed = Math.ceil(AUTO_SCROLL_MAX_SPEED * Math.min(1, t2));
      }
  
      drag.autoScrollSpeed = speed;
  
      if (speed !== 0 && !drag.autoScrollRaf) {
        drag.autoScrollRaf = requestAnimationFrame(autoScrollTick);
      }
      if (speed === 0 && drag.autoScrollRaf) {
        cancelAnimationFrame(drag.autoScrollRaf);
        drag.autoScrollRaf = 0;
      }
    }
  
    function autoScrollTick() {
      if (drag.mode !== 'dragging' || !drag.autoScrollSpeed || !els.sidebarList) {
        drag.autoScrollRaf = 0;
        return;
      }
      els.sidebarList.scrollTop += drag.autoScrollSpeed;
  
      // 列表滚动时，手指不动也要刷新“命中目标”
      hitTestFolder(drag.lastX, drag.lastY);
  
      drag.autoScrollRaf = requestAnimationFrame(autoScrollTick);
    }
  
    function stopAutoScroll() {
      if (drag.autoScrollRaf) cancelAnimationFrame(drag.autoScrollRaf);
      drag.autoScrollRaf = 0;
      drag.autoScrollSpeed = 0;
    }
  
    function startDrag(x, y) {
      if (drag.mode !== 'pending') return;
  
      if (drag.longPressTimer) window.clearTimeout(drag.longPressTimer);
      drag.longPressTimer = 0;
  
      drag.mode = 'dragging';
      drag.suppressClickUntil = Date.now() + 450;
  
      // 振动反馈（支持则振）
      if ((drag.pointerType === 'touch' || drag.pointerType === 'pen') && navigator.vibrate) {
        navigator.vibrate(40);
      }
  
      lockPageScrollIfTouch();
      lockSidebarNativeScroll();

      // 源元素视觉反馈（用你原CSS的 dragging）
      if (drag.sourceEl) drag.sourceEl.classList.add('dragging-source');
  
      var titleEl = drag.sourceEl ? drag.sourceEl.querySelector('.item-title') : null;
      var title = titleEl ? titleEl.textContent : '';
      var widthHint = drag.sourceEl ? drag.sourceEl.getBoundingClientRect().width : null;
      drag.ghostEl = createGhost(title, widthHint);
  
      updateGhostPosition(x, y);
      hitTestFolder(x, y);
      startAutoScrollIfNeeded(y);
    }
  
    function onDragMove(x, y) {
      updateGhostPosition(x, y);
      hitTestFolder(x, y);
      startAutoScrollIfNeeded(y);
    }
  
    function finishDrag(x, y) {
      var chapterId = drag.chapterId;
      var targetFolderId = drag.overFolderId;
  
      var sidebarRect = els.sidebar ? els.sidebar.getBoundingClientRect() : null;
      var droppedInSidebar = sidebarRect ? pointInRect(x, y, sidebarRect) : false;
  
      // 先清理 UI（避免 renderSidebar 时残留 ghost/锁）
      cleanupDragUI();
  
      if (droppedInSidebar && chapterId) {
        if (targetFolderId) {
          appData.layoutMap[chapterId] = targetFolderId;
        } else {
          // 根目录
          if (appData.layoutMap && appData.layoutMap[chapterId]) delete appData.layoutMap[chapterId];
        }
        saveData();
        renderSidebar();
      }
  
      resetDragState();
    }
  
    function cleanupDragUI() {
      stopAutoScroll();
      clearFolderHover();
  
      if (drag.ghostEl && drag.ghostEl.parentNode) drag.ghostEl.parentNode.removeChild(drag.ghostEl);
      drag.ghostEl = null;

      if (drag.sourceEl) drag.sourceEl.classList.remove('dragging-source');
  
      unlockSidebarNativeScroll();
      unlockPageScrollIfTouch();
    }
  
    function resetDragState() {
      if (drag.longPressTimer) window.clearTimeout(drag.longPressTimer);
      drag.longPressTimer = 0;
  
      drag.mode = 'idle';
      drag.chapterId = null;
      drag.sourceEl = null;
      drag.pointerType = null;
      drag.pointerId = null;
  
      drag.startX = drag.startY = drag.lastX = drag.lastY = 0;
      drag.overFolderId = null;
      drag.overFolderEl = null;

      detachDocListeners();
    }
  
    /** ---------------------------
     * 11) JSON 导入（支持多文件夹/多sheet完整结构）
     * --------------------------- */
    function looksLikeSingleSheet(obj) {
      return isObject(obj) && typeof obj.title === 'string' && Array.isArray(obj.questions);
    }
  
    function normalizeSheetObj(obj, preferId) {
      var out = {
        id: (preferId && typeof obj.id === 'string') ? obj.id : uid('local'),
        title: (obj.title || obj.name || obj.sheetName || '未命名章节'),
        questions: Array.isArray(obj.questions) ? obj.questions : [],
        isStatic: false
      };
      return out;
    }
  
    function normalizeFolderObj(obj, preferId) {
      return {
        id: (preferId && typeof obj.id === 'string') ? obj.id : uid('f'),
        title: (obj.title || obj.name || '未命名文件夹'),
        isOpen: (typeof obj.isOpen === 'boolean') ? obj.isOpen : true
      };
    }
  
    // 将各种输入 JSON 形态“抽象成一个库结构”
    function buildLibraryFromAnyJSON(raw) {
      // unwrap 常见壳
      if (isObject(raw) && isObject(raw.appData)) raw = raw.appData;
      if (isObject(raw) && isObject(raw.data)) raw = raw.data;
  
      // 1) 单 sheet
      if (looksLikeSingleSheet(raw)) {
        return {
          kind: 'single',
          folders: [],
          chapters: [ normalizeSheetObj(raw, false) ],
          layoutMap: {},
          deletedChapterIds: []
        };
      }
  
      // 2) 纯数组 sheets
      if (Array.isArray(raw)) {
        var allOk = true;
        for (var i = 0; i < raw.length; i++) {
          if (!looksLikeSingleSheet(raw[i])) { allOk = false; break; }
        }
        if (allOk) {
          var list = [];
          for (var j = 0; j < raw.length; j++) list.push(normalizeSheetObj(raw[j], false));
          return { kind: 'list', folders: [], chapters: list, layoutMap: {}, deletedChapterIds: [] };
        }
      }

      // 3) 完整结构：带 folders + layoutMap / deleted 等（优先识别）
      if (isObject(raw) && Array.isArray(raw.folders) && (Array.isArray(raw.chapters) || Array.isArray(raw.sheets))) {
        var fullSheets = raw.chapters || raw.sheets;
        var hasLayoutMap = isObject(raw.layoutMap);
        var hasDeleted = Array.isArray(raw.deletedChapterIds) || Array.isArray(raw.deleted);

        if (hasLayoutMap || hasDeleted) {
          // 注意：这里优先“保留 id”，但后续会做去重与 remap
          return {
            kind: 'fullState',
            folders: raw.folders,
            chapters: fullSheets,
            layoutMap: raw.layoutMap || {},
            deletedChapterIds: raw.deletedChapterIds || raw.deleted || []
          };
        }
      }

      // 4) 文件夹树：folders:[{title, sheets:[...]}, ...] + (可选) 根 sheets
      // 注意：如果同时存在根 sheets 和 folders，也应按 tree 解析（避免 folders 被忽略）
      if (isObject(raw) && Array.isArray(raw.folders)) {
        var foldersIn = raw.folders;
        var outFolders = [];
        var outChapters = [];
        var outMap = {};

        for (var fi = 0; fi < foldersIn.length; fi++) {
          var fin = foldersIn[fi] || {};
          var folderObj = normalizeFolderObj(fin, false);
          outFolders.push(folderObj);

          var sheets = fin.sheets || fin.chapters || fin.items || [];
          if (Array.isArray(sheets)) {
            for (var si = 0; si < sheets.length; si++) {
              var sin = sheets[si];
              if (!isObject(sin)) continue;
              // 允许 sheet 既是 {title,questions} 也可能是别名字段
              if (sin.title || sin.name || sin.sheetName) {
                var chObj = normalizeSheetObj({
                  title: sin.title || sin.name || sin.sheetName,
                  questions: Array.isArray(sin.questions) ? sin.questions : (Array.isArray(sin.items) ? sin.items : [])
                }, false);
                outChapters.push(chObj);
                outMap[chObj.id] = folderObj.id;
              }
            }
          }
        }

        // 根目录 sheets（可选）
        var roots = raw.sheets || raw.chapters || [];
        if (Array.isArray(roots)) {
          for (var ri = 0; ri < roots.length; ri++) {
            if (!isObject(roots[ri])) continue;
            if (roots[ri].title || roots[ri].name || roots[ri].sheetName) {
              outChapters.push(normalizeSheetObj(roots[ri], false));
            }
          }
        }

        return { kind: 'tree', folders: outFolders, chapters: outChapters, layoutMap: outMap, deletedChapterIds: [] };
      }

      // 5) 多 sheet（chapters / sheets）- 无 folders 的纯列表
      if (isObject(raw) && (Array.isArray(raw.chapters) || Array.isArray(raw.sheets))) {
        var rootSheets = raw.chapters || raw.sheets;
        var list2 = [];
        for (var k = 0; k < rootSheets.length; k++) {
          if (looksLikeSingleSheet(rootSheets[k]) || isObject(rootSheets[k])) {
            list2.push(normalizeSheetObj(rootSheets[k], false));
          }
        }
        return { kind: 'list', folders: [], chapters: list2, layoutMap: {}, deletedChapterIds: [] };
      }

      return null;
    }
  
    function makeUniqueIdsForImport(lib, overwrite) {
      // 目标：避免 chapter/folder 的 id 与 static_* 冲突，避免与现有 local 冲突（merge时）
      // 规则：对导入的 folders/chapters 统一做“去重+重映射”，保持 layoutMap 正确。
      var usedChapterIds = {};
      var usedFolderIds = {};
  
      // static ids always occupied
      for (var i = 0; i < staticData.length; i++) usedChapterIds[staticData[i].id] = true;
  
      // merge 时：已有 local/folder 也占用
      if (!overwrite) {
        for (var j = 0; j < (appData.chapters || []).length; j++) usedChapterIds[appData.chapters[j].id] = true;
        for (var k = 0; k < (appData.folders || []).length; k++) usedFolderIds[appData.folders[k].id] = true;
      }
  
      var folderIdMap = {}; // old -> new
      var chapterIdMap = {}; // old -> new
  
      // folders
      var newFolders = [];
      for (var f = 0; f < (lib.folders || []).length; f++) {
        var fin = lib.folders[f] || {};
        var oldFid = (typeof fin.id === 'string') ? fin.id : uid('f');
        var nid = oldFid;
  
        while (usedFolderIds[nid]) nid = uid('f');
        usedFolderIds[nid] = true;
        folderIdMap[oldFid] = nid;
  
        newFolders.push(normalizeFolderObj({ id: nid, title: fin.title || fin.name, isOpen: fin.isOpen }, true));
      }
  
      // chapters
      var newChapters = [];
      for (var c = 0; c < (lib.chapters || []).length; c++) {
        var cin = lib.chapters[c] || {};
        var oldCid = (typeof cin.id === 'string') ? cin.id : uid('local');
        var cid = oldCid;
  
        while (usedChapterIds[cid]) cid = uid('local');
        usedChapterIds[cid] = true;
        chapterIdMap[oldCid] = cid;
  
        newChapters.push(normalizeSheetObj({
          id: cid,
          title: cin.title || cin.name || cin.sheetName,
          questions: cin.questions
        }, true));
      }
  
      // layout remap
      var newLayoutMap = {};
      var lm = lib.layoutMap || {};
      for (var oldCh in lm) {
        if (!lm.hasOwnProperty(oldCh)) continue;
        var oldFolder = lm[oldCh];
  
        var mappedCh = chapterIdMap[oldCh];
        var mappedFolder = folderIdMap[oldFolder];
  
        // 如果导入结构中 layoutMap 指向的 folder 不在本次导入 folders 里，也可能是根目录/无效 -> 忽略
        if (mappedCh && mappedFolder) newLayoutMap[mappedCh] = mappedFolder;
      }
  
      // deleted ids remap（如果导入提供了）
      var newDeleted = [];
      var del = lib.deletedChapterIds || [];
      for (var d = 0; d < del.length; d++) {
        var did = del[d];
        if (chapterIdMap[did]) newDeleted.push(chapterIdMap[did]);
        else newDeleted.push(did); // 静态章节删除可能直接是 static_*
      }
  
      return {
        folders: newFolders,
        chapters: newChapters,
        layoutMap: newLayoutMap,
        deletedChapterIds: newDeleted
      };
    }
  
    function importAnyJSON(payload) {
      var lib = buildLibraryFromAnyJSON(payload);
      if (!lib) {
        alert('未识别的JSON结构。\n支持：单章节/多章节/文件夹树/完整结构');
        return;
      }
  
      // 单章节：直接追加并打开
      if (lib.kind === 'single') {
        var one = lib.chapters[0];
        appData.chapters.push(one);
        saveData();
        renderSidebar();
        loadChapter(one.id);
        return;
      }
  
      // 多结构：询问覆盖 or 追加
      var overwrite = confirm('检测到多文件夹/多章节结构。\n确定=覆盖当前本地题库\n取消=追加到当前题库');
      var normalized = makeUniqueIdsForImport(lib, overwrite);
  
      if (overwrite) {
        appData.folders = normalized.folders;
        appData.chapters = normalized.chapters;
        appData.layoutMap = normalized.layoutMap;
        appData.deletedChapterIds = normalized.deletedChapterIds || [];
  
        currentChapterId = null;
        if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
        if (els.questionsContainer) els.questionsContainer.innerHTML = '';
  
        saveData();
        renderSidebar();
        return;
      }
  
      // merge
      for (var i = 0; i < normalized.folders.length; i++) appData.folders.push(normalized.folders[i]);
      for (var j = 0; j < normalized.chapters.length; j++) appData.chapters.push(normalized.chapters[j]);
      for (var chId in normalized.layoutMap) {
        if (normalized.layoutMap.hasOwnProperty(chId)) appData.layoutMap[chId] = normalized.layoutMap[chId];
      }
      // deleted: 合并（去重）
      if (!appData.deletedChapterIds) appData.deletedChapterIds = [];
      for (var d = 0; d < (normalized.deletedChapterIds || []).length; d++) {
        var did = normalized.deletedChapterIds[d];
        if (appData.deletedChapterIds.indexOf(did) === -1) appData.deletedChapterIds.push(did);
      }
  
      saveData();
      renderSidebar();
    }
  
    /** ---------------------------
     * 12) UI 绑定
     * --------------------------- */
    function bindUIOnce() {
      if (uiBound) return;
      uiBound = true;
  
      // 菜单
      if (els.menuToggle && els.sidebar) {
        els.menuToggle.onclick = function () {
          els.sidebar.classList.toggle('active');
        };
      }
  
      // 新建文件夹
      if (els.addFolderBtn) {
        els.addFolderBtn.onclick = function () {
          var title = prompt('文件夹名称:');
          if (!title) return;
          appData.folders.push({ id: uid('f'), title: title, isOpen: true });
          saveData();
          renderSidebar();
        };
      }
  
      // 粘贴导入
      if (els.openPasteModalBtn && els.pasteModal) {
        els.openPasteModalBtn.onclick = function () {
          els.pasteModal.classList.add('open');
        };
      }
      if (els.cancelPasteBtn && els.pasteModal) {
        els.cancelPasteBtn.onclick = function () {
          els.pasteModal.classList.remove('open');
        };
      }
      if (els.confirmPasteBtn && els.pasteTextarea && els.pasteModal) {
        els.confirmPasteBtn.onclick = function () {
          try {
            var data = JSON.parse(els.pasteTextarea.value);
            importAnyJSON(data);
            els.pasteModal.classList.remove('open');
            els.pasteTextarea.value = '';
          } catch (e) {
            alert('JSON解析失败');
          }
        };
      }
  
      // 文件导入
      if (els.fileInput) {
        els.fileInput.onchange = function (e) {
          var f = e.target.files && e.target.files[0];
          if (!f) return;
          var r = new FileReader();
          r.onload = function (ev) {
            try {
              var data = JSON.parse(ev.target.result);
              importAnyJSON(data);
            } catch (err) {
              alert('文件无效');
            }
          };
          r.readAsText(f);
          els.fileInput.value = '';
        };
      }
  
      // 清空
      if (els.clearDataBtn) {
        els.clearDataBtn.onclick = function () {
          // 1) 全部删除：清空导入+文件夹，并隐藏所有预设章节（可通过“清除本地数据”恢复）
          if (confirm('【全部删除】所有章节/文件夹（含预设章节）？\n\n确定=全部删除\n取消=不执行')) {
            appData.chapters = [];
            appData.folders = [];
            appData.layoutMap = {};

            // 预设章节无法“真删”（在代码里），用 deletedChapterIds 隐藏
            appData.deletedChapterIds = [];
            for (var i = 0; i < staticData.length; i++) appData.deletedChapterIds.push(staticData[i].id);

            currentChapterId = null;
            if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
            if (els.questionsContainer) els.questionsContainer.innerHTML = '';

            saveData();
            renderSidebar();
            return;
          }

          // 2) 清除本地存储：恢复到初始状态（预设章节会重新出现）
          if (confirm('清除所有本地数据并刷新？（恢复预设章节）')) {
            localStorage.removeItem(STORAGE_KEY);
            location.reload();
          }
        };
      }

      // 同步/账号
      if (els.syncBtn && els.authModal) {
        els.syncBtn.onclick = function () {
          updateAuthModalUI();
          els.authModal.classList.add('open');
        };
      }

      function updateAuthModalUI() {
        if (!els.authModal) return;
        var loggedIn = !!getToken();
        if (els.authLogoutBtn) els.authLogoutBtn.style.display = loggedIn ? 'inline-block' : 'none';
        if (els.authHint) els.authHint.textContent = loggedIn ? '已登录：自动同步开启。' : '登录后会在多设备间同步。';

        if (els.authTabLogin) els.authTabLogin.classList.toggle('primary', cloud.authMode === 'login');
        if (els.authTabRegister) els.authTabRegister.classList.toggle('primary', cloud.authMode === 'register');
      }

      if (els.authTabLogin) els.authTabLogin.onclick = function () { cloud.authMode = 'login'; updateAuthModalUI(); };
      if (els.authTabRegister) els.authTabRegister.onclick = function () { cloud.authMode = 'register'; updateAuthModalUI(); };

      if (els.authCancelBtn && els.authModal) {
        els.authCancelBtn.onclick = function () { els.authModal.classList.remove('open'); };
      }

      if (els.authLogoutBtn) {
        els.authLogoutBtn.onclick = function () {
          if (!confirm('退出登录并停止云端同步？')) return;
          setToken(null);
          cloud.version = 0;
          updateSyncStatus();
          updateAuthModalUI();
        };
      }

      if (els.authSubmitBtn) {
        els.authSubmitBtn.onclick = function () {
          var username = els.authUsername ? els.authUsername.value : '';
          var password = els.authPassword ? els.authPassword.value : '';
          var endpoint = (cloud.authMode === 'register') ? '/api/auth/register' : '/api/auth/login';

          if (els.authHint) els.authHint.textContent = '处理中…';
          apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ username: username, password: password }) })
            .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, status: res.status, json: j }; }); })
            .then(function (r) {
              if (!r.ok || !r.json || !r.json.token) {
                var msg = (r.json && (r.json.error || r.json.message)) ? (r.json.error || r.json.message) : '失败';
                if (els.authHint) els.authHint.textContent = msg;
                return;
              }
              setToken(r.json.token);
              if (els.authHint) els.authHint.textContent = '登录成功，开始同步…';
              tryBootstrapFromCloud().then(function () {
                renderSidebar();
                updateAuthModalUI();
                updateSyncStatus();
              });
            })
            .catch(function () {
              if (els.authHint) els.authHint.textContent = '网络错误';
            });
        };
      }
    }
  
    /** ---------------------------
     * 13) 启动
     * --------------------------- */
    function initApp() {
      cacheEls();
      if (!els.sidebarList) return;

      loadStaticPresets().then(function () {
        loadLocalData();
        try {
          if (staticData.length && typeof window.addChaptersToFolder === 'function' && typeof window.getStaticChapterIds === 'function') {
            window.addChaptersToFolder('预设题库', window.getStaticChapterIds());
          }
        } catch (e) {}

        bindUIOnce();
        installGuardsOnce();
        updateSyncStatus();
        tryBootstrapFromCloud().then(function () {
          renderSidebar();
        });

        initialized = true;
      });
    }
  
    if (document.readyState === 'loading') addEvt(document, 'DOMContentLoaded', initApp);
    else initApp();
  
  })();
