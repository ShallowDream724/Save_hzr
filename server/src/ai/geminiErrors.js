function normalizeGeminiError(err) {
  const name = err && err.name ? String(err.name) : '';
  const msg = err instanceof Error ? err.message : String(err || '');

  // Node fetch/undici network failures (common in CN local-dev without proxy)
  const looksLikeFetchFailed = name === 'TypeError' && /fetch failed/i.test(msg);
  const looksLikeNetwork =
    looksLikeFetchFailed ||
    /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|CERT_|TLS/i.test(msg);

  if (looksLikeNetwork) {
    const e = new Error(
      [
        'Gemini 请求失败：当前后端无法访问 Google/Gemini（网络/代理问题）。',
        '如果你在中国大陆本机开发：请在 `.env` 设置 `AI_HTTP_PROXY`（或 `HTTPS_PROXY`），例如 Clash: `http://127.0.0.1:7890`。',
        '如果你有可用的 Gemini 反代/网关：可设置 `GEMINI_BASE_URL`（或 SDK 原生 `GEMINI_NEXT_GEN_API_BASE_URL`）指向你的网关根地址。',
        '若请求较慢（拍照/Pro 思考）：可把 `GEMINI_TIMEOUT_MS` 调大（默认 240000ms）。',
        '如果你最终部署在日本服务器：请直接在服务器上配置 Key 并测试（通常不需要代理）。',
      ].join('\n')
    );
    e.name = 'NetworkError';
    return e;
  }

  return err;
}

module.exports = { normalizeGeminiError };
