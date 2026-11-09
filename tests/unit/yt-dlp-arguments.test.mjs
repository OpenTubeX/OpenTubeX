import assert from 'node:assert/strict'
import test from 'node:test'
import { buildYtDlpDownloadArguments, isSafeDownloadFilenameTemplate, jsRuntimeArguments, playbackImpersonationArguments } from '../../src/ytDlpArguments.js'
import { EXTERNAL_PLAYBACK_INFO_OUTPUT_TEMPLATE, PLAYBACK_INFO_OUTPUT_TEMPLATE, mapExternalPlaybackMetadata, mapPlaybackCaptions, mapPlaybackFormat } from '../../src/ytDlpMetadata.js'

const videoId = 'jNQXAC9IVRw'

test('Chrome impersonation applies only to Rumble playback URLs', () => {
  for (const url of ['https://rumble.com/video', 'https://player.rumble.com/embed']) {
    assert.deepEqual(playbackImpersonationArguments(url), ['--impersonate', 'chrome'])
  }
  for (const url of ['https://notrumble.com/video', 'https://rumble.com.example/video', 'https://www.youtube.com/watch?v=jNQXAC9IVRw']) {
    assert.deepEqual(playbackImpersonationArguments(url), [])
  }
})

test('Electron runs as the JavaScript runtime only for yt-dlp builds that accept the option', () => {
  const runtime = ['--js-runtimes', 'node:/opt/OpenTubeX/opentubex']
  for (const version of ['2025.11.12', '2026.08.19', '2026.08.19.232912']) {
    assert.deepEqual(jsRuntimeArguments(version, '/opt/OpenTubeX/opentubex'), runtime)
  }
  for (const version of ['2025.11.11', '2025.10.22', 'unknown', null]) {
    assert.deepEqual(jsRuntimeArguments(version, '/opt/OpenTubeX/opentubex'), [])
  }
})

test('external media downloads use their web URL without treating it as a YouTube ID', () => {
  const externalUrl = 'https://vimeo.com/123456789'
  const args = buildYtDlpDownloadArguments({ externalUrl, mode: 'video' }).args
  assert.equal(args.at(-1), externalUrl)
  assert.ok(args.includes('--no-playlist'))
  assert.equal(buildYtDlpDownloadArguments({ externalUrl: 'HTTPS://VIMEO.COM/123456789', mode: 'video' }).args.at(-1), externalUrl)

  for (const invalidUrl of ['file:///tmp/video.mp4', 'https://user:pass@example.com/video', 'https://example.com/a b', 'https://example.com/'.padEnd(8200, 'a')]) {
    assert.throws(() => buildYtDlpDownloadArguments({ externalUrl: invalidUrl, mode: 'video' }), /invalid-media-url/)
  }
  assert.throws(() => buildYtDlpDownloadArguments({ externalUrl, videoId, mode: 'video' }), /invalid-media-url/)
  assert.throws(() => buildYtDlpDownloadArguments({ externalUrl, mode: 'video', automatic: true }), /invalid-media-url/)
  assert.throws(() => buildYtDlpDownloadArguments({ externalUrl, mode: 'video', isPlaylist: true }), /invalid-media-url/)
})

