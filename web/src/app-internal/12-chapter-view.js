    /** ---------------------------
     * 8) 章节加载与题卡（保持你原逻辑）
     * --------------------------- */
    function loadChapter(id) {
      if (homeVisible) hideHomeView();
      currentChapterId = id;
      var chapter = findChapterById(id);
      if (!chapter || isDeleted(id)) return;
  
      if (typeof setTopBarTitle === 'function') setTopBarTitle(chapter.title);
      else if (els.chapterTitle) els.chapterTitle.innerText = chapter.title;
  
      renderSidebar();
  
      if (els.questionsContainer) {
        els.questionsContainer.innerHTML = '';
        for (var i = 0; i < (chapter.questions || []).length; i++) {
          els.questionsContainer.appendChild(createQuestionCard(chapter.questions[i]));
        }
      }
  
      window.scrollTo(0, 0);
      if (window.innerWidth <= 768 && els.sidebar) els.sidebar.classList.remove('active');
      if (typeof persistViewState === 'function') persistViewState();
    }
  
    function createQuestionCard(q) {
      var card = document.createElement('div');
      card.className = 'question-card';
      var qid = (q && q.qid !== undefined && q.qid !== null) ? String(q.qid)
        : (q && q.id !== undefined && q.id !== null) ? String(q.id)
        : '';
      if (qid) card.dataset.hzrSeed = 'q:' + qid;
      if (qid) card.dataset.qid = qid;

      var header = document.createElement('div');
      header.className = 'q-header';

      var idEl = document.createElement('span');
      idEl.className = 'q-id';
      idEl.textContent = (q && q.id !== undefined && q.id !== null) ? String(q.id) : '';

      var textEl = document.createElement('div');
      textEl.className = 'q-text';
      renderMarkdownInto(textEl, q && q.text);

      var aiBtn = document.createElement('button');
      aiBtn.className = 'ai-ask-btn';
      aiBtn.type = 'button';
      aiBtn.title = '问 AI';
      aiBtn.textContent = '问AI';

      header.appendChild(idEl);
      header.appendChild(textEl);
      header.appendChild(aiBtn);
      card.appendChild(header);

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
