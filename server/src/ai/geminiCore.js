const { GoogleGenAI } = require('@google/genai');

function sanitizeApiKey(apiKey) {
  return String(apiKey || '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00A0]/g, ' ')
    .trim();
}

function detectAuthMode(rawKey) {
  const s = sanitizeApiKey(rawKey);
  const lower = s.toLowerCase();
  if (lower.startsWith('bearer ')) return { mode: 'bearer', token: s.slice(7).trim() };
  return { mode: 'apiKey', key: s };
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
  const auth = detectAuthMode(apiKey);
  const keyForSdk = auth.mode === 'apiKey' ? auth.key : auth.token;
  if (!keyForSdk) {
    const e = new Error('GEMINI_API_KEY is empty');
    e.name = 'ConfigError';
    throw e;
  }

  /** @type {import('@google/genai').GoogleGenAIOptions} */
  const opts = { apiKey: keyForSdk };

  /** @type {import('@google/genai').HttpOptions} */
  const httpOptions = {};
  if (auth.mode === 'bearer' && auth.token) {
    httpOptions.headers = { Authorization: `Bearer ${auth.token}` };
  }

  const baseURLRaw =
    process.env.GEMINI_NEXT_GEN_API_BASE_URL ||
    process.env.GEMINI_BASE_URL ||
    process.env.GEMINI_API_BASE_URL ||
    process.env.GOOGLE_GEMINI_BASE_URL;
  const baseURL = normalizeBaseURL(baseURLRaw);
  if (baseURL) httpOptions.baseUrl = baseURL;

  const apiVersion = String(process.env.GEMINI_API_VERSION || '').trim();
  if (apiVersion) {
    opts.apiVersion = apiVersion;
    httpOptions.apiVersion = apiVersion;
  }

  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || process.env.AI_GEMINI_TIMEOUT_MS || 240_000);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) httpOptions.timeout = Math.floor(timeoutMs);

  if (httpOptions.baseUrl || httpOptions.headers || httpOptions.timeout || httpOptions.apiVersion) {
    opts.httpOptions = httpOptions;
  }

  return opts;
}

let cachedClient = null;
function getAiClient() {
  const rawKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!rawKey) {
    const e = new Error('GEMINI_API_KEY not set');
    e.name = 'ConfigError';
    throw e;
  }
  if (cachedClient) return cachedClient;
  cachedClient = new GoogleGenAI(buildClientOptions({ apiKey: rawKey }));
  return cachedClient;
}

module.exports = { getAiClient, sanitizeApiKey };
