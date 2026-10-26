import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

from yt_dlp import YoutubeDL


ROOT = Path(__file__).resolve().parents[1]
helper = ROOT / 'android/app/src/main/assets/opentubex_output_paths.py'
output_paths = types.ModuleType('output_paths')
exec(compile(helper.read_text(), str(helper), 'exec'), output_paths.__dict__)


class OutputPathsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        original = YoutubeDL.prepare_filename
        cls.addClassCleanup(setattr, YoutubeDL, 'prepare_filename', original)
        output_paths.install_output_containment()

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.staging = self.root / 'staging'

    def prepare(self, template, title='Fixture', dir_type=''):
        ydl = YoutubeDL({'outtmpl': {'default': template}, 'paths': {'home': str(self.staging)}})
        return ydl.prepare_filename({'id': 'abc', 'title': title, 'ext': 'mp4'}, dir_type)

    def test_keeps_relative_output_inside_staging(self):
        self.assertEqual(self.prepare('Music/%(title)s.%(ext)s'), str(self.staging / 'Music/Fixture.mp4'))
        self.assertEqual(self.prepare('%(title)s.%(ext)s', dir_type='thumbnail'), str(self.staging / 'Fixture.mp4'))

    def test_rejects_expanded_and_metadata_escapes(self):
        with patch.dict(os.environ, {'HOME': str(self.root)}):
            for template, title in [('$HOME/%(id)s.%(ext)s', 'Fixture'), ('${HOME}/%(id)s.%(ext)s', 'Fixture'),
                                    ('~/%(id)s.%(ext)s', 'Fixture'), ('%(title)s/%(id)s.%(ext)s', '..')]:
                with self.subTest(template=template), self.assertRaisesRegex(ValueError, 'escapes the download folder'):
                    self.prepare(template, title)

    def test_ignores_runs_without_download_folder(self):
        ydl = YoutubeDL({'outtmpl': {'default': '/tmp/%(id)s.%(ext)s'}})
        self.assertEqual(ydl.prepare_filename({'id': 'abc', 'ext': 'mp4'}), '/tmp/abc.mp4')


if __name__ == '__main__':
    unittest.main()
