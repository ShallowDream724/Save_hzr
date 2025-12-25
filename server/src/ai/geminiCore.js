const { GoogleGenAI } = require('@google/genai');

function sanitizeApiKey(apiKey) {
  return String(apiKey || '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00A0]/g, ' ')
    .trim();
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
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

module.exports = { getAiClient, sanitizeApiKey };

