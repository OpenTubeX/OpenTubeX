import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import opentubex_ios_ytdlp as bridge


class FakeYoutubeDL(bridge.yt_dlp.YoutubeDL):
    last_options = None

    def __init__(self, options):
        super().__init__(options, auto_init=False)
        self.options = options
        FakeYoutubeDL.last_options = options

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def extract_info(self, _url, download=False):
        return {
            'title': 'Fixture',
            'formats': [
                {'format_id': '18', 'url': 'https://media.example/video',
                 'protocol': 'https', 'ext': 'mp4', 'fragments': [{'url': 'secret-fragment'}]},
                {'protocol': 'mhtml', 'fragments': [{'url': 'https://media.example/storyboard'}]},
            ],
        }

    def sanitize_info(self, info):
        return info

    def download(self, _urls):
        self.options['progress_hooks'][0]({
            'status': 'downloading', 'downloaded_bytes': 50, 'total_bytes': 100,
            'speed': 1000, 'eta': 1,
        })
        folder = Path(self.options['paths']['home'])
        folder.joinpath('Fixture [abc].mp4').write_bytes(b'media')
        folder.joinpath('obsolete.f133.mp4').write_bytes(b'old partial track')
        self.options['postprocessor_hooks'][0]({
            'status': 'finished', 'postprocessor': 'MoveFiles',
            'info_dict': {'filepath': str(folder / 'Fixture [abc].mp4')},
        })
        return 0


class FinishedYoutubeDL(FakeYoutubeDL):
    def download(self, urls):
        result = super().download(urls)
        self.options['progress_hooks'][0]({
            'status': 'finished', 'downloaded_bytes': 100, 'total_bytes': 100,
            'speed': 1000, 'eta': 0,
        })
        return result


class IOSYtDlpPythonTest(unittest.TestCase):
    def test_bundled_ytdlp_has_trusted_roots_without_system_ca(self):
        packages = Path(__file__).resolve().parents[1] / 'ios/App/python-packages'
        environment = os.environ.copy()
        environment.update({
            'PYTHONPATH': str(packages),
            'SSL_CERT_FILE': '/nonexistent/opentubex-ca.pem',
            'SSL_CERT_DIR': '/nonexistent/opentubex-ca-dir',
        })
        result = subprocess.run([sys.executable, '-S', '-c', '''
import ssl
from yt_dlp.networking._helper import ssl_load_certs
context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
ssl_load_certs(context)
print(context.cert_store_stats()['x509_ca'])
'''], env=environment, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertGreater(int(result.stdout.strip()), 0, result.stderr)

    def test_version_uses_bundled_package(self):
        with tempfile.TemporaryDirectory() as temp:
            request = Path(temp) / 'request.json'
            result = Path(temp) / 'result.json'
            request.write_text('{"operation":"version"}')
            bridge.handle(request, result)
            self.assertEqual(json.loads(result.read_text())['version'], bridge.yt_dlp.version.__version__)

    @patch.object(bridge.yt_dlp, 'YoutubeDL', FakeYoutubeDL)
    def test_extract_keeps_playback_fields_without_media_fragments(self):
        result = bridge._extract({'args': ['--format', 'best', '--write-subs',
                                          '--write-auto-subs', '--sub-langs', 'all',
                                          'https://example.org/video']})
        media = json.loads(result['stdout'])
        self.assertEqual(media['title'], 'Fixture')
        self.assertEqual(media['formats'][0]['format_id'], '18')
        self.assertNotIn('fragments', media['formats'][0])
        self.assertEqual(media['storyboard']['protocol'], 'mhtml')
        self.assertTrue(FakeYoutubeDL.last_options['writesubtitles'])
        self.assertTrue(FakeYoutubeDL.last_options['writeautomaticsub'])

    @patch.object(bridge.yt_dlp, 'YoutubeDL', FakeYoutubeDL)
    def test_extract_splits_requested_subtitle_languages(self):
        bridge._extract({'args': ['--sub-langs', 'en, de, ,fr', 'https://example.org/video']})
        self.assertEqual(FakeYoutubeDL.last_options['subtitleslangs'], ['en', 'de', 'fr'])

    @patch.object(bridge.yt_dlp, 'YoutubeDL', FakeYoutubeDL)
    def test_download_reports_progress_and_saved_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            request = {
                'payload': {'mode': 'video', 'videoId': 'abcdefghijk'},
                'args': ['--no-playlist', '--output', '%(title)s [%(id)s].%(ext)s',
                         '--merge-output-format', 'mkv', '-S', 'codec:av1,res:2160',
                         'https://www.youtube.com/watch?v=abcdefghijk'],
                'staging': str(root / 'stage'),
                'progressFile': str(root / 'stage' / 'progress.json'),
                'controlFile': str(root / 'stage' / 'control'),
            }
            result = bridge._download(request)
            self.assertEqual(result['files'], ['Fixture [abc].mp4'])
            self.assertEqual(FakeYoutubeDL.last_options['merge_output_format'], 'mkv')
            self.assertEqual(FakeYoutubeDL.last_options['format_sort'], ['codec:av1', 'res:2160'])
            progress = json.loads(Path(request['progressFile']).read_text())
            self.assertEqual(progress['status'], 'processing')

    @patch.object(bridge.yt_dlp, 'YoutubeDL', FakeYoutubeDL)
    def test_external_download_keeps_single_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            request = {
                'payload': {'mode': 'video', 'externalUrl': 'https://example.org/video'},
                'args': ['--no-playlist', 'https://example.org/video'],
                'staging': str(root / 'stage'),
                'progressFile': str(root / 'stage' / 'progress.json'),
                'controlFile': str(root / 'stage' / 'control'),
            }
            result = bridge._download(request)
            self.assertEqual(result['files'], ['Fixture [abc].mp4'])

    @patch.object(bridge.yt_dlp, 'YoutubeDL', FinishedYoutubeDL)
    def test_processing_progress_clears_transfer_metrics(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            request = {
                'payload': {'mode': 'video', 'externalUrl': 'https://example.org/video'},
                'args': ['--no-playlist', 'https://example.org/video'],
                'staging': str(root / 'stage'),
                'progressFile': str(root / 'stage' / 'progress.json'),
                'controlFile': str(root / 'stage' / 'control'),
            }
            bridge._download(request)
            progress = json.loads(Path(request['progressFile']).read_text())
            self.assertEqual(progress, {
                'status': 'processing', 'percent': 0, 'speed': None, 'eta': None,
            })

    @patch.object(bridge.yt_dlp, 'YoutubeDL', FakeYoutubeDL)
    def test_cancel_before_worker_starts_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            staging = root / 'stage'
            staging.mkdir()
            control = staging / 'control'
            control.touch()
            request = {
                'payload': {'mode': 'video', 'externalUrl': 'https://example.org/video'},
                'args': ['--no-playlist', 'https://example.org/video'],
                'staging': str(staging),
                'progressFile': str(staging / 'progress.json'),
                'controlFile': str(control),
            }
            with self.assertRaises(bridge.yt_dlp.utils.DownloadError):
                bridge._download(request)
            self.assertTrue(control.exists())


if __name__ == '__main__':
    unittest.main()
