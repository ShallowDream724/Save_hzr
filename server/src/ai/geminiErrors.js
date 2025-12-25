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
        '如果你最终部署在日本服务器：请直接在服务器上配置 Key 并测试（不需要代理）。',
      ].join('\n')
    );
    e.name = 'NetworkError';
    return e;
  }

  return err;
}

module.exports = { normalizeGeminiError };