test('desktop and Android download options preserve format, subtitles, clipping, and metadata', () => {
  const { args, truncatesLongTitles } = buildYtDlpDownloadArguments({
    videoId,
    mode: 'video',
    quality: '1080',
    videoCodec: 'h264',
    videoFormat: 'mp4',
    includeSubtitles: true,
    embedSubtitles: true,
    subtitleLanguages: 'en,de',
    subtitleFormat: 'srt',
    embedThumbnail: true,
    embedMetadata: true,
    startTime: '0:10',
    endTime: '0:15'
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

test('local playlist titles cannot expand into home or environment paths', () => {
  for (const [title, folder] of [['$HOME', '_HOME'], ['${HOME}', '_{HOME}'], ['~root', '_root']]) {
    const args = buildYtDlpDownloadArguments({ videoIds: [videoId], mode: 'video', isPlaylist: true, title }).args
    assert.ok(args[args.indexOf('--output') + 1].startsWith(`${folder}/`), title)
  }
})

test('invalid IDs and custom executable overrides cannot reach either runtime', () => {
  assert.throws(() => buildYtDlpDownloadArguments({ videoId: 'bad', mode: 'audio' }), /invalid-video-id/)
  assert.throws(() => buildYtDlpDownloadArguments({ videoIds: Array(501).fill(videoId), mode: 'video' }), /too-many-videos/)
  for (const customArgs of ['--exec "touch /tmp/pwned"', '--ffmpeg-location=/tmp/ffmpeg', '--remote-components ejs:github',
    "--exec-befor 'touch /tmp/pwned'", '--use-postprocessor Exec:exec_cmd=id', '--netrc-cmd id', '--js-runtimes=node:/tmp/node']) {
    assert.throws(() => buildYtDlpDownloadArguments({ videoId, mode: 'custom', customArgs }), /unsupported-custom-argument/)
    assert.throws(() => buildYtDlpDownloadArguments({ videoId, mode: 'video' }, customArgs), /unsupported-custom-argument/)
  }
})

test('custom arguments cannot write files, load inputs or replace yt-dlp', () => {
  // `--print-to-file` can write a yt-dlp config whose `--exec` runs on the next download.
  for (const customArgs of ["--print-to-file '--exec id' ~/.config/yt-dlp/config", '--print-to-f=x y', '-o /tmp/x', '-o/tmp/x',
    '--output=/tmp/x', '--out /tmp/x', '-P /tmp', '-xP/tmp', '--paths=temp:/tmp', '-a urls.txt', '--batch-file urls.txt',
    '-ka urls.txt', '--load-info-json info.json', '--cookies ~/.config/yt-dlp/config', '--cache-dir /tmp',
    '--download-archive ~/.bashrc', '--output-na-placeholder ../..', '--ppa ffmpeg:-y', '--postprocessor-args=ffmpeg:-y',
    '-U', '-xU', '--update', '--update-to evil/yt-dlp@latest', '--write-pages', '--write-pa', '--load-pages', '--load-p',
    // `__finaldir` moves the finished file to any folder, and `all` includes allow-unsafe-ext.
    '--parse-metadata "post_process:/home/user/.config/autostart:(?P<__finaldir>.+)"', '--parse-m=title:%(filepath)s',
    '--replace-in-metadata __finaldir .* /tmp', '--metadata-from-title %(__finaldir)s', '--compat-options all',
    '--compat=allow-unsafe-ext', '--no-simulate --', '--trim-filenames 1', '--trim-file=1', '--trim 1']) {
    assert.throws(() => buildYtDlpDownloadArguments({ videoId, mode: 'custom', customArgs }), /unsupported-custom-argument/, customArgs)
    assert.throws(() => buildYtDlpDownloadArguments({ videoId, mode: 'video' }, customArgs), /unsupported-custom-argument/, customArgs)
  }
})

test('filename templates cannot leave the download folder', () => {
  // yt-dlp ignores --paths for absolute templates, expands ~ and environment
  // variables, and reads `TYPES:` as the files a template applies to.
  for (const filenameTemplate of ['/tmp/{title}', '\\\\server\\share\\{title}', 'C:\\Users\\{title}', 'c:{title}', '~/{title}',
    '../{title}', 'Music/../../{title}', 'Music\\..\\{title}', ' .. /{title}', '$HOME/{title}', '${HOME}/{title}',
    '%USERPROFILE%\\{title}', '%(uploader|..)s/{title}', 'thumbnail:/tmp/x', 'Subtitle,thumbnail:x', 'pl_infojson:../x',
    // An uploader named `C` would make a Windows drive, and an empty title would leave `..`.
    '{author}:/outside.{ext}', '..{title}/{id}.{ext}', '.{author}.{title}/{id}.{ext}']) {
    assert.throws(() => buildYtDlpDownloadArguments({ videoId, mode: 'video', filenameTemplate }), /invalid-filename-template/, filenameTemplate)
    assert.equal(isSafeDownloadFilenameTemplate(filenameTemplate), false, filenameTemplate)
  }
  for (const filenameTemplate of ['{playlist}/{playlist_index} - {title}.{ext}', 'Music/{author}...{title}', 'Chapter 1: {title}', '']) {
    const args = buildYtDlpDownloadArguments({ videoId, mode: 'video', filenameTemplate }).args
    assert.ok(!args[args.indexOf('--output') + 1].startsWith('/'), filenameTemplate)
  }
  // The literal playlist title can complete a type prefix or a drive letter.
  for (const title of ['thumbnail', 'C']) {
    assert.throws(() => buildYtDlpDownloadArguments({ videoId, mode: 'video', title, filenameTemplate: '{playlist}:/outside' }), /invalid-filename-template/, title)
  }
  // Only text fields that name a folder get the dot-only value check.
  assert.deepEqual(buildYtDlpDownloadArguments({ videoId, mode: 'video', filenameTemplate: '{author}/{title}.{ext}' }).directoryFields, ['uploader'])
  assert.deepEqual(buildYtDlpDownloadArguments({ videoId, mode: 'video' }).directoryFields, [])
})

test('custom arguments keep unrelated long and short options', () => {
  const customArgs = '--no-exec --cookies-from-browser firefox --print title --netrc -f bestaudio -fbestaudio -xk -S res:720 -t mp3 --no-update'
  const { args } = buildYtDlpDownloadArguments({ videoId, mode: 'custom', customArgs })
  for (const argument of ['--cookies-from-browser', '--print', '--netrc', '-fbestaudio', '-xk', '-t', '--no-update']) {
    assert.ok(args.includes(argument), argument)
  }
})

test('playback mapping retains alternate audio and live stream timing', () => {
  const format = mapPlaybackFormat({
    format_id: '140-2',
    url: 'https://example.test/audio',
    protocol: 'https',
    ext: 'm4a',
    acodec: 'mp4a.40.2',
    vcodec: 'none',
    language: 'de',
    tbr: 128.5,
    available_at: '123',
    fragments: [{}, {}]
  })
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
  assert.deepEqual(mapExternalPlaybackMetadata({
    duration: 30,
    chapters: [{ start_time: 5, title: 'Valid' }, { start_time: -1, title: 'Invalid' }]
  }).chapters, [{ startSeconds: 5, endSeconds: 30, title: 'Valid' }])
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
  const proxied = { en: { ext: 'vtt', url: 'capacitor://localhost/_opentubex_media/caption' } }
  assert.equal(mapPlaybackCaptions(proxied, null, true).captions[0].url, proxied.en.url)
  assert.equal(mapPlaybackCaptions(proxied).captions.length, 0)
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
