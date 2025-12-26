const { isNonEmptyString } = require('./helpers');

function mergeTailHead(prevTail, nextHead) {
  const tailFrag = prevTail && prevTail.kind === 'fragment' ? prevTail.fragment : null;
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

function finalizeBundlesToChapters({ jobId, bundles }) {
  const sorted = [...bundles].sort((a, b) => Number(a.pageIndex) - Number(b.pageIndex));
  const warnings = [];

  if (sorted.length > 0 && sorted[0].head) {
    warnings.push({ pageIndex: sorted[0].pageIndex, message: 'First page returned a head fragment; dropped.' });
  }

  const pageResults = sorted.map((b) => ({
    pageIndex: Number(b.pageIndex),
    title: isNonEmptyString(b.chapterTitleCandidate) ? b.chapterTitleCandidate.trim() : `AI导入 第${Number(b.pageIndex) + 1}页`,
    questions: Array.isArray(b.questions) ? [...b.questions] : [],
    tail: b.tail,
    head: b.head,
  }));

  // Apply tail/head stitching rules.
  for (let i = 0; i < pageResults.length; i++) {
    const cur = pageResults[i];
    const next = pageResults[i + 1] || null;

    const tail = cur.tail;
    const isAdjacent = !!(next && Number(next.pageIndex) === Number(cur.pageIndex) + 1);
    const nextHead = isAdjacent && next ? next.head : null;

    if (i === pageResults.length - 1) {
      if (tail && tail.kind === 'complete' && tail.question) {
        cur.questions.push(tail.question);
      } else if (tail && tail.kind === 'fragment') {
        warnings.push({ pageIndex: cur.pageIndex, message: 'Last page tail is fragment; dropped.' });
      }
      break;
    }

    if (!isAdjacent) {
      // There is a gap (failed/missing pages). Never stitch across it.
      if (tail && tail.kind === 'complete' && tail.question) {
        cur.questions.push(tail.question);
      } else if (tail && tail.kind === 'fragment') {
        warnings.push({ pageIndex: cur.pageIndex, message: 'Tail is fragment but next page is not adjacent; dropped.' });
      }
      if (next && next.head) {
        warnings.push({ pageIndex: next.pageIndex, message: 'Page has head fragment but previous page is missing; dropped.' });
        next.head = null;
      }
      continue;
    }

    if (nextHead) {
      if (tail && tail.kind === 'fragment') {
        const merged = mergeTailHead(tail, nextHead);
        cur.questions.push({
          sourceRef: { pageIndex: cur.pageIndex, localIndex: cur.questions.length },
          id: merged.id,
          text: merged.text || '',
          options: merged.options || [],
          answer: merged.answer || '',
          explanation: '',
          knowledgeTitle: '',
          knowledge: '',
          __fragmentMerge: merged.sourceRefs || [],
        });
      } else if (tail && tail.kind === 'complete' && tail.question) {
        cur.questions.push(tail.question);
        warnings.push({ pageIndex: next.pageIndex, message: 'Page head fragment ignored because previous tail was complete.' });
      } else if (tail && tail.kind === 'fragment') {
        warnings.push({ pageIndex: cur.pageIndex, message: 'Tail fragment present but could not merge with head; dropped.' });
      }

      next.head = null;
      continue;
    }

    if (tail && tail.kind === 'complete' && tail.question) {
      cur.questions.push(tail.question);
    } else if (tail && tail.kind === 'fragment') {
      warnings.push({ pageIndex: cur.pageIndex, message: 'Tail is fragment but next page head is empty; dropped.' });
    }
  }

  // Drop remaining head/tail from the output.
  for (const page of pageResults) {
    delete page.head;
    delete page.tail;
  }

  // Assign stable display IDs per chapter (1..n) and tag AI origin.
  for (const page of pageResults) {
    const qs = Array.isArray(page.questions) ? page.questions : [];
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      q.id = typeof q.id === 'string' || typeof q.id === 'number' ? q.id : i + 1;
      q.__ai = true;
      q.ai = q.ai || { jobId, pageIndex: page.pageIndex };
    }
  }

  return { pages: pageResults, warnings };
}

module.exports = { finalizeBundlesToChapters };

