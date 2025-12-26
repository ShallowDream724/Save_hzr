    /** ---------------------------
     * 4.1) 云端同步（注册/登录 + per-user 数据）
     * --------------------------- */
    var cloud = {
      token: null,
      version: 0,
      savingTimer: 0,
      isSaving: false,
      authMode: 'login', // login | register
      bootstrapDone: false,
      syncEnabled: false,
      remoteEmpty: null,
      bootstrapPromise: null,
      bootstrapFailed: false
    };

    function getToken() {
      if (cloud.token) return cloud.token;
      try { cloud.token = localStorage.getItem(AUTH_TOKEN_KEY) || null; } catch (e) { cloud.token = null; }
      return cloud.token;
    }
    function setToken(token) {
      cloud.token = token || null;
      cloud.version = 0;
      cloud.bootstrapDone = false;
      cloud.syncEnabled = false;
      cloud.remoteEmpty = null;
      cloud.bootstrapFailed = false;
      cloud.bootstrapPromise = null;
      try {
        if (cloud.token) localStorage.setItem(AUTH_TOKEN_KEY, cloud.token);
        else localStorage.removeItem(AUTH_TOKEN_KEY);
      } catch (e) {}
      updateSyncStatus();
    }

    function updateSyncStatus(text) {
      if (!els.syncStatus) return;

      var dot = 'status-dot--off';
      var label = '';

      if (text) {
        label = String(text);
        if (label.indexOf('失败') !== -1) dot = 'status-dot--err';
        else if (label.indexOf('冲突') !== -1) dot = 'status-dot--warn';
        else if (label.indexOf('同步中') !== -1) dot = 'status-dot--warn';
        else dot = getToken() ? 'status-dot--ok' : 'status-dot--off';
      } else {
        var t = getToken();
        if (!t) {
          dot = 'status-dot--off';
          label = '未登录 · 仅本地';
        } else if (cloud.bootstrapFailed) {
          dot = 'status-dot--err';
          label = '已登录 · 同步失败（未启用）';
        } else if (!cloud.bootstrapDone) {
          dot = 'status-dot--warn';
          label = '已登录 · 同步初始化中…';
        } else if (!cloud.syncEnabled) {
          dot = 'status-dot--warn';
          label = '已登录 · 未启用自动同步';
        } else {
          dot = 'status-dot--ok';
          label = '已登录 · 自动同步';
        }
      }

      els.syncStatus.innerHTML = '<span class="status-dot ' + dot + '"></span>' + escapeHtml(label);
      if (els.syncModalStatus) els.syncModalStatus.textContent = getToken() ? '已登录 · 自动同步' : '未登录 · 仅本地';
    }

    function apiFetch(path, options) {
      options = options || {};
      var headers = options.headers || {};
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      var t = getToken();
      if (t) headers['Authorization'] = 'Bearer ' + t;
      headers['X-Device-Id'] = headers['X-Device-Id'] || getOrCreateDeviceId();
      // Header values must be ASCII-safe in fetch; encode label to avoid "Invalid character in header field".
      try {
        headers['X-Device-Label'] = headers['X-Device-Label'] || encodeURIComponent(getDeviceLabel());
      } catch (_) {
        headers['X-Device-Label'] = headers['X-Device-Label'] || '';
      }
      options.headers = headers;
      return fetch(API_BASE + path, options).then(function (res) {
        if (res.status === 401) {
          setToken(null);
          updateSyncStatus('登录失效');
        }
        return res;
      });
    }

    function cloudLoadLibrary() {
      return apiFetch('/api/library', { method: 'GET' }).then(function (res) {
        if (!res.ok) throw new Error('load failed');
        return res.json();
      });
    }

    function cloudSaveLibrary(expectedVersion, force) {
      var headers = {};
      if (typeof expectedVersion === 'number' && !force) headers['If-Match'] = String(expectedVersion);
      if (force) headers['X-Force'] = '1';
      return apiFetch('/api/library' + (force ? '?force=1' : ''), {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify({ data: appData })
      }).then(function (res) {
        if (res.status === 409) return res.json().then(function (j) { var e = new Error('conflict'); e.conflict = j; throw e; });
        if (!res.ok) throw new Error('save failed');
        return res.json();
      });
    }

    function cloudListRevisions() {
      return apiFetch('/api/revisions?limit=3', { method: 'GET' }).then(function (res) {
        if (!res.ok) throw new Error('revisions failed');
        return res.json();
      });
    }

    function cloudRestoreRevision(version) {
      return apiFetch('/api/revisions/' + encodeURIComponent(String(version)) + '/restore', { method: 'POST', body: '{}' })
        .then(function (res) {
          if (!res.ok) throw new Error('restore failed');
          return res.json();
        });
    }

    function cloudListArchives() {
      return apiFetch('/api/archives?limit=50', { method: 'GET' }).then(function (res) {
        if (!res.ok) throw new Error('archives failed');
        return res.json();
      });
    }

    function cloudCreateArchive(name, data) {
      var body = {};
      if (name) body.name = name;
      if (data && typeof data === 'object') body.data = data;
      return apiFetch('/api/archives', { method: 'POST', body: JSON.stringify(body) }).then(function (res) {
        if (!res.ok) throw new Error('archive failed');
        return res.json();
      });
    }

    function cloudDeleteArchive(id) {
      return apiFetch('/api/archives/' + encodeURIComponent(String(id)), { method: 'DELETE' }).then(function (res) {
        if (!res.ok) throw new Error('delete failed');
        return res.json();
      });
    }

    function cloudRestoreArchive(id) {
      return apiFetch('/api/archives/' + encodeURIComponent(String(id)) + '/restore', { method: 'POST', body: '{}' }).then(function (res) {
        if (!res.ok) throw new Error('restore failed');
        return res.json();
      });
    }

    function cloudRenameArchive(id, name) {
      return apiFetch('/api/archives/' + encodeURIComponent(String(id)), { method: 'PATCH', body: JSON.stringify({ name: name }) }).then(function (res) {
        if (res.ok) return res.json();
        // Some proxies block PATCH; retry with POST.
        if (res.status === 404 || res.status === 405) {
          return apiFetch('/api/archives/' + encodeURIComponent(String(id)) + '/rename', { method: 'POST', body: JSON.stringify({ name: name }) }).then(function (res2) {
            if (!res2.ok) throw new Error('rename failed');
            return res2.json();
          });
        }
        throw new Error('rename failed');
      });
    }

    function scheduleCloudSave() {
      if (!getToken()) return;
      if (!cloud.bootstrapDone) return;
      if (!cloud.syncEnabled) return;
      if (cloud.savingTimer) window.clearTimeout(cloud.savingTimer);
      cloud.savingTimer = window.setTimeout(function () {
        cloud.savingTimer = 0;
        doCloudSave();
      }, 1200);
    }

    function doCloudSave() {
      if (!getToken()) return;
      if (!cloud.bootstrapDone) return;
      if (!cloud.syncEnabled) return;
      if (cloud.isSaving) return;
      cloud.isSaving = true;
      updateSyncStatus('同步中…');

      cloudSaveLibrary(cloud.version, false).then(function (r) {
        cloud.version = r.version || cloud.version;
        cloud.isSaving = false;
        updateSyncStatus();
      }).catch(function (err) {
        cloud.isSaving = false;
        if (err && err.message === 'conflict') {
          updateSyncStatus('同步冲突 · 已自动处理');
          // 无弹窗：默认以本机为准覆盖云端，同时服务端会自动把旧云端做成“冲突自动备份”存档
          cloudSaveLibrary(null, true).then(function (r2) {
            cloud.version = r2.version || cloud.version;
            updateSyncStatus();
            showToast('检测到多设备冲突：已自动同步当前设备，旧云端已备份到“存档”。', { timeoutMs: 5200 });
          }).catch(function () {
            updateSyncStatus('同步失败');
            showToast('同步失败：请检查网络/反代配置', { timeoutMs: 5200 });
          });
          return;
        }
        updateSyncStatus('同步失败');
        showToast('同步失败：请检查网络/反代配置', { timeoutMs: 5200 });
      });
    }

    function tryBootstrapFromCloud() {
      if (!getToken()) { updateSyncStatus(); return Promise.resolve(false); }
      if (cloud.bootstrapPromise) return cloud.bootstrapPromise;
      cloud.bootstrapDone = false;
      cloud.bootstrapFailed = false;
      updateSyncStatus('同步中…');

      cloud.bootstrapPromise = cloudLoadLibrary().then(function (j) {
        cloud.version = (j && typeof j.version === 'number') ? j.version : 0;
        var remote = j && j.data ? j.data : null;

        var localHas = appHasAnyContent(appData);
        var remoteHas = appHasAnyContent(remote);

        if (!remote || !remoteHas) {
          // 云端无数据（或为空库）：绝不自动推送本机，也不自动用“空云端”覆盖本机。
          // 用户可在“云同步 -> 账号”里手动点“上传本机到云端（启用同步）”。
          cloud.remoteEmpty = true;
          cloud.syncEnabled = false;
          cloud.bootstrapDone = true;
          updateSyncStatus();
          if (localHas) showToast('云端暂无数据：已保留本机。若要跨设备同步，请在“云同步-账号”里手动启用。', { timeoutMs: 5600 });
          return false;
        }
        cloud.remoteEmpty = false;
        cloud.syncEnabled = true;

        // 云端有数据：默认以云端为准（更安全）
        // 只有“本机与云端内容不同(忽略UI状态)”时才自动备份本机一次，避免每次登录/刷新都刷存档
        if (localHas && remoteHas) {
          var localSig = librarySignature(appData);
          var remoteSig = librarySignature(remote);
          if (localSig && remoteSig && localSig !== remoteSig) {
            try {
              localStorage.setItem('hzr_local_backup_before_cloud_v1', JSON.stringify({ savedAt: new Date().toISOString(), data: appData }));
            } catch (_) {}

            var BOOT_KEY = 'hzr_bootstrap_backup_v3';
            var marker = String(cloud.version) + ':' + String(hash32(localSig)) + ':' + String(hash32(remoteSig));
            var last = null;
            try { last = localStorage.getItem(BOOT_KEY); } catch (_) { last = null; }

            if (last !== marker) {
              try { localStorage.setItem(BOOT_KEY, marker); } catch (_) {}
              var ls = summarizeLibrary(appData);
              var rs = summarizeLibrary(remote);
              var name = '自动备份(登录覆盖前) ' + new Date().toISOString();
              cloudCreateArchive(name, appData).then(function () {
                showToast('检测到本机与云端不同：本机' + ls.chapters + '章/' + ls.folders + '夹，云端' + rs.chapters + '章/' + rs.folders + '夹。本机已备份到“存档”。', { timeoutMs: 5200 });
              }).catch(function () {});
            }
          }
        }

        var keepUi = appData && appData.ui ? normalizeUi(appData.ui) : defaultUi();
        normalizeAppData(remote, keepUi);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); } catch (e) {}
        cloud.bootstrapDone = true;
        updateSyncStatus();
        return true;
      }).catch(function () {
        cloud.bootstrapFailed = true;
        cloud.syncEnabled = false;
        updateSyncStatus('同步失败');
        cloud.bootstrapDone = false;
        return false;
      }).finally(function () {
        cloud.bootstrapPromise = null;
      });
      return cloud.bootstrapPromise;
    }
  
