import assert from 'node:assert/strict'
import test from 'node:test'

import { isAllowedTranslationAudioUrl } from '../../src/main/voiceOverTranslationUrls.js'

test('allows trusted Yandex voice-over delivery hosts', () => {
  const trustedHosts = [
    'strm.yandex.net',
    'voice-over.strm.yandex.net',
    'strm.yandex.ru',
    'voice-over.strm.yandex.ru',
    'storage.yandexcloud.net'
  ]

  for (const host of trustedHosts) {
    assert.equal(isAllowedTranslationAudioUrl(new URL(`https://${host}/audio`)), true)
  }
})

test('rejects insecure and look-alike voice-over delivery hosts', () => {
  const untrustedUrls = [
    'http://voice-over.strm.yandex.ru/audio',
    'https://strm.yandex.ru.example.com/audio',
    'https://voice-over-strm.yandex.ru/audio',
    'https://storage.yandexcloud.net.example.com/audio'
  ]

  for (const url of untrustedUrls) {
    assert.equal(isAllowedTranslationAudioUrl(new URL(url)), false)
  }
})
