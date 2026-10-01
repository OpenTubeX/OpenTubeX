import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

import opentubex_ios_ffmpeg as ffmpeg
import opentubex_ios_ytdlp as bridge
from yt_dlp.utils import Popen
from yt_dlp.postprocessor.embedthumbnail import EmbedThumbnailPP
from mutagen.flac import FLAC
from mutagen.oggopus import OggOpus


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class IOSFFmpegPythonTest(unittest.TestCase):
    def setUp(self):
        self.commands = []
        self.original_new = Popen.__dict__.get('__new__')
        self.native_patch = patch.object(ffmpeg, '_native', self.execute)
        self.native_patch.start()
        Popen.__new__ = staticmethod(ffmpeg._new_process)

    def tearDown(self):
        if self.original_new is None:
            # CPython keeps the custom-new slot after deleting a patched __new__.
            # A forwarding allocator restores normal subprocess construction.
            Popen.__new__ = staticmethod(lambda cls, *args, **kwargs: ffmpeg._original_new(cls))
        else:
            Popen.__new__ = self.original_new
        ffmpeg.set_control_file('')
        self.native_patch.stop()

    def execute(self, request_path, response_path):
        request = json.loads(Path(os.fsdecode(request_path)).read_text())
        self.commands.append(request)
        if request['controlFile'] and Path(request['controlFile']).exists():
            result = {'returncode': 255, 'stdout': '', 'stderr': 'Download interrupted'}
        else:
            process = subprocess.run(request['args'], capture_output=True, text=True)
            result = {'returncode': process.returncode, 'stdout': process.stdout, 'stderr': process.stderr}
        Path(os.fsdecode(response_path)).write_text(json.dumps(result))
        return 0

    def test_version_and_probe_use_embedded_bridge(self):
        version = bridge._version()
        self.assertTrue(version['tools']['ffmpeg']['available'])
        self.assertTrue(version['tools']['ffprobe']['available'])
        self.assertEqual([request['args'][0] for request in self.commands], ['ffmpeg', 'ffprobe'])

    def test_captured_text_bytes_and_combined_output(self):
        out, err, code = Popen.run(['ffmpeg', '-version'], text=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        self.assertEqual(code, 0)
        self.assertIn('ffmpeg version', out)
        self.assertEqual(err, '')
        out, _, _ = Popen.run(['ffprobe', '-version'], stdout=subprocess.PIPE)
        self.assertIsInstance(out, bytes)
        self.assertIn(b'ffprobe version', out)

    def test_control_file_is_isolated_to_worker_and_cleared(self):
        with tempfile.TemporaryDirectory() as temp:
            control = Path(temp) / 'control'
            control.touch()
            ffmpeg.set_control_file(str(control))
            _, _, code = Popen.run(['ffmpeg', '-version'])
            self.assertEqual(code, 255)
            other = threading.Thread(target=lambda: Popen.run(['ffmpeg', '-version']))
            other.start()
            other.join()
            self.assertEqual(self.commands[-1]['controlFile'], '')

    def test_native_timeout_becomes_subprocess_timeout(self):
        def timeout(request, response):
            Path(os.fsdecode(response)).write_text(json.dumps({'returncode': 255, 'stdout': '', 'stderr': '', 'timedOut': True}))
            return 0
        with patch.object(ffmpeg, '_native', timeout):
            with self.assertRaises(subprocess.TimeoutExpired):
                Popen.run(['ffmpeg', '-version'], timeout=0.01)

    def test_unrelated_commands_keep_original_process(self):
        with self.assertRaises(FileNotFoundError):
            Popen.run(['opentubex-nonexistent-command'])
        self.assertEqual(self.commands, [])

    def test_real_ytdlp_audio_conversion_and_video_remux(self):
        fixtures = Path(__file__).resolve().parents[1] / 'ios/App/AppTests'
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
                                                functools.partial(QuietHandler, directory=str(fixtures)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for fixture, options, extension, codec in [
                ('fixture.m4a', ['--extract-audio', '--audio-format', 'mp3', '--embed-metadata'], 'mp3', 'mp3'),
                ('fixture.mp4', ['--remux-video', 'mkv'], 'mkv', 'h264'),
                ('fixture.mp4', ['--download-sections', '*0-1', '--force-keyframes-at-cuts'], 'mp4', 'h264'),
            ]:
                with self.subTest(extension=extension), tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    url = f'http://127.0.0.1:{server.server_port}/{fixture}'
                    request = {
                        'payload': {'mode': 'audio' if extension == 'mp3' else 'video', 'externalUrl': url},
                        'args': ['--no-playlist', '--output', 'Playlist/Track with spaces.%(ext)s', *options, url],
                        'staging': str(root), 'progressFile': str(root / 'progress.json'),
                        'controlFile': str(root / 'control'),
                    }
                    result = bridge._download(request)
                    self.assertEqual(result['files'], [f'Playlist/Track with spaces.{extension}'])
                    media = json.loads(subprocess.check_output([
                        'ffprobe', '-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', str(root / result['files'][0]),
                    ]))
                    self.assertIn(codec, [stream['codec_name'] for stream in media['streams']])
                    if '--download-sections' in options:
                        self.assertAlmostEqual(float(media['format']['duration']), 1, delta=0.15)
                    self.assertEqual(getattr(ffmpeg._worker, 'control_file'), '')
            self.assertTrue(any(command['args'][0] == 'ffmpeg' for command in self.commands))
            self.assertTrue(any(command['args'][0] == 'ffprobe' for command in self.commands))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_opus_and_flac_templates_embed_artwork(self):
        fixture = Path(__file__).resolve().parents[1] / 'ios/App/AppTests/fixture.m4a'
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            image = root / 'cover.png'
            subprocess.run(['ffmpeg', '-f', 'lavfi', '-i', 'color=blue:s=16x16', '-frames:v', '1', str(image)],
                           check=True, capture_output=True)
            for extension, codec, metadata in [('opus', 'libopus', OggOpus), ('flac', 'flac', FLAC)]:
                with self.subTest(format=extension):
                    output = root / f'audio.{extension}'
                    _, stderr, code = Popen.run(['ffmpeg', '-i', str(fixture), '-c:a', codec, str(output)],
                                               text=True, stderr=subprocess.PIPE)
                    self.assertEqual(code, 0, stderr)
                    with bridge.yt_dlp.YoutubeDL({'quiet': True, 'logger': bridge._QuietLogger()}) as ydl:
                        EmbedThumbnailPP(ydl, already_have_thumbnail=True).run({
                            'filepath': str(output), 'ext': extension,
                            'thumbnails': [{'filepath': str(image)}],
                        })
                    tags = metadata(output)
                    if extension == 'flac':
                        self.assertEqual(len(tags.pictures), 1)
                    else:
                        self.assertIn('METADATA_BLOCK_PICTURE', tags)

    def test_concatenated_playlist_exports_the_final_file(self):
        fixtures = Path(__file__).resolve().parents[1] / 'ios/App/AppTests'
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
                                                functools.partial(QuietHandler, directory=str(fixtures)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}/fixture.mp4'

        def download(ydl, _urls):
            ydl.process_ie_result({
                '_type': 'playlist', 'id': 'fixture-playlist', 'title': 'Playlist',
                'extractor': 'generic', 'extractor_key': 'Generic',
                'webpage_url': 'https://example.test/playlist',
                'entries': [{
                    'id': f'fixture{index}', 'title': f'Fixture {index}', 'url': url,
                    'ext': 'mp4', 'extractor': 'generic', 'extractor_key': 'Generic', 'duration': 2,
                } for index in (1, 2)],
            }, download=True)
            return 0

        try:
            with tempfile.TemporaryDirectory() as temp, patch.object(bridge.yt_dlp.YoutubeDL, 'download', download):
                root = Path(temp)
                result = bridge._download({
                    'args': ['--output', '%(title)s.%(ext)s', '--concat-playlist', 'always',
                             'https://example.test/playlist'],
                    'staging': temp, 'progressFile': str(root / 'progress.json'),
                    'controlFile': str(root / 'control'),
                })
                self.assertEqual(result['files'], ['Playlist.mp4'])
                media = json.loads(subprocess.check_output([
                    'ffprobe', '-v', 'quiet', '-show_format', '-of', 'json', str(root / result['files'][0]),
                ]))
                self.assertAlmostEqual(float(media['format']['duration']), 4, delta=0.15)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
