import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import opentubex_ios_ytdlp as bridge


class FakeYoutubeDL:
    last_options = None

    def __init__(self, options):
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
        folder = Path(self.options['outtmpl']).parent
        if ',' in self.options['format']:
            folder.joinpath('Fixture [abc].f133.mp4').write_bytes(b'video')
            folder.joinpath('Fixture [abc].f140.m4a').write_bytes(b'audio')
        else:
            folder.joinpath('Fixture [abc].mp4').write_bytes(b'media')
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
    def test_download_reports_progress_and_saved_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            request = {
                'payload': {'mode': 'video', 'videoId': 'abcdefghijk'},
                'staging': str(root / 'stage'),
                'progressFile': str(root / 'stage' / 'progress.json'),
                'controlFile': str(root / 'stage' / 'control'),
            }
            result = bridge._download(request)
            self.assertEqual(result['merges'], [{
                'video': 'Fixture [abc].f133.mp4',
                'audio': 'Fixture [abc].f140.m4a',
                'output': 'Fixture [abc].mp4',
            }])
            self.assertEqual(FakeYoutubeDL.last_options['format'],
                             'bestvideo[vcodec^=avc1][ext=mp4],bestaudio[ext=m4a]')
            progress = json.loads(Path(request['progressFile']).read_text())
            self.assertEqual(progress['percent'], 50)

    @patch.object(bridge.yt_dlp, 'YoutubeDL', FakeYoutubeDL)
    def test_external_download_keeps_single_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            request = {
                'payload': {'mode': 'video', 'externalUrl': 'https://example.org/video'},
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
                'staging': str(root / 'stage'),
                'progressFile': str(root / 'stage' / 'progress.json'),
                'controlFile': str(root / 'stage' / 'control'),
            }
            bridge._download(request)
            progress = json.loads(Path(request['progressFile']).read_text())
            self.assertEqual(progress, {
                'status': 'processing', 'percent': 0, 'speed': None, 'eta': None,
            })


if __name__ == '__main__':
    unittest.main()
