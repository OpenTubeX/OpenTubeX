import assert from 'node:assert/strict'
import test from 'node:test'
import { buildYtDlpDownloadArguments, playbackSubtitleArguments } from '../../src/ytDlpArguments.js'
import { EXTERNAL_PLAYBACK_INFO_OUTPUT_TEMPLATE, PLAYBACK_INFO_OUTPUT_TEMPLATE, mapExternalPlaybackMetadata, mapPlaybackCaptions, mapPlaybackFormat } from '../../src/ytDlpMetadata.js'

const videoId = 'jNQXAC9IVRw'

test('playback subtitle options include authored tracks for external media', () => {
  assert.deepEqual(playbackSubtitleArguments(true), ['--write-auto-subs', '--sub-langs', 'all', '--sub-format', 'vtt'])
  assert.deepEqual(playbackSubtitleArguments(false), ['--write-subs', '--write-auto-subs', '--sub-langs', 'all', '--sub-format', 'vtt/srt/ttml/dfxp'])
})

test('desktop and Android download options preserve format, subtitles, clipping, and metadata', () => {
  const { args, truncatesLongTitles } = buildYtDlpDownloadArguments({
    videoId, mode: 'video', quality: '1080', videoCodec: 'h264', videoFormat: 'mp4',
    includeSubtitles: true, embedSubtitles: true, subtitleLanguages: 'en,de', subtitleFormat: 'srt',
    embedThumbnail: true, embedMetadata: true, startTime: '0:10', endTime: '0:15'
  })
  assert.equal(truncatesLongTitles, true)
  for (const [option, value] of [['-S', 'res:1080,codec:h264'], ['--merge-output-format', 'mp4'],
    ['--remux-video', 'mp4'], ['--sub-langs', 'en,de'], ['--sub-format', 'srt/best'],
    ['--download-sections', '*0:10-0:15']]) {
    assert.equal(args[args.indexOf(option) + 1], value)
  }
  assert.ok(args.includes('--embed-subs'))
  assert.ok(args.includes('--embed-thumbnail'))
  assert.ok(args.includes('--embed-metadata'))
  assert.equal(args.at(-1), `https://www.youtube.com/watch?v=${videoId}`)
})

test('audio and subtitle-only downloads use the selected conversion formats', () => {
  const audio = buildYtDlpDownloadArguments({ videoId, mode: 'audio', audioFormat: 'opus' }).args
  assert.ok(audio.includes('--extract-audio'))
  assert.equal(audio[audio.indexOf('--audio-format') + 1], 'opus')
  const subtitles = buildYtDlpDownloadArguments({ videoId, mode: 'subtitles', subtitleFormat: 'vtt', embedMetadata: true }).args
  assert.ok(subtitles.includes('--skip-download'))
  assert.ok(subtitles.includes('--no-quiet'))
  assert.ok(!subtitles.includes('--embed-metadata'))
})

test('local playlists retain order and escape literal title placeholders', () => {
  const args = buildYtDlpDownloadArguments({ videoIds: [videoId, 'BaW_jenozKc'], mode: 'video', isPlaylist: true, title: '100% / Music' }).args
  assert.deepEqual(args.slice(-2), [`https://www.youtube.com/watch?v=${videoId}`, 'https://www.youtube.com/watch?v=BaW_jenozKc'])
  assert.match(args[args.indexOf('--output') + 1], /^100%% _ Music\/.*autonumber/)
})

test('invalid IDs and custom executable overrides cannot reach either runtime', () => {
  assert.throws(() => buildYtDlpDownloadArguments({ videoId: 'bad', mode: 'audio' }), /invalid-video-id/)
  assert.throws(() => buildYtDlpDownloadArguments({ videoIds: Array(501).fill(videoId), mode: 'video' }), /too-many-videos/)
  for (const customArgs of ['--exec "touch /tmp/pwned"', '--ffmpeg-location=/tmp/ffmpeg', '--remote-components ejs:github']) {
    assert.throws(() => buildYtDlpDownloadArguments({ videoId, mode: 'custom', customArgs }), /unsupported-custom-argument/)
    assert.throws(() => buildYtDlpDownloadArguments({ videoId, mode: 'video' }, customArgs), /unsupported-custom-argument/)
  }
})

test('playback mapping retains alternate audio and live stream timing', () => {
  const format = mapPlaybackFormat({ format_id: '140-2', url: 'https://example.test/audio', protocol: 'https', ext: 'm4a',
    acodec: 'mp4a.40.2', vcodec: 'none', language: 'de', tbr: 128.5, available_at: '123', fragments: [{}, {}] })
  assert.equal(format.language, 'de')
  assert.equal(format.bitrate, 128500)
  assert.equal(format.availableAt, 123)
  assert.equal(format.fragmentCount, 2)
  assert.equal(format.height, null)
})

