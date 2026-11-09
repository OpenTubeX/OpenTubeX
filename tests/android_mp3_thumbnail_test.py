from pathlib import Path
import shutil
import tempfile
import types
import unittest
from unittest.mock import patch

from mutagen.id3 import APIC, CHAP, ID3, TDAT, TIT2, TORY, TPE1, TYER
from yt_dlp import YoutubeDL
from yt_dlp.postprocessor.embedthumbnail import EmbedThumbnailPP


ROOT = Path(__file__).resolve().parents[1]
helper = ROOT / 'android/app/src/main/assets/opentubex_mp3_thumbnail.py'
thumbnail = types.ModuleType('mp3_thumbnail')
exec(compile(helper.read_text(), str(helper), 'exec'), thumbnail.__dict__)


def audio_frames(path):
    data = path.read_bytes()
    if data[:3] == b'ID3':
        size = sum((value & 127) << shift for value, shift in zip(data[6:10], (21, 14, 7, 0)))
        data = data[10 + size:]
    if data[-128:-125] == b'TAG':
        data = data[:-128]
    return data


class MP3ThumbnailTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.source = self.root / 'source.mp3'
        shutil.copyfile(ROOT / 'e2e/fixtures/media/demo-audio.mp3', self.source)
        self.output = self.root / 'covered.mp3'
        self.cover = self.root / 'cover.jpg'
        self.cover.write_bytes(b'\xff\xd8\xff\xd9')
        fallback = patch.object(EmbedThumbnailPP, 'run_ffmpeg_multiple_files', return_value='fallback')
        self.fallback = fallback.start()
        self.addCleanup(fallback.stop)
        thumbnail.install_mp3_thumbnail_writer()
        self.pp = EmbedThumbnailPP(YoutubeDL({'quiet': True}))
        warning = patch.object(self.pp, 'report_warning')
        self.warning = warning.start()
        self.addCleanup(warning.stop)

    def write(self):
        return self.pp.run_ffmpeg_multiple_files([str(self.source), str(self.cover)], str(self.output), ['-c', 'copy'])

    def test_replaces_cover_and_preserves_audio_unicode_metadata_and_chapters(self):
        tags = ID3(self.source)
        tags.add(TIT2(encoding=3, text=['Qualität']))
        tags.add(TPE1(encoding=3, text=['OpenTubeX']))
        tags.add(CHAP(element_id='chapter', start_time=0, end_time=2000, start_offset=0xffffffff,
                      end_offset=0xffffffff, sub_frames=[TIT2(encoding=3, text=['Einführung'])]))
        tags.add(APIC(encoding=3, mime='image/png', type=3, desc='Old cover', data=b'old'))
        tags.save(self.source)
        original = self.source.read_bytes()

        self.write()

        self.fallback.assert_not_called()
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual(audio_frames(self.source), audio_frames(self.output))
        result = ID3(self.output)
        self.assertEqual(result.version, (2, 3, 0))
        self.assertEqual(result['TIT2'].text, ['Qualität'])
        self.assertEqual(result['TPE1'].text, ['OpenTubeX'])
        self.assertEqual(result['CHAP:chapter'].sub_frames['TIT2'].text, ['Einführung'])
        self.assertEqual(len(result.getall('APIC')), 1)
        cover = result.getall('APIC')[0]
        self.assertEqual((cover.mime, cover.type, cover.desc), ('image/jpeg', 3, 'Album cover'))
        self.assertEqual(cover.data, self.cover.read_bytes())

    def test_accepts_mp3_without_id3_and_png_cover(self):
        self.source.write_bytes(audio_frames(self.source))
        self.cover = self.cover.with_suffix('.png')
        self.cover.write_bytes(b'png cover')
        original = self.source.read_bytes()
        self.write()
        self.assertEqual(audio_frames(self.output), original)
        self.assertEqual(ID3(self.output).getall('APIC')[0].mime, 'image/png')
        self.fallback.assert_not_called()

    def test_preserves_valid_id3v23_date_frames(self):
        tags = ID3(self.source)
        tags.add(TYER(encoding=1, text=['2026']))
        tags.add(TDAT(encoding=1, text=['0810']))
        tags.add(TORY(encoding=1, text=['2025']))
        tags.update_to_v23()
        tags.save(self.source, v2_version=3)
        original = ID3(self.source, translate=False)
        self.assertEqual(original['TYER'].text, ['2026'])
        self.assertEqual(original['TDAT'].text, ['0810'])
        self.assertEqual(original['TORY'].text, ['2025'])

        self.write()

        result = ID3(self.output, translate=False)
        self.assertEqual(result.version, (2, 3, 0))
        for name in ('TYER', 'TDAT', 'TORY'):
            self.assertEqual(result[name].text, original[name].text)
        self.assertNotIn('TDRC', result)
        self.assertNotIn('TDOR', result)
        self.assertEqual(audio_frames(self.source), audio_frames(self.output))
        self.fallback.assert_not_called()

    def test_tag_failure_keeps_original_intact_and_uses_ffmpeg(self):
        original = self.source.read_bytes()
        with patch.object(ID3, 'save', side_effect=OSError('tag write failed')):
            self.assertEqual(self.write(), 'fallback')
        self.assertEqual(self.source.read_bytes(), original)
        self.fallback.assert_called_once()
        self.warning.assert_called_once()

    def test_other_formats_and_custom_ffmpeg_options_keep_the_original_path(self):
        self.source = self.source.with_suffix('.m4a')
        self.assertEqual(self.write(), 'fallback')
        self.assertFalse(self.output.exists())
        self.source = self.source.with_suffix('.mp3')
        self.pp._downloader.params['postprocessor_args'] = {'embedthumbnail+ffmpeg_o': ['-id3v2_version', '4']}
        self.assertEqual(self.write(), 'fallback')
        self.assertFalse(self.output.exists())
        self.assertEqual(self.fallback.call_count, 2)


if __name__ == '__main__':
    unittest.main()
