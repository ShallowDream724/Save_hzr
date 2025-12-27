    /** ---------------------------
     * 12.5) UI 绑定：云同步/账号/存档
     * --------------------------- */
    var uiSyncBound = false;

    function updateAuthModalUI() {
      if (!els.authModal) return;
      var loggedIn = !!getToken();
      var uname = '';
      try { if (loggedIn && typeof getTokenUsername === 'function') uname = String(getTokenUsername() || '').trim(); } catch (_) { uname = ''; }
      var userTag = uname ? ('（' + uname + '）') : '';
      if (els.authLogoutBtn) els.authLogoutBtn.style.display = loggedIn ? 'inline-block' : 'none';
      if (els.authHint) {
        if (!loggedIn) els.authHint.textContent = '登录后可跨设备同步，并提供自动/手动存档。';
        else if (cloud.bootstrapFailed) els.authHint.textContent = '已登录' + userTag + '：同步初始化失败（不会上传本机）。请检查网络/反代配置后重试。';
        else if (!cloud.bootstrapDone) els.authHint.textContent = '已登录' + userTag + '：正在从云端拉取数据…（不会上传本机）';
        else if (!cloud.syncEnabled) els.authHint.textContent = '已登录' + userTag + '：云同步未启用（为防误覆盖，不会自动上传本机）。';
        else els.authHint.textContent = '已登录' + userTag + '：默认拉取云端；之后改动会自动同步到云端（云端每5分钟自动备份）。';
      }

      // Logged-in users should not see the login/register form (avoid confusion).
      if (els.authTabLogin) els.authTabLogin.style.display = loggedIn ? 'none' : '';
      if (els.authTabRegister) els.authTabRegister.style.display = loggedIn ? 'none' : '';
      if (els.authUsername) els.authUsername.style.display = loggedIn ? 'none' : '';
      if (els.authPassword) els.authPassword.style.display = loggedIn ? 'none' : '';
      if (els.authSubmitBtn) els.authSubmitBtn.style.display = loggedIn ? 'none' : '';

      if (els.authTabLogin) els.authTabLogin.classList.toggle('primary', cloud.authMode === 'login');
      if (els.authTabRegister) els.authTabRegister.classList.toggle('primary', cloud.authMode === 'register');

      if (els.syncTabSaves) {
        els.syncTabSaves.disabled = !loggedIn;
        els.syncTabSaves.style.opacity = loggedIn ? '1' : '0.5';
        els.syncTabSaves.style.cursor = loggedIn ? 'pointer' : 'not-allowed';
      }

      if (els.syncEnableRow) {
        var show = loggedIn && cloud.bootstrapDone && !cloud.syncEnabled;
        els.syncEnableRow.style.display = show ? '' : 'none';
        if (els.enableSyncHint) els.enableSyncHint.textContent = '';
      }
    }

    function switchSyncTab(which) {
      if (!els.syncPaneAccount || !els.syncPaneSaves) return;
      var loggedIn = !!getToken();
      if (which === 'saves' && !loggedIn) which = 'account';

      var isAccount = which !== 'saves';
      els.syncPaneAccount.style.display = isAccount ? '' : 'none';
      els.syncPaneSaves.style.display = isAccount ? 'none' : '';

      if (els.syncTabAccount) els.syncTabAccount.classList.toggle('active', isAccount);
      if (els.syncTabSaves) els.syncTabSaves.classList.toggle('active', !isAccount);

      if (!isAccount) refreshSaves();
    }

    function refreshSaves() {
      if (!els.archivesList || !els.revisionsList) return;
      if (!getToken()) {
        if (els.savesHint) els.savesHint.textContent = '登录后可使用云端存档。';
        els.archivesList.innerHTML = '';
        els.revisionsList.innerHTML = '';
        return;
      }
      if (els.savesHint) els.savesHint.textContent = '加载中…';
      els.archivesList.innerHTML = '';
      els.revisionsList.innerHTML = '';

      Promise.all([cloudListArchives(), cloudListRevisions()]).then(function (results) {
        var archives = (results[0] && results[0].items) ? results[0].items : [];
        var revisions = (results[1] && results[1].items) ? results[1].items : [];

        if (!archives.length) els.archivesList.innerHTML = '<div style=\"color:#64748b; font-size:0.92rem;\">暂无手动存档</div>';
        else {
          for (var i = 0; i < archives.length; i++) {
            (function (a) {
              var row = document.createElement('div');
              row.className = 'save-item';
              row.innerHTML =
                '<div class=\"save-meta\">' +
                  '<div class=\"save-name\"></div>' +
                  '<div class=\"save-tags\"></div>' +
                  '<div class=\"save-time\"></div>' +
                '</div>' +
                '<div class=\"save-actions\">' +
                  '<button class=\"modal-btn primary\" type=\"button\">恢复</button>' +
                  '<button class=\"modal-btn\" type=\"button\">重命名</button>' +
                  '<button class=\"modal-btn danger\" type=\"button\">删除</button>' +
                '</div>';
              var saveName = row.querySelector('.save-name');
              var saveTags = row.querySelector('.save-tags');
              var saveTime = row.querySelector('.save-time');
              saveName.textContent = a.name || ('存档 #' + a.id);
              saveTime.textContent = formatLocalTime(a.createdAt);

              var tags = [];
              var dateTag = formatDateTag(a.createdAt);
              if (dateTag) tags.push({ text: dateTag, kind: 'date' });
              var deviceTag = deviceLabelFromArchive(a);
              if (deviceTag) tags.push({ text: deviceTag, kind: 'device' });
              else tags.push({ text: '未记录设备', kind: 'muted' });
              if (saveTags) saveTags.innerHTML = tags.map(function (t) {
                return '<span class=\"tag tag--' + escapeAttr(t.kind) + '\">' + escapeHtml(t.text) + '</span>';
              }).join('');

              var btnRestore = row.querySelectorAll('button')[0];
              var btnRename = row.querySelectorAll('button')[1];
              var btnDelete = row.querySelectorAll('button')[2];

              btnRestore.onclick = function () {
                var before = appData;
                cloudRestoreArchive(a.id).then(function () {
                  return cloudLoadLibrary();
                }).then(function (j) {
                  if (j && j.data) {
                    var keepUi = appData && appData.ui ? normalizeUi(appData.ui) : defaultUi();
                    normalizeAppData(j.data, keepUi);
                    cloud.version = j.version || cloud.version;
                    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); } catch (_) {}
                    renderSidebar();
                    if (currentChapterId) loadChapter(currentChapterId);
                  }
                  showToast('已恢复存档', {
                    actionText: '撤销',
                    timeoutMs: 6500,
                    onAction: function () {
                      appData = before;
                      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); } catch (_) {}
                      renderSidebar();
                      if (currentChapterId) loadChapter(currentChapterId);
                      showToast('已撤销', { timeoutMs: 2200 });
                    }
                  });
                }).catch(function () {
                  showToast('恢复失败', { timeoutMs: 2400 });
                });
              };
              btnRename.onclick = function () {
                var name = prompt('重命名存档：', a.name || '');
                if (!name) return;
                cloudRenameArchive(a.id, name).then(refreshSaves).catch(function () { showToast('重命名失败', { timeoutMs: 2200 }); });
              };
              btnDelete.onclick = function () {
                if (!confirm('删除该存档？')) return;
                cloudDeleteArchive(a.id).then(refreshSaves).catch(function () { showToast('删除失败', { timeoutMs: 2200 }); });
              };

              els.archivesList.appendChild(row);
            })(archives[i]);
          }
        }

        if (!revisions.length) els.revisionsList.innerHTML = '<div style=\"color:#64748b; font-size:0.92rem;\">暂无自动存档</div>';
        else {
          for (var j = 0; j < revisions.length; j++) {
            (function (rv) {
              var row = document.createElement('div');
              row.className = 'save-item';
              row.innerHTML =
                '<div class=\"save-meta\">' +
                  '<div class=\"save-name\"></div>' +
                  '<div class=\"save-tags\"></div>' +
                  '<div class=\"save-time\"></div>' +
                '</div>' +
                '<div class=\"save-actions\">' +
                  '<button class=\"modal-btn primary\" type=\"button\">恢复</button>' +
                '</div>';
              var saveName = row.querySelector('.save-name');
              var saveTags = row.querySelector('.save-tags');
              var saveTime = row.querySelector('.save-time');
              saveName.textContent = '自动存档 v' + rv.version;
              saveTime.textContent = formatLocalTime(rv.createdAt);

              var tags = [];
              var dateTag = formatDateTag(rv.createdAt);
              if (dateTag) tags.push({ text: dateTag, kind: 'date' });
              var deviceTag = deviceLabelFromArchive(rv);
              if (deviceTag) tags.push({ text: deviceTag, kind: 'device' });
              else tags.push({ text: '未记录设备', kind: 'muted' });
              if (saveTags) saveTags.innerHTML = tags.map(function (t) {
                return '<span class=\"tag tag--' + escapeAttr(t.kind) + '\">' + escapeHtml(t.text) + '</span>';
              }).join('');

              var btnRestore = row.querySelectorAll('button')[0];
              btnRestore.onclick = function () {
                var before = appData;
                cloudRestoreRevision(rv.version).then(function () {
                  return cloudLoadLibrary();
                }).then(function (j) {
                  if (j && j.data) {
                    var keepUi = appData && appData.ui ? normalizeUi(appData.ui) : defaultUi();
                    normalizeAppData(j.data, keepUi);
                    cloud.version = j.version || cloud.version;
                    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); } catch (_) {}
                    renderSidebar();
                    if (currentChapterId) loadChapter(currentChapterId);
                  }
                  showToast('已恢复自动存档', {
                    actionText: '撤销',
                    timeoutMs: 6500,
                    onAction: function () {
                      appData = before;
                      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); } catch (_) {}
                      renderSidebar();
                      if (currentChapterId) loadChapter(currentChapterId);
                      showToast('已撤销', { timeoutMs: 2200 });
                    }
                  });
                }).catch(function () {
                  showToast('恢复失败', { timeoutMs: 2400 });
                });
              };

              els.revisionsList.appendChild(row);
            })(revisions[j]);
          }
        }

        if (els.savesHint) els.savesHint.textContent = '';
      }).catch(function () {
        if (els.savesHint) els.savesHint.textContent = '加载失败：请检查网络/反代配置。';
      });
    }

    function bindUiSyncOnce() {
      if (uiSyncBound) return;
      uiSyncBound = true;

      // 同步/账号
      if (els.syncBtn && els.authModal) {
        els.syncBtn.onclick = function () {
          updateAuthModalUI();
          // 默认：未登录先看账号；已登录直接看存档
          switchSyncTab(getToken() ? 'saves' : 'account');
          els.authModal.classList.add('open');
          syncModalScrollLock();
        };
      }

      if (els.savesCloseBtn && els.authModal) els.savesCloseBtn.onclick = function () { els.authModal.classList.remove('open'); syncModalScrollLock(); };

      if (els.authTabLogin) els.authTabLogin.onclick = function () { cloud.authMode = 'login'; updateAuthModalUI(); };
      if (els.authTabRegister) els.authTabRegister.onclick = function () { cloud.authMode = 'register'; updateAuthModalUI(); };

      if (els.syncTabAccount) els.syncTabAccount.onclick = function () { switchSyncTab('account'); };
      if (els.syncTabSaves) els.syncTabSaves.onclick = function () { switchSyncTab('saves'); };

      if (els.authCancelBtn && els.authModal) {
        els.authCancelBtn.onclick = function () { els.authModal.classList.remove('open'); syncModalScrollLock(); };
      }

      if (els.refreshSavesBtn) els.refreshSavesBtn.onclick = refreshSaves;

      if (els.createArchiveBtn) {
        els.createArchiveBtn.onclick = function () {
          if (!getToken()) { showToast('请先登录', { timeoutMs: 2200 }); return; }
          var name = (els.archiveName && typeof els.archiveName.value === 'string') ? els.archiveName.value.trim() : '';
          if (els.savesHint) els.savesHint.textContent = '创建中…';
          cloudCreateArchive(name || null, appData).then(function () {
            if (els.archiveName) els.archiveName.value = '';
            refreshSaves();
            showToast('已创建存档', { timeoutMs: 2200 });
          }).catch(function () {
            if (els.savesHint) els.savesHint.textContent = '创建失败';
          });
        };
      }

      if (els.authSubmitBtn) {
        els.authSubmitBtn.onclick = function () {
          if (!els.authUsername || !els.authPassword) return;
          var username = String(els.authUsername.value || '').trim();
          var password = String(els.authPassword.value || '').trim();
          if (username.length < 3) { if (els.authHint) els.authHint.textContent = '用户名太短'; return; }
          if (password.length < 8) { if (els.authHint) els.authHint.textContent = '密码至少 8 位'; return; }

          if (els.authHint) els.authHint.textContent = (cloud.authMode === 'register') ? '注册中…' : '登录中…';

          var path = (cloud.authMode === 'register') ? '/api/auth/register' : '/api/auth/login';
          apiFetch(path, { method: 'POST', body: JSON.stringify({ username: username, password: password }) })
            .then(function (res) { return res.json().then(function (j) { return { res: res, json: j }; }); })
            .then(function (r) {
              if (!r.res.ok) {
                var msg = (r.json && (r.json.message || r.json.error)) ? String(r.json.message || r.json.error) : '失败';
                if (els.authHint) els.authHint.textContent = msg;
                return;
              }
              setToken(r.json.token);
              if (els.authHint) els.authHint.textContent = '登录成功，开始同步…';
              tryBootstrapFromCloud().then(function () {
                renderSidebar();
                updateAuthModalUI();
                updateSyncStatus();
                switchSyncTab('saves');
              });
            })
            .catch(function () {
              if (els.authHint) els.authHint.textContent = '网络错误';
            });
        };
      }

      if (els.authLogoutBtn) {
        els.authLogoutBtn.onclick = function () {
          setToken(null);
          cloud.version = 0;
          cloud.bootstrapDone = false;
          updateSyncStatus();
          updateAuthModalUI();
          showToast('已退出登录（本地数据仍在）', { timeoutMs: 2600 });
          switchSyncTab('account');
        };
      }

      if (els.enableSyncUploadBtn) {
        els.enableSyncUploadBtn.onclick = function () {
          if (!getToken()) { showToast('请先登录', { timeoutMs: 2200 }); return; }
          if (!cloud.bootstrapDone) { showToast('请稍等：同步初始化中…', { timeoutMs: 2600 }); return; }
          if (cloud.syncEnabled) { showToast('云同步已启用', { timeoutMs: 2200 }); return; }

          if (els.enableSyncHint) els.enableSyncHint.textContent = '上传中…';
          updateSyncStatus('同步中…');

          cloudLoadLibrary().then(function (j) {
            var remote = j && j.data ? j.data : null;
            var remoteHas = appHasAnyContent(remote);
            if (remoteHas) {
              cloud.version = (j && typeof j.version === 'number') ? j.version : cloud.version;
              cloud.remoteEmpty = false;
              cloud.syncEnabled = true;
              if (els.enableSyncHint) els.enableSyncHint.textContent = '云端已有数据：已启用同步并默认以云端为准。';
              // 重新走一次引导，确保本机被云端覆盖并自动备份本机
              return tryBootstrapFromCloud().then(function () {
                renderSidebar();
                updateAuthModalUI();
                updateSyncStatus();
              });
            }

            // 云端仍为空：把本机上传为初始云端数据（显式操作）
            cloud.version = (j && typeof j.version === 'number') ? j.version : 0;
            return cloudSaveLibrary(0, false).then(function (r) {
              cloud.version = r && r.version ? r.version : cloud.version;
              cloud.remoteEmpty = false;
              cloud.syncEnabled = true;
              if (els.enableSyncHint) els.enableSyncHint.textContent = '上传完成：已启用云同步。';
              updateAuthModalUI();
              updateSyncStatus();
              showToast('已上传本机并启用云同步', { timeoutMs: 2600 });
            });
          }).catch(function () {
            if (els.enableSyncHint) els.enableSyncHint.textContent = '上传失败：请检查网络/反代配置。';
            cloud.syncEnabled = false;
            updateSyncStatus('同步失败');
          });
        };
      }

      updateAuthModalUI();
    }
