const { isNonEmptyString } = require('./helpers');

function validateBundle(bundle, expectedPageIndex) {
  if (!bundle || typeof bundle !== 'object') return 'bundle must be object';
  if (Number(bundle.pageIndex) !== Number(expectedPageIndex)) return 'pageIndex mismatch';

  // Models sometimes omit optional fields; normalize for robust downstream logic.
  if (bundle.head === undefined) bundle.head = null;
  if (bundle.chapterTitleCandidate === undefined) bundle.chapterTitleCandidate = '';
  if (bundle.warnings === undefined) bundle.warnings = [];

  if (!Array.isArray(bundle.questions)) return 'questions must be array';
  if (!bundle.tail || typeof bundle.tail !== 'object') return 'tail must be object';
  if (bundle.head !== null && typeof bundle.head !== 'object') return 'head must be null or object';
  if (!bundle.tail.sourceRef || typeof bundle.tail.sourceRef !== 'object') return 'tail.sourceRef required';
  if (Number(bundle.tail.sourceRef.pageIndex) !== Number(expectedPageIndex)) return 'tail.sourceRef.pageIndex mismatch';
  if (bundle.tail.sourceRef.kind !== 'tail') return 'tail.sourceRef.kind invalid';
  if (bundle.head !== null) {
    if (!bundle.head.sourceRef || typeof bundle.head.sourceRef !== 'object') return 'head.sourceRef required';
    if (Number(bundle.head.sourceRef.pageIndex) !== Number(expectedPageIndex)) return 'head.sourceRef.pageIndex mismatch';
    if (bundle.head.sourceRef.kind !== 'head') return 'head.sourceRef.kind invalid';
  }
  return null;
}

function validateFinalizeOutput(out) {
  if (!out || typeof out !== 'object') return 'output must be object';
  if (!Array.isArray(out.pages)) return 'pages must be array';
  for (const p of out.pages) {
    if (!p || typeof p !== 'object') return 'page must be object';
    if (!Number.isFinite(Number(p.pageIndex))) return 'page.pageIndex invalid';
    if (!isNonEmptyString(p.title)) return 'page.title required';
    if (!Array.isArray(p.questions)) return 'page.questions must be array';
    for (const q of p.questions) {
      if (!q || typeof q !== 'object') return 'question must be object';
      if (q.id !== undefined && q.id !== null && typeof q.id !== 'string' && typeof q.id !== 'number') return 'question.id must be string|number';
      if (typeof q.text !== 'string') return 'question.text must be string';
      if (!Array.isArray(q.options)) return 'question.options must be array';
      for (const o of q.options) {
        if (!o || typeof o !== 'object') return 'option must be object';
        if (typeof o.label !== 'string' || typeof o.content !== 'string') return 'option.label/content must be string';
      }
      if (typeof q.answer !== 'string') return 'question.answer must be string';
      if (q.explanation !== undefined && typeof q.explanation !== 'string') return 'question.explanation must be string';
      if (q.knowledgeTitle !== undefined && typeof q.knowledgeTitle !== 'string') return 'question.knowledgeTitle must be string';
      if (q.knowledge !== undefined && typeof q.knowledge !== 'string') return 'question.knowledge must be string';
    }
  }
  if (out.warnings !== undefined && !Array.isArray(out.warnings)) return 'warnings must be array';
  return null;
}

module.exports = { validateBundle, validateFinalizeOutput };
