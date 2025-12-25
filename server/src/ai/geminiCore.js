const { GoogleGenAI } = require('@google/genai');

function sanitizeApiKey(apiKey) {
  return String(apiKey || '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00A0]/g, ' ')
    .trim();
}

function normalizeBaseURL(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    u.hash = '';
    u.search = '';
    // Allow users to paste full endpoints like ".../v1beta/models" by trimming to the API root.
    u.pathname = u.pathname
      .replace(/\/v1beta\/models\/?$/i, '')
      .replace(/\/v1beta\/?$/i, '')
      .replace(/\/v1\/models\/?$/i, '')
      .replace(/\/v1\/?$/i, '');
    const out = u.toString().replace(/\/+$/g, '');
    return out || null;
  } catch (_) {
    // If it's not a valid URL, pass through (SDK may still accept it).
    return s;
  }
}

function buildClientOptions({ apiKey }) {
  const opts = { apiKey };

  const baseURLRaw =
    process.env.GEMINI_NEXT_GEN_API_BASE_URL ||
    process.env.GEMINI_BASE_URL ||
    process.env.GEMINI_API_BASE_URL;
  const baseURL = normalizeBaseURL(baseURLRaw);
  if (baseURL) opts.baseURL = baseURL;

  const apiVersion = String(process.env.GEMINI_API_VERSION || '').trim();
  if (apiVersion) opts.apiVersion = apiVersion;

  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || process.env.AI_GEMINI_TIMEOUT_MS || 240_000);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) opts.timeout = Math.floor(timeoutMs);

  const maxRetries = Number(process.env.GEMINI_MAX_RETRIES);
  if (Number.isFinite(maxRetries) && maxRetries >= 0) opts.maxRetries = Math.floor(maxRetries);

  return opts;
}

let cachedClient = null;
function getAiClient() {
  const rawKey = process.env.GEMINI_API_KEY;
  if (!rawKey) {
    const e = new Error('GEMINI_API_KEY not set');
    e.name = 'ConfigError';
    throw e;
  }
  if (cachedClient) return cachedClient;
  const apiKey = sanitizeApiKey(rawKey);
  cachedClient = new GoogleGenAI(buildClientOptions({ apiKey }));
  return cachedClient;
}

module.exports = { getAiClient, sanitizeApiKey };
