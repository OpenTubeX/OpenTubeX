const TRANSLATION_AUDIO_HOST_PATTERNS = [
  /(^|\.)strm\.yandex\.net$/,
  /(^|\.)strm\.yandex\.ru$/,
  /^storage\.yandexcloud\.net$/,
]

export function isAllowedTranslationAudioUrl(url) {
  return url.protocol === 'https:' &&
    TRANSLATION_AUDIO_HOST_PATTERNS.some(pattern => pattern.test(url.hostname))
}