test('caption mapping separates translated tracks and rejects non-HTTPS URLs', () => {
  const result = mapPlaybackCaptions({
    en: { ext: 'vtt', url: 'https://www.youtube.com/api/timedtext?lang=en', name: 'English' },
    de: { ext: 'vtt', url: 'https://www.youtube.com/api/timedtext?lang=en&tlang=de', name: 'German' },
    fr: { ext: 'vtt', url: 'file:///private/cookies.txt' }
  })
  assert.equal(result.captions.length, 1)
  assert.equal(result.captionTranslations.length, 1)
  assert.equal(result.captionTranslations[0].language, 'de')
})

test('external metadata keeps optional counts, context, and chapter boundaries', () => {
  assert.match(EXTERNAL_PLAYBACK_INFO_OUTPUT_TEMPLATE, /"chapters"/)
  assert.match(EXTERNAL_PLAYBACK_INFO_OUTPUT_TEMPLATE, /"subtitles"/)
  assert.doesNotMatch(PLAYBACK_INFO_OUTPUT_TEMPLATE, /"chapters"/)
  assert.doesNotMatch(PLAYBACK_INFO_OUTPUT_TEMPLATE, /"subtitles"/)
  const result = mapExternalPlaybackMetadata({
    duration: 30,
    like_count: 0,
    concurrent_view_count: 123,
    artists: ['Artist A', '', null, 'Artist B'],
    tags: ['topic'],
    chapters: [
      { start_time: 0, title: 'Intro' },
      { start_time: 10, end_time: 20, title: 'Part one' },
      { start_time: -1, end_time: 5, title: 'Invalid' },
      { start_time: 20, title: 'Outro' }
    ]
  })
  assert.equal(result.likeCount, 0)
  assert.equal(result.concurrentViewCount, 123)
  assert.deepEqual(result.artists, ['Artist A', 'Artist B'])
  assert.deepEqual(result.tags, ['topic'])
  assert.deepEqual(result.chapters, [
    { startSeconds: 0, endSeconds: 10, title: 'Intro' },
    { startSeconds: 10, endSeconds: 20, title: 'Part one' },
    { startSeconds: 20, endSeconds: 30, title: 'Outro' }
  ])
  assert.deepEqual(mapExternalPlaybackMetadata({
    chapters: [{ start_time: 5, title: 'Only chapter' }]
  }).chapters, [{ startSeconds: 5, endSeconds: null, title: 'Only chapter' }])
})

test('caption mapping distinguishes authored and automatic tracks', () => {
  const requested = {
    en: { ext: 'vtt', url: 'https://example.test/en.vtt' },
    de: { ext: 'srt', url: 'https://example.test/de.srt' },
    fr: { ext: 'vtt', url: 'https://example.test/fr.vtt' }
  }
  const { captions } = mapPlaybackCaptions(requested, {
    en: [{ ext: 'vtt', url: 'https://example.test/en.vtt' }],
    de: [{ ext: 'srt', url: 'https://example.test/de.srt' }]
  })
  assert.equal(captions.find(caption => caption.language === 'en').isAutoGenerated, false)
  assert.equal(captions.find(caption => caption.language === 'de').isAutoGenerated, false)
  assert.equal(captions.find(caption => caption.language === 'de').mimeType, 'text/srt')
  assert.equal(captions.find(caption => caption.language === 'fr').isAutoGenerated, true)
  const http = { en: { ext: 'vtt', url: 'http://example.test/en.vtt' } }
  assert.equal(mapPlaybackCaptions(http).captions.length, 0)
  assert.equal(mapPlaybackCaptions(http, null, true).captions.length, 1)
})

test('caption mapping rejects inherited MIME lookup keys', () => {
  const captions = mapPlaybackCaptions({
    en: { ext: 'constructor', url: 'https://example.test/caption' },
    fr: { ext: 'toString', url: 'https://example.test/caption' }
  })
  assert.deepEqual(captions, { captions: [], captionTranslations: [] })
})

test('download phase hooks keep real downloads enabled and override custom progress templates', () => {
  const { args } = buildYtDlpDownloadArguments({
    videoId, mode: 'video', customArgs: '--progress-template "download:custom"'
  })
  assert.ok(args.includes('--no-simulate'))
  assert.ok(args.includes('video:__OPENTUBEX_PREPARING__:%(id)s'))
  const templates = args.flatMap((arg, index) => arg === '--progress-template' ? [args[index + 1]] : [])
  assert.match(templates.at(-2), /^download:__OPENTUBEX_DOWNLOAD__:%\(progress.status\)s/)
  assert.equal(templates.at(-1), 'postprocess:__OPENTUBEX_PROCESSING__')
})
