    /** ---------------------------
     * 8) 章节加载与题卡（保持你原逻辑）
     * --------------------------- */
    function loadChapter(id) {
      if (homeVisible) hideHomeView();
      currentChapterId = id;

      // Virtual chapter: Favorites
      if (typeof isFavoritesChapterId === 'function' && isFavoritesChapterId(id)) {
        if (typeof setTopBarTitle === 'function') setTopBarTitle('收藏夹');
        else if (els.chapterTitle) els.chapterTitle.innerText = '收藏夹';

        renderSidebar();

        if (els.questionsContainer) {
          els.questionsContainer.innerHTML = '';
          var entries = (typeof listFavoriteEntries === 'function') ? listFavoriteEntries(getActiveBook()) : [];
          if (!entries.length) {
            els.questionsContainer.innerHTML = '<div class="favorites-empty">暂无收藏。点题目右上角的 ☆ 即可加入收藏夹。</div>';
          } else {
            for (var f = 0; f < entries.length; f++) {
              var it = entries[f];
              if (!it || !it.chapterId || !it.qid) continue;
              var res = (typeof favoritesResolveQuestion === 'function')
                ? favoritesResolveQuestion(it.chapterId, it.qid, it.idx)
                : null;

              if (!res || !res.chapter || !res.q) {
                // Missing: show a minimal placeholder so user can un-favorite.
                var miss = document.createElement('div');
                miss.className = 'question-card';
                miss.dataset.chapterId = String(it.chapterId || '');
                miss.dataset.qid = String(it.qid || '');

                var header = document.createElement('div');
                header.className = 'q-header';

                var idEl = document.createElement('span');
                idEl.className = 'q-id';
                idEl.textContent = '?';

                var textEl = document.createElement('div');
                textEl.className = 'q-text';
                renderMarkdownInto(textEl, '题目已不存在（可能章节被删除/覆盖）。');

                var actions = document.createElement('div');
                actions.className = 'q-actions';

                var favBtn = document.createElement('button');
                favBtn.className = 'fav-btn on';
                favBtn.type = 'button';
                favBtn.title = '取消收藏';
                favBtn.setAttribute('aria-label', '取消收藏');
                favBtn.setAttribute('aria-pressed', 'true');
                favBtn.innerHTML = '<i class="fa-solid fa-star"></i>';
                favBtn.onclick = function (e) {
                  try { if (e) { e.preventDefault(); e.stopPropagation(); } } catch (_) {}
                  var card = this && this.closest ? this.closest('.question-card') : null;
                  var chId = card && card.dataset ? String(card.dataset.chapterId || '') : '';
                  var qid = card && card.dataset ? String(card.dataset.qid || '') : '';
                  if (!chId || !qid) return;
                  try { if (typeof toggleFavoriteQuestion === 'function') toggleFavoriteQuestion(chId, qid, null); } catch (_) {}
                  try { if (card && card.remove) card.remove(); } catch (_) {}
                  try {
                    if (els.questionsContainer && !els.questionsContainer.querySelector('.question-card')) {
                      els.questionsContainer.innerHTML = '<div class="favorites-empty">暂无收藏。点题目右上角的 ☆ 即可加入收藏夹。</div>';
                    }
                  } catch (_) {}
                };

                actions.appendChild(favBtn);

                header.appendChild(idEl);
                header.appendChild(textEl);
                header.appendChild(actions);
                miss.appendChild(header);
                els.questionsContainer.appendChild(miss);
              } else {
                els.questionsContainer.appendChild(createQuestionCard(res.q, String(it.chapterId), res.idx));
              }
            }
          }
        }

        window.scrollTo(0, 0);
        if (window.innerWidth <= 768 && els.sidebar) els.sidebar.classList.remove('active');
        if (typeof persistViewState === 'function') persistViewState();
        return;
      }

      var chapter = findChapterById(id);
      if (!chapter || isDeleted(id)) return;
  
      if (typeof setTopBarTitle === 'function') setTopBarTitle(chapter.title);
      else if (els.chapterTitle) els.chapterTitle.innerText = chapter.title;
  
      renderSidebar();
  
      if (els.questionsContainer) {
        els.questionsContainer.innerHTML = '';
        for (var i = 0; i < (chapter.questions || []).length; i++) {
          els.questionsContainer.appendChild(createQuestionCard(chapter.questions[i], id, i));
        }
      }
  
      window.scrollTo(0, 0);
      if (window.innerWidth <= 768 && els.sidebar) els.sidebar.classList.remove('active');
      if (typeof persistViewState === 'function') persistViewState();
    }
  
    function createQuestionCard(q, chapterId, qIndex) {
      var card = document.createElement('div');
      card.className = 'question-card';
      var qid = (q && q.qid !== undefined && q.qid !== null) ? String(q.qid)
        : (q && q.id !== undefined && q.id !== null) ? String(q.id)
        : '';
      if (qid) card.dataset.hzrSeed = 'q:' + qid;
      if (qid) card.dataset.qid = qid;
      var chId = (chapterId !== undefined && chapterId !== null) ? String(chapterId || '') : (currentChapterId ? String(currentChapterId) : '');
      if (chId) card.dataset.chapterId = chId;

      var header = document.createElement('div');
      header.className = 'q-header';

      var idEl = document.createElement('span');
      idEl.className = 'q-id';
      idEl.textContent = (q && q.id !== undefined && q.id !== null) ? String(q.id) : '';

      var textEl = document.createElement('div');
      textEl.className = 'q-text';
      renderMarkdownInto(textEl, q && q.text);

      var actions = document.createElement('div');
      actions.className = 'q-actions';

      var favBtn = document.createElement('button');
      favBtn.className = 'fav-btn';
      favBtn.type = 'button';
      favBtn.title = '收藏';
      favBtn.setAttribute('aria-label', '收藏');
      favBtn.setAttribute('aria-pressed', 'false');
      favBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
      try {
        if (typeof setFavBtnState === 'function') setFavBtnState(favBtn, !!(chId && qid && isFavoriteQuestion(chId, qid)));
      } catch (_) {}

      var aiBtn = document.createElement('button');
      aiBtn.className = 'ai-ask-btn';
      aiBtn.type = 'button';
      aiBtn.title = '问 AI';
      aiBtn.textContent = '问AI';

      header.appendChild(idEl);
      header.appendChild(textEl);
      actions.appendChild(favBtn);
      actions.appendChild(aiBtn);
      header.appendChild(actions);
      card.appendChild(header);

      favBtn.onclick = function (e) {
        try { if (e) { e.preventDefault(); e.stopPropagation(); } } catch (_) {}
        if (!qid || !chId) return;
        var res = null;
        try { if (typeof toggleFavoriteQuestion === 'function') res = toggleFavoriteQuestion(chId, qid, qIndex); } catch (_) { res = null; }
        try { if (typeof setFavBtnState === 'function') setFavBtnState(favBtn, !!(res && res.on)); } catch (_) {}
        try {
          if (res && !res.on && typeof isFavoritesChapterId === 'function' && isFavoritesChapterId(currentChapterId)) {
            if (card && card.remove) card.remove();
            if (els.questionsContainer && !els.questionsContainer.querySelector('.question-card')) {
              els.questionsContainer.innerHTML = '<div class="favorites-empty">暂无收藏。点题目右上角的 ☆ 即可加入收藏夹。</div>';
            }
          }
        } catch (_) {}
      };

      var ul = document.createElement('ul');
      ul.className = 'options-list';
      for (var i = 0; i < (q.options || []).length; i++) {
        var opt = q.options[i];
        var li = document.createElement('li');
        var isCorrect = opt && opt.label === q.answer;
        li.className = 'option-item ' + (isCorrect ? 'correct' : '');

        var lab = document.createElement('span');
        lab.className = 'option-label';
        lab.textContent = opt && opt.label ? String(opt.label) : '';

        var cont = document.createElement('div');
        cont.className = 'option-content';
        renderMarkdownInto(cont, opt && opt.content, { inline: true });

        li.appendChild(lab);
        li.appendChild(cont);

        if (isCorrect) {
          var icon = document.createElement('i');
          icon.className = 'fa-solid fa-check';
          icon.style.marginLeft = 'auto';
          icon.style.color = 'green';
          li.appendChild(icon);
        }

        ul.appendChild(li);
      }
      card.appendChild(ul);

      if (q && q.explanation) {
        var box = document.createElement('div');
        box.className = 'analysis-box';

        var title = document.createElement('div');
        title.className = 'analysis-title';
        var light = document.createElement('i');
        light.className = 'fa-solid fa-lightbulb';
        title.appendChild(light);
        title.appendChild(document.createTextNode(' 解析'));

        var content = document.createElement('div');
        content.className = 'analysis-content';
        renderMarkdownInto(content, q.explanation);

        box.appendChild(title);
        box.appendChild(content);
        card.appendChild(box);
      }

      if (q && q.knowledge) {
        var details = document.createElement('details');
        details.className = 'knowledge-details';

        var summary = document.createElement('summary');
        summary.className = 'knowledge-summary';
        var bookI = document.createElement('i');
        bookI.className = 'fa-solid fa-book-medical';
        summary.appendChild(bookI);

        var titleSpan = document.createElement('span');
        titleSpan.className = 'knowledge-summary-title';
        renderMarkdownInto(titleSpan, '知识点： ' + String(q.knowledgeTitle || '相关考点'), { inline: true });
        summary.appendChild(titleSpan);

        var kCont = document.createElement('div');
        kCont.className = 'knowledge-content';
        renderMarkdownInto(kCont, q.knowledge);

        details.appendChild(summary);
        details.appendChild(kCont);
        card.appendChild(details);
      }

      applyRandomHighlights(card);
      return card;
    }
