const PROXY_TEST_BASE_URL = 'https://ipwho.is/?output=json&fields=ip,country,city,region'
const PROXY_TEST_SUPPORTED_LANGS = ['en', 'ru', 'de', 'es', 'pt-BR', 'fr', 'zh-CN', 'ja']

/** @param {string} locale */
export function getProxyTestUrl(locale) {
  const language = PROXY_TEST_SUPPORTED_LANGS.find(candidate => locale === candidate) ??
    PROXY_TEST_SUPPORTED_LANGS.find(candidate => locale.slice(0, 2) === candidate.slice(0, 2))
  return language === undefined ? PROXY_TEST_BASE_URL : `${PROXY_TEST_BASE_URL}&lang=${language}`
}
