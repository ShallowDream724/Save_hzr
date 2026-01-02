/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const { setupUndiciProxyFromEnv, getProxyUrlFromEnv } = require('../src/ai/outboundProxy');
const { getAiClient } = require('../src/ai/geminiCore');
const { getModelId } = require('../src/ai/geminiClient');

function parseDotEnv(text) {
  const out = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line || line.startsWith('#')) continue;
    const s = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = s.indexOf('=');
    if (eq <= 0) continue;
    const key = s.slice(0, eq).trim();
    let value = s.slice(eq + 1).trim();
    if (!key) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvFromRepoRoot(repoRoot) {
  const candidates = [path.join(repoRoot, '.env'), path.join(repoRoot, '.env.local')];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, 'utf8');
    const kv = parseDotEnv(raw);
    for (const k of Object.keys(kv)) process.env[k] = kv[k];
  }
}

function isGoogleGeminiBaseUrl() {
  const raw =
    process.env.GEMINI_NEXT_GEN_API_BASE_URL ||
    process.env.GEMINI_BASE_URL ||
    process.env.GEMINI_API_BASE_URL ||
    process.env.GOOGLE_GEMINI_BASE_URL;
  const s = String(raw || '').trim();
  if (!s) return true; // default is generativelanguage.googleapis.com
  try {
    const u = new URL(s);
    const host = String(u.host || '').toLowerCase();
    return host.endsWith('generativelanguage.googleapis.com') || host.endsWith('googleapis.com');
  } catch (_) {
    return false;
  }
}

function parseArgValue(argv, name) {
  const idx = argv.indexOf(name);
  if (idx >= 0 && idx + 1 < argv.length) return String(argv[idx + 1] || '').trim();
  const prefix = `${name}=`;
  const hit = argv.find((a) => String(a || '').startsWith(prefix));
  if (hit) return String(hit).slice(prefix.length).trim();
  return '';
}

function normalizeThinkingLevel(raw, fallback) {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'LOW' || s === 'MEDIUM' || s === 'HIGH') return s;
  return fallback;
}

function resolveModelId(argv) {
  const explicit = parseArgValue(argv, '--modelId') || parseArgValue(argv, '--model-id');
  if (explicit) return explicit;
  const model = (parseArgValue(argv, '--model') || 'pro').toLowerCase();
  if (model === 'flash') return getModelId('flash');
  return getModelId('pro');
}

async function main() {
  const argv = process.argv.slice(2);
  const repoRoot = path.resolve(__dirname, '..', '..');
  loadEnvFromRepoRoot(repoRoot);

  if (isGoogleGeminiBaseUrl() && getProxyUrlFromEnv()) {
    const proxyState = setupUndiciProxyFromEnv();
    if (!proxyState || !proxyState.enabled) throw new Error('proxy setup failed (AI_HTTP_PROXY)');
  }

  const ai = getAiClient();
  const modelId = resolveModelId(argv);
  const thinkingLevel = normalizeThinkingLevel(parseArgValue(argv, '--thinking'), 'HIGH');

  const config = { temperature: 0, topP: 0.95 };
  if (isGoogleGeminiBaseUrl()) config.thinkingConfig = { thinkingLevel };
  else config.httpOptions = { extraBody: { thinkingConfig: { thinkingLevel } } };

  const res = await ai.models.generateContent({
    model: modelId,
    contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
    config,
  });

  const candidate = res && res.candidates && res.candidates[0];
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : null;
  const text = parts && parts[0] && typeof parts[0].text === 'string' ? parts[0].text : (typeof res.text === 'string' ? res.text : '');

  console.log(`OK (${modelId}, thinking=${thinkingLevel}):`, String(text || '').trim().slice(0, 120));
}

main().catch((e) => {
  console.error('FAIL:', e && e.name ? String(e.name) : 'Error', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
