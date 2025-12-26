const { isNonEmptyString } = require('./helpers');

function unwrapTail(tail) {
  if (!tail || typeof tail !== 'object') return null;

  // New format: tail is the question/fragment object itself.
  if (tail.sourceRef && typeof tail.sourceRef === 'object' && tail.sourceRef.kind === 'tail') return tail;

  // Backward compatibility: old format used tail.kind + {question|fragment}.
  if (tail.kind === 'complete' && tail.question && typeof tail.question === 'object') return tail.question;
  if (tail.kind === 'fragment' && tail.fragment && typeof tail.fragment === 'object') return tail.fragment;

  return tail;
}

function mergeTailHead(prevTail, nextHead) {
  const tailFrag = unwrapTail(prevTail);
  const headFrag = nextHead && typeof nextHead === 'object' ? nextHead : null;
  const merged = {
    sourceRefs: [],
    id: null,
    text: '',
    options: [],
    answer: '',
  };

  if (tailFrag) {
    merged.sourceRefs.push(tailFrag.sourceRef || { pageIndex: null, kind: 'tail' });
    if (typeof tailFrag.id === 'string' || typeof tailFrag.id === 'number') merged.id = tailFrag.id;
    if (typeof tailFrag.text === 'string') merged.text += tailFrag.text.trim();
    if (Array.isArray(tailFrag.options)) merged.options.push(...tailFrag.options);
    if (typeof tailFrag.answer === 'string') merged.answer = tailFrag.answer;
  }

  if (headFrag) {
    merged.sourceRefs.push(headFrag.sourceRef || { pageIndex: null, kind: 'head' });
    if ((merged.id === null || merged.id === undefined) && (typeof headFrag.id === 'string' || typeof headFrag.id === 'number')) merged.id = headFrag.id;
    if (typeof headFrag.text === 'string') {
      const t = headFrag.text.trim();
      if (t) merged.text = merged.text ? `${merged.text}\n${t}` : t;
    }
    if (Array.isArray(headFrag.options)) merged.options.push(...headFrag.options);
    if (typeof headFrag.answer === 'string' && !merged.answer) merged.answer = headFrag.answer;
  }

  // de-dupe options by label (keep first)
  const seen = new Set();
  const opts = [];
  for (const opt of merged.options) {
    const label = opt && typeof opt.label === 'string' ? opt.label.trim() : '';
    if (!label || seen.has(label)) continue;
    seen.add(label);
    opts.push({ label, content: typeof opt.content === 'string' ? opt.content : '' });
  }
  merged.options = opts;

  return merged;
}

function pickFirstQuestionText(bundle) {
  if (!bundle || typeof bundle !== 'object') return '';

  const qs = Array.isArray(bundle.questions) ? bundle.questions : [];
  for (const q of qs) {
    const t = q && typeof q.text === 'string' ? q.text.trim() : '';
    if (t) return t;
  }

  const tail = unwrapTail(bundle.tail);
  if (tail && typeof tail.text === 'string') {
    const t = tail.text.trim();
    if (t) return t;
  }

  const head = bundle.head;
  if (head && typeof head.text === 'string') {
    const t = head.text.trim();
    if (t) return t;
  }

  return '';
}

function fallbackTitleFromContent(bundle) {
  const raw = pickFirstQuestionText(bundle);
  if (!raw) return '';
  let t = String(raw).replace(/\s+/g, ' ').trim();
  // Remove leading question number: "(12) 12. 12、" etc.
  t = t.replace(/^[（(]?\s*\d+\s*[）)]?\s*[.、:：]?\s*/u, '');
  t = t.replace(/^[Qq]\s*\d+\s*[.、:：]?\s*/u, '');
  t = t.trim();
  if (!t) return '';
  // Truncate to a readable title length.
  const max = 18;
  if (t.length > max) t = t.slice(0, max).trim() + '…';
  // Avoid very generic prefixes becoming the whole title.
  if (t === '下列' || t === '关于' || t === '以下' || t === '哪项') return '';
  return t;
}

