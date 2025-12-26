const fs = require('fs');
const { FunctionCallingConfigMode, MediaResolution, PartMediaResolutionLevel } = require('@google/genai');
const { getAiClient } = require('./geminiCore');
const { normalizeGeminiError } = require('./geminiErrors');

function getModelId(model) {
  if (model === 'pro') return 'gemini-3-pro-preview';
  if (model === 'flash') return 'gemini-3-flash-preview';
  throw new Error(`Unsupported model: ${model}`);
}

const extractPageBundleDeclaration = {
  name: 'extract_page_bundle',
  description:
    "Extract questions from a single page image. Return head (only if the first question is clearly a continuation), questions (complete only), and tail (always present, complete or fragment). Do NOT include head/tail inside 'questions'.",
  parametersJsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pageIndex: { type: 'number' },
      chapterTitleCandidate: { type: 'string' },
      head: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              sourceRef: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  pageIndex: { type: 'number' },
                  kind: { type: 'string', enum: ['head'] },
                },
                required: ['pageIndex', 'kind'],
              },
              id: { anyOf: [{ type: 'string' }, { type: 'number' }] },
              text: { type: 'string' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    label: { type: 'string' },
                    content: { type: 'string' },
                  },
                  required: ['label', 'content'],
                },
              },
              answer: { type: 'string' },
              continues: { type: 'string', enum: ['from_prev', 'to_next', 'none'] },
            },
            required: ['sourceRef'],
          },
        ],
      },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sourceRef: {
              type: 'object',
              additionalProperties: false,
              properties: {
                pageIndex: { type: 'number' },
                localIndex: { type: 'number' },
              },
              required: ['pageIndex', 'localIndex'],
            },
            id: { anyOf: [{ type: 'string' }, { type: 'number' }] },
            text: { type: 'string' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  label: { type: 'string' },
                  content: { type: 'string' },
                },
                required: ['label', 'content'],
              },
            },
            answer: { type: 'string' },
            explanation: { type: 'string' },
            knowledgeTitle: { type: 'string' },
            knowledge: { type: 'string' },
          },
          required: ['sourceRef', 'text', 'options', 'answer'],
        },
      },
      tail: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['complete', 'fragment'] },
          question: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sourceRef: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  pageIndex: { type: 'number' },
                  localIndex: { type: 'number' },
                },
                required: ['pageIndex', 'localIndex'],
              },
              id: { anyOf: [{ type: 'string' }, { type: 'number' }] },
              text: { type: 'string' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    label: { type: 'string' },
                    content: { type: 'string' },
                  },
                  required: ['label', 'content'],
                },
              },
              answer: { type: 'string' },
              explanation: { type: 'string' },
              knowledgeTitle: { type: 'string' },
              knowledge: { type: 'string' },
            },
            required: ['sourceRef', 'text', 'options', 'answer'],
          },
          fragment: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sourceRef: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  pageIndex: { type: 'number' },
                  kind: { type: 'string', enum: ['tail'] },
                },
                required: ['pageIndex', 'kind'],
              },
              id: { anyOf: [{ type: 'string' }, { type: 'number' }] },
              text: { type: 'string' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    label: { type: 'string' },
                    content: { type: 'string' },
                  },
                  required: ['label', 'content'],
                },
              },
              answer: { type: 'string' },
              continues: { type: 'string', enum: ['from_prev', 'to_next', 'none'] },
            },
            required: ['sourceRef'],
          },
          warnings: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind'],
      },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['pageIndex', 'questions', 'tail'],
  },
};

const finalizeImportJobDeclaration = {
  name: 'finalize_import_job',
  description:
    'Finalize book import from pre-merged page questions. Keep order stable. Optionally generate short explanations and knowledge points when possible; do not output any extra text.',
  parametersJsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pages: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            pageIndex: { type: 'number' },
            title: { type: 'string' },
            questions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { anyOf: [{ type: 'string' }, { type: 'number' }] },
                  text: { type: 'string' },
                  options: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        label: { type: 'string' },
                        content: { type: 'string' },
                      },
                      required: ['label', 'content'],
                    },
                  },
                  answer: { type: 'string' },
                  explanation: { type: 'string' },
                  knowledgeTitle: { type: 'string' },
                  knowledge: { type: 'string' },
                },
                required: ['text', 'options', 'answer'],
              },
            },
            warnings: { type: 'array', items: { type: 'string' } },
          },
          required: ['pageIndex', 'title', 'questions'],
        },
      },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['pages'],
  },
};

