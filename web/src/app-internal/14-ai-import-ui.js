    /** ---------------------------
     * 8.2) 书内拍照导入（<=9 张，后端异步队列）
     * --------------------------- */
    var aiImport = {
      files: [],
      jobId: null,
      pollTimer: 0,
      eventsAbort: null,
      dragFrom: null
    };

    function setAiImportHint(text) {
      if (!els.aiImportHint) return;
      els.aiImportHint.textContent = text ? String(text) : '';
    }

    function setAiImportProgress(pct, text) {
      if (els.aiImportProgressFill) els.aiImportProgressFill.style.width = String(Math.max(0, Math.min(100, pct || 0))) + '%';
      if (els.aiImportProgressText) els.aiImportProgressText.textContent = text ? String(text) : '';
    }

    function setAiImportQueueText(text) {
      if (!els.aiImportQueueText) return;
      els.aiImportQueueText.textContent = text ? String(text) : '';
    }

    function setAiImportCancelable(on) {
      try {
        if (els.aiImportCancelBtn) els.aiImportCancelBtn.style.display = on ? '' : 'none';
        if (els.aiImportStartBtn) els.aiImportStartBtn.disabled = !!on;
      } catch (_) {}
    }

    function clearAiImportResult() {
      if (!els.aiImportResult) return;
      els.aiImportResult.innerHTML = '';
    }

    function renderAiImportFiles() {
      if (!els.aiImportFilesList) return;
      var html = '';
      for (var i = 0; i < aiImport.files.length; i++) {
        var it = aiImport.files[i];
        if (!it || !it.file) continue;
        html += '<div class="ai-import-file" data-idx="' + i + '" draggable="true">' +
          '<span class="ai-import-file-idx">' + (i + 1) + '</span>' +
          '<img class="ai-import-thumb" src="' + escapeHtml(it.url || '') + '" alt="preview">' +
          '<span class="ai-import-file-name">' + escapeHtml(it.name || it.file.name || ('image_' + (i + 1))) + '</span>' +
          '<button class="ai-import-move-up" type="button" title="上移">↑</button>' +
          '<button class="ai-import-move-down" type="button" title="下移">↓</button>' +
          '<button class="ai-import-file-remove" type="button" title="移除">移除</button>' +
        '</div>';
      }
      els.aiImportFilesList.innerHTML = html;
    }

    function addAiImportFiles(fileList) {
      var list = fileList && fileList.length ? fileList : [];
      for (var i = 0; i < list.length; i++) {
        if (aiImport.files.length >= 9) break;
        var f = list[i];
        if (!f) continue;
        var type = String(f.type || '');
        if (type && type.indexOf('image/') !== 0) continue;
        var url = '';
        try { url = URL.createObjectURL(f); } catch (_) { url = ''; }
        aiImport.files.push({ id: uid('img'), file: f, name: f.name || ('image_' + (aiImport.files.length + 1) + '.png'), url: url });
      }
      if (aiImport.files.length > 9) aiImport.files = aiImport.files.slice(0, 9);
      renderAiImportFiles();
    }

    function clearAiImportFiles() {
      try {
        for (var i = 0; i < aiImport.files.length; i++) {
          var it = aiImport.files[i];
          if (it && it.url) {
            try { URL.revokeObjectURL(it.url); } catch (_) {}
          }
        }
      } catch (_) {}
      aiImport.files = [];
      renderAiImportFiles();
    }

    function clearAiImportJobPolling() {
      if (aiImport.pollTimer) {
        try { clearInterval(aiImport.pollTimer); } catch (_) {}
        aiImport.pollTimer = 0;
      }
    }

    function stopAiImportEvents() {
      if (aiImport.eventsAbort) {
        try { aiImport.eventsAbort.abort(); } catch (_) {}
      }
      aiImport.eventsAbort = null;
    }

    function openAiImportModal() {
      if (!els.aiImportModal) return;
      if (!getToken()) {
        showToast('请先登录云同步后使用 AI 导入', { timeoutMs: 2400 });
        updateAuthModalUI();
        switchSyncTab('account');
        if (els.authModal) els.authModal.classList.add('open');
        return;
      }
      if (homeVisible) {
        showToast('请先进入一本书再导入', { timeoutMs: 2200 });
        return;
      }
      clearAiImportJobPolling();
      stopAiImportEvents();
      clearAiImportFiles();
      aiImport.jobId = null;
      if (els.aiImportNoteText) els.aiImportNoteText.value = '';
      setAiImportProgress(0, '未开始');
      setAiImportQueueText('');
      setAiImportHint('');
      setAiImportCancelable(false);
      clearAiImportResult();
      els.aiImportModal.classList.add('open');
      syncModalScrollLock();

      // If there is an active job for this book (multi-device), attach to it.
      try {
        var book = getActiveBook();
        if (book && book.id) maybeAttachActiveImportJob(String(book.id));
      } catch (_) {}
    }

    function closeAiImportModal() {
      if (!els.aiImportModal) return;
      els.aiImportModal.classList.remove('open');
      syncModalScrollLock();
      clearAiImportJobPolling();
      stopAiImportEvents();
    }

    function fetchWithAuth(path, options) {
      options = options || {};
      var headers = options.headers || {};
      var t = getToken();
      if (t) headers['Authorization'] = 'Bearer ' + t;
      headers['X-Device-Id'] = headers['X-Device-Id'] || getOrCreateDeviceId();
      try {
        headers['X-Device-Label'] = headers['X-Device-Label'] || encodeURIComponent(getDeviceLabel());
      } catch (_) {
        headers['X-Device-Label'] = headers['X-Device-Label'] || '';
      }
      options.headers = headers;
      return fetch(API_BASE + path, options);
    }

    function statusLabel(s) {
      s = String(s || '');
      if (s === 'queued') return '排队中';
      if (s === 'running') return '识别中';
      if (s === 'finalizing') return '归并中';
      if (s === 'writing') return '写入中';
      if (s === 'done') return '完成';
      if (s === 'done_with_errors') return '完成(有失败页)';
      if (s === 'failed') return '失败';
      if (s === 'canceled') return '已终止';
      return s || '';
    }

    function cancelAiImportJob() {
      if (!getToken()) { showToast('请先登录云同步', { timeoutMs: 2200 }); return; }
      var jobId = aiImport.jobId;
      if (!jobId) { showToast('暂无进行中的任务', { timeoutMs: 2000 }); return; }

      setAiImportHint('正在终止任务…');
      apiFetch('/api/ai/jobs/' + encodeURIComponent(String(jobId)) + '/cancel', { method: 'POST', body: '{}' })
        .then(function (res) { return res.json().then(function (j) { return { res: res, json: j }; }); })
        .then(function (x) {
          if (!x.res.ok) {
            var msg = (x.json && (x.json.message || x.json.error)) ? String(x.json.message || x.json.error) : '终止失败';
            throw new Error(msg);
          }
          stopAiImportEvents();
          clearAiImportJobPolling();
          if (x.json && x.json.job) applyAiImportSnapshot({ job: x.json.job });
          setAiImportHint('已终止任务。');
        })
        .catch(function (e) {
          setAiImportHint('终止失败：' + (e && e.message ? e.message : '网络错误'));
        });
    }

    function formatSecondsShort(sec) {
      sec = Math.max(0, Math.floor(Number(sec) || 0));
      if (sec < 60) return sec + 's';
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      if (m < 60) return m + 'm' + (s ? (s + 's') : '');
      var h = Math.floor(m / 60);
      m = m % 60;
      return h + 'h' + (m ? (m + 'm') : '');
    }

    function secondsUntil(iso) {
      if (!iso) return 0;
      var t = Date.parse(String(iso));
      if (!Number.isFinite(t)) return 0;
      return Math.max(0, Math.round((t - Date.now()) / 1000));
    }

    function renderAiImportResultFromJob(job, items) {
      if (!els.aiImportResult) return;
      var result = job && job.result ? job.result : null;
      var inserted = (result && Array.isArray(result.insertedChapters)) ? result.insertedChapters : [];
      var warnings = (result && Array.isArray(result.warnings)) ? result.warnings : [];

      var failed = [];
      var list = Array.isArray(items) ? items : [];
      for (var i0 = 0; i0 < list.length; i0++) {
        var it0 = list[i0];
        if (!it0 || it0.kind !== 'extract') continue;
        if (it0.status !== 'failed') continue;
        failed.push({ idx: it0.idx, error: it0.error || '' });
      }

      if (!inserted.length && !warnings.length && !failed.length) {
        els.aiImportResult.innerHTML = '';
        return;
      }
      var html = '';
      for (var i = 0; i < inserted.length; i++) {
        var ch = inserted[i];
        if (!ch || !ch.id) continue;
        html += '<div class="ai-import-result-item" data-chid="' + escapeHtml(ch.id) + '">' +
          '<div class="ai-import-result-title">' + escapeHtml(ch.title || ch.id) + '</div>' +
          '<button class="ai-import-open-btn" type="button">打开</button>' +
        '</div>';
      }

      for (var f = 0; f < failed.length; f++) {
        var fr = failed[f];
        var idx = (fr && fr.idx !== undefined && fr.idx !== null) ? Number(fr.idx) : NaN;
        var msg = fr && fr.error ? String(fr.error) : '未知错误';
        var title = Number.isFinite(idx) ? ('第 ' + (idx + 1) + ' 页失败') : '页面失败';
        html += '<div class="ai-import-result-item ai-import-result-item--fail">' +
          '<div class="ai-import-result-title">' + escapeHtml(title) + '</div>' +
          '<div class="ai-import-result-sub">' + escapeHtml(msg) + '</div>' +
        '</div>';
      }

      if (warnings.length) {
        html += '<details class="ai-import-warnings">' +
          '<summary>提示（' + warnings.length + '）</summary>' +
          '<div class="ai-import-warnings-body">' + escapeHtml(warnings.join('\n')) + '</div>' +
        '</details>';
      }
      els.aiImportResult.innerHTML = html;
    }

