    /** ---------------------------
     * 12.3) UI 绑定：JSON 导入（文件/粘贴）
     * --------------------------- */
    var uiImportBound = false;

    function bindUiImportOnce() {
      if (uiImportBound) return;
      uiImportBound = true;

      function stripJsonCodeFences(text) {
        var s = String(text || '');

        // Normalize uncommon line separators (can break JSON.parse if pasted outside strings)
        s = s.replace(/\u2028|\u2029/g, '\n');

        // Strip leading invisible chars (BOM/zero-width) even if the user pasted leading newlines/spaces first.
        s = s
          .replace(/^[\s\uFEFF\u200B-\u200D\u2060]+/, '')
          .replace(/^[\s\uFEFF\u200B-\u200D\u2060]+/, '') // run twice to be extra safe across engines
          .trim()
          .replace(/^\uFEFF/, '')
          .replace(/^[\u200B-\u200D\u2060]+/, '')
          .trim();
        if (!s) return s;

        // Handle common AI output: ```json ... ```
        if (s.indexOf('```') !== -1) {
          // Fast path: leading fence on first line.
          if (s.slice(0, 3) === '```') {
            var lines = s.split(/\r?\n/);
            if (lines.length >= 2) {
              lines.shift(); // ``` or ```json
              while (lines.length && String(lines[lines.length - 1] || '').trim().slice(0, 3) === '```') lines.pop();
              s = lines.join('\n').trim();
            }
          }
          // Single-line fences (rare)
          s = s.replace(/^```[a-zA-Z0-9_-]*\s*/g, '').replace(/\s*```$/g, '').trim();
        }

        return s;
      }

      function extractFirstJsonSubstring(text) {
        var s = String(text || '');
        var iObj = s.indexOf('{');
        var iArr = s.indexOf('[');
        var start = -1;
        if (iObj >= 0 && iArr >= 0) start = Math.min(iObj, iArr);
        else start = Math.max(iObj, iArr);
        if (start < 0) return s;

        var endObj = s.lastIndexOf('}');
        var endArr = s.lastIndexOf(']');
        var end = Math.max(endObj, endArr);
        if (end < start) return s;
        return s.slice(start, end + 1);
      }

      function parseLooseJsonFromPaste(text) {
        var s = stripJsonCodeFences(text);
        if (!s) throw new Error('empty');

        function sanitizeJsonLikeInput(raw) {
          // Goal: accept common AI "almost JSON" outputs (raw newlines in strings, trailing commas).
          var src = String(raw || '');
          var out = '';
          var inStr = false;
          var esc = false;

          function isWs(ch) { return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t'; }

          for (var i = 0; i < src.length; i++) {
            var ch = src[i];

            if (!inStr) {
              if (ch === '"') { inStr = true; esc = false; out += ch; continue; }

              // Drop trailing commas: ", ]" or ", }" (ignoring whitespace)
              if (ch === ',') {
                var j = i + 1;
                while (j < src.length && isWs(src[j])) j++;
                var next = (j < src.length) ? src[j] : '';
                if (next === ']' || next === '}') continue;
              }

              out += ch;
              continue;
            }

            // in string
            if (esc) { out += ch; esc = false; continue; }
            if (ch === '\\') {
              var next2 = (i + 1 < src.length) ? src[i + 1] : '';
              var validEscape =
                next2 === '"' ||
                next2 === '\\' ||
                next2 === '/' ||
                next2 === 'b' ||
                next2 === 'f' ||
                next2 === 'n' ||
                next2 === 'r' ||
                next2 === 't';
              var validUnicode = next2 === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6));

              // If it's not a valid JSON escape, treat it as a literal backslash (e.g. LaTeX: \approx)
              if (!validEscape && !validUnicode) { out += '\\\\'; continue; }

              out += ch;
              esc = true;
              continue;
            }

            // Common invalid JSON from AI: unescaped quotes inside strings, especially HTML attributes.
            // e.g. "<span class="highlight">" should be "<span class=\"highlight\">"
            if (src.slice(i, i + 7) === 'class="') {
              out += 'class=\\\"';
              i += 6;
              continue;
            }
            // The closing quote of class attribute is commonly right before '>'
            if (ch === '"' && src[i + 1] === '>') { out += '\\\"'; continue; }

            if (ch === '"') { out += ch; inStr = false; esc = false; continue; }

            // Raw line breaks / tabs inside strings -> escape them
            if (ch === '\r') {
              // If it's CRLF, consume LF too.
              if (src[i + 1] === '\n') i++;
              out += '\\n';
              continue;
            }
            if (ch === '\n') { out += '\\n'; continue; }
            if (ch === '\t') { out += '\\t'; continue; }

            out += ch;
          }

          return out;
        }

        try {
          return JSON.parse(s);
        } catch (e1) {
          try {
            var sub = extractFirstJsonSubstring(s);
            if (sub && sub !== s) return JSON.parse(sub);
          } catch (_) {}

          // Last-chance: sanitize "almost JSON" outputs (raw newlines in strings / trailing commas).
          try {
            var repaired = sanitizeJsonLikeInput(s);
            if (repaired && repaired !== s) return JSON.parse(repaired);
          } catch (_) {}
          throw e1;
        }
      }

      function copyTextToClipboard(text) {
        text = String(text || '');
        if (!text) return Promise.reject(new Error('empty'));

        // Modern API (requires secure context on most browsers)
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          return navigator.clipboard.writeText(text);
        }

        // Fallback: execCommand('copy')
        return new Promise(function (resolve, reject) {
          try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '0';
            ta.style.top = '0';
            ta.style.width = '1px';
            ta.style.height = '1px';
            ta.style.opacity = '0';
            ta.style.pointerEvents = 'none';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try { ta.setSelectionRange(0, ta.value.length); } catch (_) {}
            var ok = false;
            try { ok = !!(document.execCommand && document.execCommand('copy')); } catch (_) { ok = false; }
            if (ta.remove) ta.remove();
            if (ok) resolve(true);
            else reject(new Error('copy_failed'));
          } catch (e) {
            reject(e);
          }
        });
      }

      function switchImportTab(which) {
        if (!els.importPaneFile || !els.importPanePaste) return;
        var isFile = which !== 'paste';
        els.importPaneFile.style.display = isFile ? '' : 'none';
        els.importPanePaste.style.display = isFile ? 'none' : '';
        if (els.importTabFile) els.importTabFile.classList.toggle('active', isFile);
        if (els.importTabPaste) els.importTabPaste.classList.toggle('active', !isFile);
      }

      if (els.importBtn && els.importModal) {
        els.importBtn.onclick = function () {
          switchImportTab('file');
          els.importModal.classList.add('open');
          syncModalScrollLock();
        };
      }
      if (els.importTabFile) els.importTabFile.onclick = function () { switchImportTab('file'); };
      if (els.importTabPaste) els.importTabPaste.onclick = function () { switchImportTab('paste'); };
      if (els.closeImportBtn && els.importModal) els.closeImportBtn.onclick = function () { els.importModal.classList.remove('open'); syncModalScrollLock(); };

      if (els.importFileInput) {
        els.importFileInput.onchange = function (e) {
          var f = e && e.target && e.target.files ? e.target.files[0] : null;
          if (!f) return;
          var r = new FileReader();
          r.onload = function (ev) {
            try {
              var data = JSON.parse(ev.target.result);
              importAnyJSON(data);
              if (els.importModal) els.importModal.classList.remove('open');
              syncModalScrollLock();
            } catch (err) {
              alert('文件无效');
            }
          };
          r.readAsText(f);
          els.importFileInput.value = '';
        };
      }

      if (els.cancelImportBtn && els.importModal) {
        els.cancelImportBtn.onclick = function () { els.importModal.classList.remove('open'); syncModalScrollLock(); };
      }
      if (els.confirmImportBtn && els.importTextarea && els.importModal) {
        els.confirmImportBtn.onclick = function () {
          try {
            var data = parseLooseJsonFromPaste(els.importTextarea.value);
            importAnyJSON(data);
            els.importModal.classList.remove('open');
            syncModalScrollLock();
            els.importTextarea.value = '';
          } catch (e) {
            var msg = (e && e.message) ? String(e.message) : String(e);
            alert('JSON解析失败：' + msg + '\n\n提示：可直接粘贴 AI 输出（含 ```json 也行）。若 AI 输出的 JSON 字符串里包含“直接换行”，请让它把换行写成 \\n。');
          }
        };
      }

      if (els.copyImportPromptBtn) {
        els.copyImportPromptBtn.onclick = function (e) {
          try { if (e) { e.preventDefault(); e.stopPropagation(); } } catch (_) {}
          var pre = els.importPromptPre;
          var host = null;
          try { host = pre && pre.closest ? pre.closest('.import-paste-help-body') : null; } catch (_) { host = null; }
          var text = '';
          if (host && host.querySelectorAll) {
            var pres = host.querySelectorAll('pre.import-paste-help-pre');
            var parts = [];
            for (var i = 0; i < pres.length; i++) {
              var t = pres[i] ? String(pres[i].textContent || '') : '';
              t = t.replace(/\s+$/g, '');
              if (t) parts.push(t);
            }
            text = parts.join('\n\n');
          } else {
            text = pre ? String(pre.textContent || '') : '';
          }
          copyTextToClipboard(text)
            .then(function () {
              if (typeof showToast === 'function') showToast('已复制提示词', { timeoutMs: 1600 });
            })
            .catch(function () {
              try {
                if (window && typeof window.prompt === 'function') window.prompt('复制提示词（手动复制）：', text);
              } catch (_) {}
              if (typeof showToast === 'function') showToast('复制失败：已打开手动复制框', { timeoutMs: 2600 });
            });
        };
      }
    }
