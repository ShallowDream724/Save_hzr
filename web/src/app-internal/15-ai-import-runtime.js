    function mergeRemoteAiChaptersIntoLocal(remoteData, bookId, jobId) {
      try {
        if (!remoteData || !remoteData.books || !bookId) return 0;
        var books = getBooks();
        var localBook = null;
        for (var i = 0; i < books.length; i++) if (books[i] && books[i].id === bookId) { localBook = books[i]; break; }
        if (!localBook) return 0;

        var remoteBook = null;
        for (var j = 0; j < remoteData.books.length; j++) {
          var b = remoteData.books[j];
          if (b && b.id === bookId) { remoteBook = b; break; }
        }
        if (!remoteBook) return 0;

        if (!Array.isArray(localBook.chapters)) localBook.chapters = [];
        if (!Array.isArray(remoteBook.chapters)) return 0;

        var localIds = new Set();
        for (var k = 0; k < localBook.chapters.length; k++) {
          var cid = localBook.chapters[k] && localBook.chapters[k].id ? String(localBook.chapters[k].id) : '';
          if (cid) localIds.add(cid);
        }
        var tomb = new Set();
        if (Array.isArray(localBook.deletedChapterIds)) {
          for (var t = 0; t < localBook.deletedChapterIds.length; t++) tomb.add(String(localBook.deletedChapterIds[t]));
        }

        var added = 0;
        var prefix = jobId ? ('ai_' + String(jobId) + '_') : 'ai_';
        for (var m = 0; m < remoteBook.chapters.length; m++) {
          var ch = remoteBook.chapters[m];
          var id = ch && ch.id ? String(ch.id) : '';
          if (!id || id.indexOf(prefix) !== 0) continue;
          if (tomb.has(id)) continue;
          if (localIds.has(id)) continue;
          localBook.chapters.push(ch);
          localIds.add(id);
          added += 1;
        }
        return added;
      } catch (_) {
        return 0;
      }
    }

    function pullCloudAiUpdatesForJob(bookId, jobId) {
      if (!getToken()) return Promise.resolve(false);
      return cloudLoadLibrary().then(function (j) {
        if (!j || !j.data) return false;
        var added = mergeRemoteAiChaptersIntoLocal(j.data, bookId, jobId);
        if (typeof j.version === 'number') cloud.version = j.version;
        if (added > 0) {
          saveData();
          renderSidebar();
          if (homeVisible) renderHome();
        }
        return added > 0;
      }).catch(function () { return false; });
    }

    function applyAiImportSnapshot(payload) {
      var job = payload && payload.job ? payload.job : null;
      if (!job || !job.progress) return;
      var items = payload && Array.isArray(payload.items) ? payload.items : [];

      var p = job.progress;
      var total = Number(p.totalPages) || 0;
      var done = Number(p.donePages) || 0;
      var ok = Number(p.okPages) || 0;
      var fail = Number(p.failedPages) || 0;
      var pct = total > 0 ? Math.round((done / total) * 100) : 0;
      setAiImportProgress(pct, statusLabel(p.status) + ' · ' + done + '/' + total + '（成功 ' + ok + '，失败 ' + fail + '）');

      var active = (p.status === 'queued' || p.status === 'running' || p.status === 'finalizing' || p.status === 'writing');
      setAiImportCancelable(active);

      if (p.status === 'queued' || p.status === 'running' || p.status === 'finalizing' || p.status === 'writing') {
        var eta = (p.etaMin !== undefined && p.etaMin !== null) ? String(p.etaMin) : '';
        setAiImportQueueText('排队：前面 ' + String(p.aheadUsers || 0) + ' 位用户 · 预计 ' + (eta ? eta + ' 分钟' : '计算中…'));
      } else {
        setAiImportQueueText('');
      }

      if (p.status === 'canceled') {
        clearAiImportJobPolling();
        stopAiImportEvents();
        setAiImportQueueText('');
        setAiImportHint('已终止任务。');
        return;
      }

      if (job.status === 'done' || job.status === 'done_with_errors' || job.status === 'failed') {
        renderAiImportResultFromJob(job, items);
      }

      if (p.status === 'done' || p.status === 'done_with_errors' || p.status === 'failed') {
        clearAiImportJobPolling();
        stopAiImportEvents();
        if (p.status === 'done') setAiImportHint('完成：已写入题库。');
        else if (p.status === 'done_with_errors') setAiImportHint('完成但有失败页：可稍后重试导入。');
        else setAiImportHint('失败：请稍后重试。');

        // Best-effort pull remote AI chapters into local UI so the user can see them immediately.
        try {
          var b = getActiveBook();
          if (b && b.id && aiImport.jobId) pullCloudAiUpdatesForJob(String(b.id), String(aiImport.jobId));
        } catch (_) {}
        return;
      }

      // Real-time stage hint derived from server items (no guessing).
      try {
        var runningIt = null;
        var retryIt = null;
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (!it) continue;
          if (it.kind === 'extract' && it.status === 'running' && runningIt === null) runningIt = it;
          if (it.kind === 'extract' && it.status === 'retry_wait') {
            if (!retryIt) retryIt = it;
            else {
              var a = secondsUntil(it.delayedUntil);
              var b2 = secondsUntil(retryIt.delayedUntil);
              if (a && (!b2 || a < b2)) retryIt = it;
            }
          }
        }

        if (p.status === 'running') {
          if (runningIt) {
            var pi = Number(runningIt.idx);
            var at = Number(runningIt.attempt) || 1;
            setAiImportHint('识别中：第 ' + (Number.isFinite(pi) ? (pi + 1) : '?') + ' 页（尝试 ' + at + '/3）…');
          } else if (retryIt) {
            var ri = Number(retryIt.idx);
            var sec = secondsUntil(retryIt.delayedUntil);
            setAiImportHint('等待重试：第 ' + (Number.isFinite(ri) ? (ri + 1) : '?') + ' 页（约 ' + formatSecondsShort(sec) + ' 后）');
          } else {
            setAiImportHint('识别中…');
          }
        } else if (p.status === 'queued') {
          setAiImportHint('排队中…');
        } else if (p.status === 'finalizing') {
          setAiImportHint('整理题目中…');
        } else if (p.status === 'writing') {
          setAiImportHint('写入题库中…');
        }
      } catch (_) {}
    }

    function subscribeAiImportJobEvents(jobId) {
      if (!jobId) return;
      stopAiImportEvents();
      clearAiImportJobPolling();
      aiImport.jobId = jobId;

      try {
        if (typeof AbortController === 'undefined') throw new Error('no AbortController');
        var ac = new AbortController();
        aiImport.eventsAbort = ac;
        fetchWithAuth('/api/ai/jobs/' + encodeURIComponent(String(jobId)) + '/events', { method: 'GET', signal: ac.signal })
          .then(function (res) {
            if (!res.ok) throw new Error('events failed');
            return consumeEventStream(res, function (event, data) {
              if (event === 'snapshot' && data) applyAiImportSnapshot(data);
            });
          })
          .catch(function () {
            // Fallback to polling if streaming is blocked by proxy/browser.
            pollAiImportJob(jobId);
            aiImport.pollTimer = setInterval(function () { pollAiImportJob(jobId); }, 2000);
          });
      } catch (_) {
        pollAiImportJob(jobId);
        aiImport.pollTimer = setInterval(function () { pollAiImportJob(jobId); }, 2000);
      }
    }

    function maybeAttachActiveImportJob(bookId) {
      if (!bookId) return;
      apiFetch('/api/ai/jobs?bookId=' + encodeURIComponent(String(bookId)), { method: 'GET' })
        .then(function (res) { if (!res.ok) throw new Error('jobs failed'); return res.json(); })
        .then(function (j) {
          var items = j && Array.isArray(j.items) ? j.items : [];
          for (var i = 0; i < items.length; i++) {
            var job = items[i];
            if (!job || !job.id) continue;
            if (job.status === 'queued' || job.status === 'running' || job.status === 'finalizing' || job.status === 'writing') {
              aiImport.jobId = job.id;
              setAiImportHint('检测到进行中的导入任务：已自动接入进度。');
              subscribeAiImportJobEvents(job.id);
              return;
            }
          }
        })
        .catch(function () {});
    }

    function pollAiImportJob(jobId) {
      if (!jobId) return;
      return apiFetch('/api/ai/jobs/' + encodeURIComponent(String(jobId)), { method: 'GET' })
        .then(function (res) { if (!res.ok) throw new Error('job load failed'); return res.json(); })
        .then(function (j) {
          if (j && j.job && j.job.id) aiImport.jobId = j.job.id;
          applyAiImportSnapshot(j);
          return j;
        })
        .catch(function (e) {
          setAiImportHint('状态获取失败：' + (e && e.message ? e.message : '网络错误'));
        });
    }

    function startAiImport() {
      if (!getToken()) {
        showToast('请先登录云同步', { timeoutMs: 2200 });
        return;
      }
      if (homeVisible) {
        showToast('请先进入一本书再导入', { timeoutMs: 2200 });
        return;
      }
      var book = getActiveBook();
      if (!book || !book.id) { showToast('未找到书', { timeoutMs: 1800 }); return; }
      if (!aiImport.files.length) { showToast('请先选择图片（最多 9 张）', { timeoutMs: 2200 }); return; }

      var model = getModelFromSwitch(els.aiImportModelSwitch, 'flash');
      var noteText = (els.aiImportNoteText && typeof els.aiImportNoteText.value === 'string') ? els.aiImportNoteText.value : '';

      var fd = new FormData();
      fd.append('bookId', String(book.id));
      fd.append('bookTitle', String(book.title || ''));
      fd.append('bookTheme', String(book.theme || ''));
      fd.append('bookIcon', String(book.icon || ''));
      fd.append('model', model);
      fd.append('noteText', noteText || '');
      for (var i = 0; i < aiImport.files.length; i++) {
        var it = aiImport.files[i];
        if (!it || !it.file) continue;
        fd.append('images', it.file, it.name || it.file.name || ('page_' + (i + 1) + '.png'));
      }

      setAiImportHint('提交中…');
      setAiImportProgress(0, '提交中…');

      fetchWithAuth('/api/ai/book-import', { method: 'POST', body: fd })
        .then(function (res) {
          return res.json().then(function (j) { return { res: res, json: j }; });
        })
        .then(function (x) {
          if (x.res.status === 409 && x.json && x.json.jobId) {
            aiImport.jobId = x.json.jobId;
            setAiImportHint('已有进行中的导入任务，已切换到该任务。');
            return aiImport.jobId;
          }
          if (!x.res.ok) {
            var msg = (x.json && (x.json.message || x.json.error)) ? String(x.json.message || x.json.error) : '提交失败';
            throw new Error(msg);
          }
          if (!x.json || !x.json.jobId) throw new Error('bad response');
          aiImport.jobId = x.json.jobId;
          setAiImportHint('已提交：后台处理中…');
          return aiImport.jobId;
        })
        .then(function (jobId) {
          // Prefer SSE for real-time progress; fallback to polling inside subscribe.
          subscribeAiImportJobEvents(jobId);
        })
        .catch(function (e) {
          setAiImportHint('失败：' + (e && e.message ? e.message : '提交失败'));
          setAiImportProgress(0, '未开始');
        });
    }

