const fs = require('fs');
const path = require('path');

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(String(raw || ''));
  } catch (_) {
    return fallback;
  }
}

function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim().length > 0;
}

function computeRetryDelayMs(attempt, isRateLimited) {
  // attempt is 1..3; next attempt will be attempt+1
  const base = isRateLimited ? 30_000 : 10_000;
  const factor = Math.pow(2, Math.max(0, Number(attempt) - 1)); // 1->1x, 2->2x
  const jitter = Math.floor(Math.random() * 1500);
  const max = isRateLimited ? 8 * 60_000 : 3 * 60_000;
  const delay = base * factor + jitter;
  return Math.min(max, Math.max(5_000, delay));
}

function getImportConfig() {
  const proRpm = Number(process.env.AI_IMPORT_PRO_RPM || 10);
  const flashRpm = Number(process.env.AI_IMPORT_FLASH_RPM || 20);
  const minStartIntervalMs = Number(process.env.AI_IMPORT_MIN_START_INTERVAL_MS || 1000);

  return {
    tickMs: Number(process.env.AI_IMPORT_TICK_MS || 250),
    minStartIntervalMs,
    models: {
      pro: {
        rpm: proRpm,
        maxInFlight: Number(process.env.AI_IMPORT_PRO_MAX_IN_FLIGHT || proRpm),
      },
      flash: {
        rpm: flashRpm,
        maxInFlight: Number(process.env.AI_IMPORT_FLASH_MAX_IN_FLIGHT || flashRpm),
      },
    },
  };
}

function ensureUploadDir(rootDir) {
  try {
    fs.mkdirSync(rootDir, { recursive: true });
  } catch (_) {}
}

function buildUploadsRoot() {
  const base = process.env.AI_UPLOADS_DIR
    ? path.resolve(process.env.AI_UPLOADS_DIR)
    : path.resolve(__dirname, '..', '..', '..', '..', 'data', 'ai_uploads');
  ensureUploadDir(base);
  return base;
}

module.exports = {
  safeJsonParse,
  isNonEmptyString,
  computeRetryDelayMs,
  getImportConfig,
  buildUploadsRoot,
};