function finalizeBundlesToChapters({ jobId, bundles }) {
  const sorted = [...bundles].sort((a, b) => Number(a.pageIndex) - Number(b.pageIndex));
  const warnings = [];

  const pageResults = sorted.map((b) => {
    const pageIndex = Number(b.pageIndex);
    const candidate = isNonEmptyString(b.chapterTitleCandidate) ? b.chapterTitleCandidate.trim() : '';
    const fromText = candidate ? '' : fallbackTitleFromContent(b);
    const title = candidate || fromText || `导入章节（${Number(pageIndex) + 1}）`;
    return {
      pageIndex,
      title,
      questions: Array.isArray(b.questions) ? [...b.questions] : [],
      tail: b.tail,
      head: b.head,
    };
  });

  function normalizeOptions(options) {
    if (!Array.isArray(options)) return [];
    const out = [];
    for (const opt of options) {
      const label = opt && typeof opt.label === 'string' ? opt.label.trim() : '';
      if (!label) continue;
      out.push({ label, content: typeof opt.content === 'string' ? opt.content : '' });
    }
    return out;
  }

  function fragmentToQuestion(fragment, pageIndex, localIndex, sourceRefs) {
    if (!fragment || typeof fragment !== 'object') return null;

    const id = typeof fragment.id === 'string' || typeof fragment.id === 'number' ? fragment.id : null;
    const text = typeof fragment.text === 'string' ? fragment.text.trim() : '';
    const options = normalizeOptions(fragment.options);
    const answer = typeof fragment.answer === 'string' ? fragment.answer : '';

    if (!text && !options.length && !answer) return null;

    const q = {
      sourceRef: { pageIndex, localIndex },
      id,
      text: text || '',
      options,
      answer: answer || '',
      explanation: '',
      knowledgeTitle: '',
      knowledge: '',
    };
    if (Array.isArray(sourceRefs) && sourceRefs.length) q.__fragmentMerge = sourceRefs;
    return q;
  }

  // Hard rule: first page head is always dropped (it cannot be stitched).
  if (pageResults.length > 0 && pageResults[0].head) {
    warnings.push({ pageIndex: pageResults[0].pageIndex, message: 'First page head dropped.' });
    pageResults[0].head = null;
  }

  // Apply deterministic tail/head stitching rules.
  for (let i = 0; i < pageResults.length; i++) {
    const cur = pageResults[i];
    const next = pageResults[i + 1] || null;

    const tail = cur ? unwrapTail(cur.tail) : null;
    const isLastPage = i === pageResults.length - 1;
    const isSinglePage = pageResults.length === 1;

    const isAdjacent = !!(next && Number(next.pageIndex) === Number(cur.pageIndex) + 1);
    const nextHead = isAdjacent && next && next.head ? next.head : null;

    if (isLastPage) {
      if (isSinglePage) {
        const q = fragmentToQuestion(tail, cur.pageIndex, cur.questions.length, null);
        if (q) cur.questions.push(q);
      } else if (tail) {
        warnings.push({ pageIndex: cur.pageIndex, message: 'Last page tail dropped.' });
      }
      break;
    }

    if (!tail) {
      warnings.push({ pageIndex: cur.pageIndex, message: 'Missing tail; cannot stitch.' });
      if (next && next.head) {
        warnings.push({ pageIndex: next.pageIndex, message: 'Page head dropped because previous tail is missing.' });
        next.head = null;
      }
      continue;
    }

    if (!isAdjacent) {
      // There is a gap (failed/missing pages). Never stitch across it.
      const q = fragmentToQuestion(tail, cur.pageIndex, cur.questions.length, null);
      if (q) cur.questions.push(q);
      else warnings.push({ pageIndex: cur.pageIndex, message: 'Tail is empty; dropped.' });

      if (next && next.head) {
        warnings.push({ pageIndex: next.pageIndex, message: 'Page head dropped because previous page is missing.' });
        next.head = null;
      }
      continue;
    }

    if (nextHead) {
      const merged = mergeTailHead(tail, nextHead);
      const q = fragmentToQuestion(merged, cur.pageIndex, cur.questions.length, merged.sourceRefs || null);
      if (q) cur.questions.push(q);
      else warnings.push({ pageIndex: cur.pageIndex, message: 'Merged tail/head is empty; dropped.' });

      next.head = null;
      continue;
    }

    // No next head => treat tail as a complete question and attach to the current page.
    const q = fragmentToQuestion(tail, cur.pageIndex, cur.questions.length, null);
    if (q) cur.questions.push(q);
    else warnings.push({ pageIndex: cur.pageIndex, message: 'Tail is empty; dropped.' });
  }

  // Drop remaining head/tail from the output.
  for (const page of pageResults) {
    delete page.head;
    delete page.tail;
  }

  // Tag AI origin and assign stable internal question IDs (qid).
  for (const page of pageResults) {
    const qs = Array.isArray(page.questions) ? page.questions : [];
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      q.__ai = true;
      const localIndex = q && q.sourceRef && Number.isFinite(Number(q.sourceRef.localIndex)) ? Number(q.sourceRef.localIndex) : i;
      q.ai = q.ai || { jobId, pageIndex: page.pageIndex, localIndex };
      if (!q.qid || (typeof q.qid === 'string' && !q.qid.trim())) {
        q.qid = `aiq_${String(jobId)}_${String(page.pageIndex)}_${String(localIndex)}`;
      }
    }
  }

  return { pages: pageResults, warnings };
}

module.exports = { finalizeBundlesToChapters };