function buildExtractPrompt({ pageIndex, noteText }) {
  const note = noteText ? `\n\nUser note:\n${noteText}\n` : '';
  return `You are extracting multiple-choice questions from ONE page image.

Hard rules (MUST follow):
1) You MUST call the function "extract_page_bundle" exactly once. Do NOT output any other text.
2) The returned object MUST have pageIndex = ${pageIndex}.
2.1) ALWAYS include the "head" field. If not needed, set "head" = null (do NOT omit the field).
2.2) Respect the question numbers shown in the photo. If a question has a visible number (e.g. "12.", "(12)", "12、"), put that number into the question's "id" field exactly (prefer digits only). Do NOT invent ids; if unclear, leave id empty.
2.3) Provide a short "chapterTitleCandidate" in Chinese that summarizes the main topic of this page (max 18 chars). Prefer the chapter/section heading in the photo if present. Do NOT use generic placeholders like "AI导入", "第X页", "Page". If you truly cannot infer a topic, set it to an empty string.
3) "head" must be null unless the FIRST question on this page is CLEARLY a continuation from the previous page (e.g., starts from option C/D/E, or only leftover options without a new question stem). If the first question is complete, head MUST be null.
4) "tail" MUST ALWAYS be present:
   - If the LAST question is complete, set tail.kind="complete" and put the full question into tail.question.
   - If the LAST question continues to the next page, set tail.kind="fragment" and put the fragment into tail.fragment, with continues="to_next" if confident.
5) Do NOT include the head question or the tail question inside "questions".
6) "questions" must contain only COMPLETE questions that are fully readable on this page.
7) Do NOT invent. If unclear, keep fields empty where appropriate and add a warning string.
8) Output plain text (no HTML). Keep formatting minimal.
${note}`.trim();
}

function buildFinalizePrompt({ pages, noteText }) {
  const note = noteText ? `\n\nUser note:\n${noteText}\n` : '';
  const input = JSON.stringify({ pages });
  return `You are finalizing a book import from pre-extracted page questions.

Hard rules (MUST follow):
1) You MUST call the function "finalize_import_job" exactly once. Do NOT output any other text.
2) Keep the same pageIndex set as the input. Do NOT invent extra pages.
3) Keep question order stable within each page. Do NOT merge/split questions unless absolutely necessary for coherence.
3.1) Preserve question "id" (question number) if present. Do NOT renumber questions.
4) Do NOT invent content that is not supported by the extracted text/options/answer. If a question is unclear, keep explanation empty and add a warning.
5) If you can provide a SHORT explanation (2-5 sentences) and a SHORT knowledge point, you may fill "explanation"/"knowledgeTitle"/"knowledge". Otherwise leave them empty strings.
6) Replace each page "title" with a short, human-friendly chapter name in Chinese based on the page content (max 18 chars). Do NOT use generic placeholders like "AI导入", "第X页", "Page". If multiple pages share the same topic, you may add a subtle suffix like "（上）/（下）/（续）" to reduce confusion.

Input pages JSON:
${input}
${note}`.trim();
}

function isGemini3ModelId(modelId) {
  return String(modelId || '').includes('gemini-3');
}

function buildInlineImagePart(imagePath, mimeType, modelId) {
  const buf = fs.readFileSync(imagePath);
  const b64 = buf.toString('base64');
  const part = {
    inlineData: { mimeType, data: b64 },
  };

  // Gemini 3 supports per-part ultra-high resolution; older models use global mediaResolution config.
  if (isGemini3ModelId(modelId)) {
    part.mediaResolution = { level: PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH };
  }

  return part;
}

async function extractPageBundle({ model, pageIndex, noteText, imagePath, mimeType }) {
  const ai = getAiClient();
  const modelId = getModelId(model);
  const prompt = buildExtractPrompt({ pageIndex, noteText });
  const parts = [buildInlineImagePart(imagePath, mimeType, modelId), { text: prompt }];
  const isGemini3 = isGemini3ModelId(modelId);

  let response;
  try {
    response = await ai.models.generateContent({
      model: modelId,
      contents: [{ role: 'user', parts }],
      config: {
        ...(isGemini3 ? {} : { mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH }),
        thinkingConfig: { thinkingLevel: 'HIGH' },
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: ['extract_page_bundle'],
          },
        },
        tools: [{ functionDeclarations: [extractPageBundleDeclaration] }],
        temperature: 0.2,
        topP: 0.95,
      },
    });
  } catch (e) {
    throw normalizeGeminiError(e);
  }

  const calls = response.functionCalls || [];
  const call = calls[0];
  if (!call || call.name !== 'extract_page_bundle' || !call.args) {
    const e = new Error('Model did not return expected function call: extract_page_bundle');
    e.name = 'BadModelOutput';
    throw e;
  }

  return call.args;
}

module.exports = {
  extractPageBundle,
  finalizeImportJob: async function finalizeImportJob({ model, pages, noteText }) {
    const ai = getAiClient();
    const modelId = getModelId(model);
    const prompt = buildFinalizePrompt({ pages, noteText });

    let response;
    try {
      response = await ai.models.generateContent({
        model: modelId,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          thinkingConfig: { thinkingLevel: 'HIGH' },
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              allowedFunctionNames: ['finalize_import_job'],
            },
          },
          tools: [{ functionDeclarations: [finalizeImportJobDeclaration] }],
          temperature: 0.2,
          topP: 0.95,
        },
      });
    } catch (e) {
      throw normalizeGeminiError(e);
    }

    const calls = response.functionCalls || [];
    const call = calls[0];
    if (!call || call.name !== 'finalize_import_job' || !call.args) {
      const e = new Error('Model did not return expected function call: finalize_import_job');
      e.name = 'BadModelOutput';
      throw e;
    }
    return call.args;
  },
  getModelId,
};
