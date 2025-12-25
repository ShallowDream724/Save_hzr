function redactProxyUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.username) u.username = '***';
    if (u.password) u.password = '***';
    return u.toString();
  } catch (_) {
    return '[invalid proxy url]';
  }
}

function getProxyUrlFromEnv() {
  // Prefer explicit AI_*, then common proxy env vars.
  const direct =
    process.env.AI_HTTP_PROXY ||
    process.env.AI_HTTPS_PROXY ||
    process.env.AI_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    process.env.https_proxy ||
    process.env.http_proxy;
  if (!direct) return null;
  const s = String(direct || '').trim();
  return s ? s : null;
}

let proxyConfigured = false;
function setupUndiciProxyFromEnv() {
  if (proxyConfigured) return { enabled: Boolean(getProxyUrlFromEnv()) };
  proxyConfigured = true;

  const proxyUrl = getProxyUrlFromEnv();
  if (!proxyUrl) return { enabled: false };

  try {
    // Node.js fetch is powered by undici; setting the global dispatcher enables proxying.
    // This is essential for CN local-dev where Google domains may be unreachable without a proxy.
    // eslint-disable-next-line global-require
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    const agent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(agent);
    return { enabled: true, proxyUrl: redactProxyUrl(proxyUrl) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { enabled: false, error: msg };
  }
}

module.exports = { setupUndiciProxyFromEnv, getProxyUrlFromEnv };

