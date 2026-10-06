"""In-process yt-dlp entry point for the iOS Capacitor bridge."""

import json
from pathlib import Path
import re
import subprocess

from opentubex_ios_ffmpeg import set_control_file

import yt_dlp
from yt_dlp.postprocessor.common import PostProcessor


class _QuietLogger:
    def __init__(self):
        self.last_error = ''

    def debug(self, _message):
        pass

    def warning(self, _message):
        pass

    def error(self, message):
        self.last_error = message


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
    folder = Path(request['staging'])
    folder.mkdir(parents=True, exist_ok=True)
    progress_file = Path(request['progressFile'])
    control_file = Path(request['controlFile'])
    saved_files = set()

    def collect(info):
        paths = [info.get('filepath')]
        paths.extend(download.get('filepath') for download in info.get('requested_downloads') or [])
        paths.extend(target or source for source, target in info.get('__files_to_move', {}).items())
        paths.extend(chapter.get('filepath') for chapter in info.get('chapters') or [])
        saved_files.update(Path(path) for path in paths if path)

    def processed(progress):
        report({'status': 'finished'})
        if progress['status'] == 'finished' and progress['postprocessor'] == 'MoveFiles':
            collect(progress['info_dict'])

    class CollectPlaylistFilesPP(PostProcessor):
        def run(self, info):
            # Progress hooks receive a copy from before concatenation. Collect
            # the actual result after the playlist post-processors instead.
            collect(info)
            return [], info

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

    parsed = yt_dlp.parse_options(['--ignore-config', *request['args']])
    # Inspect the unvalidated options: yt-dlp supplies bestaudio/best itself
    # for -x, so the parsed selector alone cannot identify a user's -f choice.
    requested, _ = parsed.parser.parse_args(request['args'])
    payload = request.get('payload', {})
    selects_codec = any(field.split(':', 1)[0].lstrip('+-') in
                        ('codec', 'vcodec', 'acodec', 'ext', 'vext', 'aext')
                        for field in parsed.ydl_opts['format_sort'])
    defaults = []
    if requested.format is None and not selects_codec:
        if (payload.get('mode') == 'video' and not payload.get('externalUrl')
                and not requested.extractaudio and not requested.merge_output_format
                and not requested.remuxvideo and not requested.recodevideo):
            defaults = ['--format', 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[vcodec^=avc1][ext=mp4]']
        elif payload.get('mode') == 'audio' and requested.audioformat == 'best':
            defaults = ['--format', 'bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio/best',
                        '--audio-format', 'm4a']
    if defaults:
        parsed = yt_dlp.parse_options(['--ignore-config', *defaults, *request['args']])
    options = parsed.ydl_opts
    # Templates may create subdirectories, but all output must remain in this
    # job's staging directory until the security-scoped Files export succeeds.
    for template in options['outtmpl'].values():
        if template and (Path(template).is_absolute() or '..' in Path(template).parts):
            raise ValueError('Output template must stay inside the download folder')
    logger = _QuietLogger()
    options.update({
        'paths': {'home': str(folder), 'temp': str(folder)},
        'quiet': True, 'no_warnings': True, 'logger': logger,
        'forceprint': {}, 'print_to_file': {},
        'progress_hooks': [report],
        'postprocessor_hooks': [processed],
    })
    if request.get('cookies'):
        options['cookiefile'] = request['cookies']
    if request.get('bandwidth'):
        bandwidth = yt_dlp.utils.parse_bytes(str(request['bandwidth']) + 'K') or 0
        if bandwidth > 0:
            options['ratelimit'] = max(1, min(bandwidth, 10_000_000 * 1024) // max(1, request.get('concurrency', 1)))
    set_control_file(str(control_file))
    try:
        if control_file.exists():
            raise yt_dlp.utils.DownloadError('Download interrupted')
        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.add_post_processor(CollectPlaylistFilesPP(ydl), when='playlist')
            result = ydl.download(parsed.urls)
        if result != 0:
            raise ValueError(logger.last_error or 'yt-dlp could not download this media')
        files = []
        for path in sorted(saved_files):
            if not path.is_file():
                continue
            if not path.resolve().is_relative_to(folder.resolve()):
                raise ValueError('Downloaded file escapes the download folder')
            files.append(str(path.relative_to(folder)))
        return {'files': files}
    finally:
        set_control_file('')


def _version():
    tools = {}
    for name in ('ffmpeg', 'ffprobe'):
        try:
            stdout, stderr, code = yt_dlp.utils.Popen.run(
                [name, '-version'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            match = re.search(r'version\s+(\S+)', stdout + stderr)
            version = match.group(1) if code == 0 and match else None
        except OSError:
            version = None
        tools[name] = {'source': 'managed', 'available': version is not None,
                       'path': '', 'version': version}
    return {'version': yt_dlp.version.__version__, 'tools': tools}


def handle(request_path, result_path):
    try:
        request = json.loads(Path(request_path).read_text(encoding='utf-8'))
        operation = request['operation']
        if operation == 'extract':
            result = _extract(request)
        elif operation == 'download':
            result = _download(request)
        elif operation == 'version':
            result = _version()
        else:
            raise ValueError('Unsupported yt-dlp operation')
    except Exception as error:
        # Signed media URLs and cookie paths can appear in yt-dlp exceptions.
        message = re.sub(r'https?://\S+', '[media URL]', str(error))
        result = {'error': type(error).__name__ + ': ' + message[:300]}
    Path(result_path).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
