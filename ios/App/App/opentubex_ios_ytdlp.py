"""In-process yt-dlp entry point for the iOS Capacitor bridge."""

import json
from pathlib import Path
import re

import yt_dlp


class _QuietLogger:
    def debug(self, _message):
        pass

    def warning(self, _message):
        pass

    def error(self, _message):
        pass


def _option(args, name, default=None):
    try:
        return args[args.index(name) + 1]
    except (ValueError, IndexError):
        return default


def _extract(request):
    args = request['args']
    url = args[-1]
    options = {
        'ignoreconfig': True,
        'noplaylist': '--flat-playlist' not in args,
        'extract_flat': '--flat-playlist' in args,
        'playlistend': int(_option(args, '--playlist-end', '0')) or None,
        'socket_timeout': int(_option(args, '--socket-timeout', '15')),
        'ignore_no_formats_error': '--ignore-no-formats-error' in args,
        'skip_download': True,
        'writesubtitles': '--write-subs' in args,
        'writeautomaticsub': '--write-auto-subs' in args,
        'subtitleslangs': [language.strip() for language in
                           _option(args, '--sub-langs', 'all').split(',') if language.strip()],
        'subtitlesformat': _option(args, '--sub-format', 'vtt'),
        'quiet': True,
        'no_warnings': True,
        'logger': _QuietLogger(),
    }
    if _option(args, '--format'):
        options['format'] = _option(args, '--format')
    if _option(args, '--extractor-args'):
        options['extractor_args'] = yt_dlp.parse_options([
            '--extractor-args', _option(args, '--extractor-args')
        ]).ydl_opts['extractor_args']
    if request.get('cookies'):
        options['cookiefile'] = request['cookies']
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.sanitize_info(ydl.extract_info(url, download=False))
    if info is None:
        raise ValueError('yt-dlp returned no media')
    if not options['extract_flat']:
        formats = info.get('formats') or []
        info['formats'] = [{key: value for key, value in entry.items()
                            if key in ('format_id', 'url', 'manifest_url', 'http_headers',
                                       'protocol', 'ext', 'container', 'vcodec', 'acodec',
                                       'width', 'height', 'fps', 'tbr', 'asr',
                                       'audio_channels', 'language', 'format_note',
                                       'dynamic_range', 'available_at', 'target_duration')}
                           for entry in formats if isinstance(entry, dict)]
        storyboard = next((entry for entry in formats
                           if entry.get('protocol') == 'mhtml'), None)
        if storyboard:
            info['storyboard'] = {key: storyboard.get(key) for key in (
                'protocol', 'width', 'height', 'fps', 'rows', 'columns',
                'fragments', 'http_headers')}
    return {'stdout': json.dumps(info, ensure_ascii=False), 'incomplete': False}


def _download(request):
    payload = request['payload']
    folder = Path(request['staging'])
    folder.mkdir(parents=True, exist_ok=True)
    progress_file = Path(request['progressFile'])
    control_file = Path(request['controlFile'])

    def report(progress):
        if control_file.exists():
            raise yt_dlp.utils.DownloadError('Download interrupted')
        total = progress.get('total_bytes') or progress.get('total_bytes_estimate') or 0
        value = progress.get('downloaded_bytes') or 0
        processing = progress.get('status') == 'finished'
        data = {'status': 'processing' if processing else 'downloading',
                'percent': 0 if processing or not total else min(100, value * 100 / total),
                'speed': None if processing else progress.get('speed'),
                'eta': None if processing else progress.get('eta')}
        progress_file.write_text(json.dumps(data), encoding='utf-8')

    mode = payload.get('mode', 'video')
    is_youtube_video = mode == 'video' and not payload.get('externalUrl')
    if mode == 'audio':
        selection = 'bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio'
    elif mode == 'subtitles':
        selection = 'best'
    elif is_youtube_video:
        # yt-dlp's comma selector saves both tracks without invoking ffmpeg.
        # AVFoundation combines them after the Python worker returns.
        selection = 'bestvideo[vcodec^=avc1][ext=mp4],bestaudio[ext=m4a]'
    else:
        selection = 'best[ext=mp4]/best'
    quality = payload.get('quality')
    if is_youtube_video and str(quality).isdigit():
        selection = (f'bestvideo[vcodec^=avc1][ext=mp4][height<={quality}],'
                     'bestaudio[ext=m4a]')
    elif mode == 'video' and str(quality).isdigit():
        selection = f'best[ext=mp4][height<={quality}]/best[height<={quality}]/' + selection
    options = {
        'ignoreconfig': True,
        'noplaylist': not payload.get('isPlaylist', False),
        'outtmpl': str(folder / '%(title).180B [%(id)s].f%(format_id)s.%(ext)s'
                       if is_youtube_video else folder / '%(title).180B [%(id)s].%(ext)s'),
        'format': selection,
        'continuedl': True,
        'overwrites': False,
        'quiet': True,
        'no_warnings': True,
        'logger': _QuietLogger(),
        'progress_hooks': [report],
        'skip_download': mode == 'subtitles',
        'writesubtitles': mode == 'subtitles',
        'writeautomaticsub': mode == 'subtitles',
        'subtitlesformat': 'vtt',
        'subtitleslangs': [language.strip() for language in
                           payload.get('subtitleLanguages', 'en').split(',') if language.strip()],
    }
    if request.get('cookies'):
        options['cookiefile'] = request['cookies']
    external = payload.get('externalUrl')
    if external:
        urls = [external]
    elif payload.get('playlistId'):
        urls = [f"https://www.youtube.com/playlist?list={payload['playlistId']}"]
    else:
        ids = payload.get('videoIds') or [payload['videoId']]
        urls = [f'https://www.youtube.com/watch?v={video_id}' for video_id in ids]
    with yt_dlp.YoutubeDL(options) as ydl:
        result = ydl.download(urls)
    if result != 0:
        raise ValueError('yt-dlp could not download this media')
    files = [path.name for path in folder.iterdir() if path.is_file()
             and path.name not in ('control', 'progress.json')
             and not path.name.endswith(('.part', '.ytdl'))]
    if is_youtube_video:
        pairs = {}
        for name in files:
            prefix, marker, suffix = name.rpartition('.f')
            if marker and suffix.rpartition('.')[0]:
                pairs.setdefault(prefix, {})[Path(name).suffix.lower()] = name
        if not pairs or any('.mp4' not in pair or '.m4a' not in pair
                            for pair in pairs.values()):
            raise ValueError('Compatible video and audio tracks are unavailable')
        return {'merges': [{'video': pair['.mp4'], 'audio': pair['.m4a'],
                            'output': prefix + '.mp4'}
                           for prefix, pair in pairs.items()]}
    return {'files': files}


def handle(request_path, result_path):
    try:
        request = json.loads(Path(request_path).read_text(encoding='utf-8'))
        operation = request['operation']
        if operation == 'extract':
            result = _extract(request)
        elif operation == 'download':
            result = _download(request)
        elif operation == 'version':
            result = {'version': yt_dlp.version.__version__}
        else:
            raise ValueError('Unsupported yt-dlp operation')
    except Exception as error:
        # Signed media URLs and cookie paths can appear in yt-dlp exceptions.
        message = re.sub(r'https?://\S+', '[media URL]', str(error))
        result = {'error': type(error).__name__ + ': ' + message[:300]}
    Path(result_path).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
