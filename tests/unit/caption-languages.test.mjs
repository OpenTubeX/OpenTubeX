import assert from 'node:assert/strict'
import test from 'node:test'
import { getCaptionTranslationSource, getPreferredCaption } from '../../src/captionLanguages.js'
import { mapPlaybackCaptions } from '../../src/ytDlpMetadata.js'

// YouTube lists an auto-generated track for every AI-dubbed audio track
const dubbedVideoTracks = ['bn', 'nl', 'en', 'fr', 'de'].map(language => ({
  vss_id: `a.${language}`,
  kind: 'asr',
  language_code: language,
  is_translatable: true
}))

test('caption translations use the track in the original audio language', () => {
  assert.equal(getCaptionTranslationSource(dubbedVideoTracks, 'en-US').language_code, 'en')

  const manualEnglish = { vss_id: '.en', language_code: 'en', is_translatable: true }
  assert.equal(getCaptionTranslationSource([...dubbedVideoTracks, manualEnglish], 'en-US'), manualEnglish)

  // Without dubs the original audio language is unknown
  assert.equal(getCaptionTranslationSource(dubbedVideoTracks, null).language_code, 'bn')
})

test('default captions skip transcripts of dubbed audio', () => {
  const captions = [
    { language: 'de', label: 'German (auto-generated)', isDubbed: true },
    { language: 'de', label: 'German (translated from English)', isAutotranslated: true },
    { language: 'en', label: 'English (auto-generated)' }
  ]

  assert.equal(getPreferredCaption(captions, 'de', true), captions[1])
  assert.equal(getPreferredCaption(captions, 'de', false), captions[2])

  // Without a match, the original language wins over the first track in sort order
  const withArabic = [{ language: 'ar', label: 'Arabic' }, ...captions.slice(0, 2), { ...captions[2], isOriginalLanguage: true }]
  assert.equal(getPreferredCaption(withArabic, 'de', false), withArabic[3])
})

test('yt-dlp captions flag dubbed transcripts and translate from the original language', () => {
  const timedText = (lang, tlang) =>
    `https://www.youtube.com/api/timedtext?v=aaaaaaaaaaa&kind=asr&lang=${lang}${tlang ? `&tlang=${tlang}` : ''}&fmt=vtt`
  const requested = {
    'bn-orig': { ext: 'vtt', url: timedText('bn'), name: 'Bangla (Original)' },
    'en-orig': { ext: 'vtt', url: timedText('en'), name: 'English (Original)' },
    'de-orig': { ext: 'vtt', url: timedText('de'), name: 'German (Original)' },
    de: { ext: 'vtt', url: timedText('bn', 'de'), name: 'German' }
  }

  const { captions, captionTranslations } = mapPlaybackCaptions(requested, null, false, 'en-US')
  assert.deepEqual(captions.map(caption => [caption.language, !!caption.isDubbed]), [['bn', true], ['en', false], ['de', true]])
  assert.deepEqual(captions.filter(caption => caption.isOriginalLanguage).map(caption => caption.language), ['en'])
  assert.equal(captionTranslations[0].originalLanguage, 'en')
  assert.equal(new URL(captionTranslations[0].url).searchParams.get('lang'), 'en')
  assert.equal(new URL(captionTranslations[0].url).searchParams.get('tlang'), 'de')

  // A mismatching language without a matching transcript is not evidence of dubs
  const single = mapPlaybackCaptions({ de: requested['de-orig'] }, null, false, 'en')
  assert.equal(single.captions[0].isDubbed, false)
})
