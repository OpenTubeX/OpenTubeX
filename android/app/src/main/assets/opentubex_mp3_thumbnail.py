"""Write MP3 cover art without asking FFmpeg to remux every audio frame."""

import os
import shutil


def install_mp3_thumbnail_writer():
    from yt_dlp.dependencies import mutagen
    from yt_dlp.postprocessor.embedthumbnail import EmbedThumbnailPP

    if not mutagen:
        return

    from mutagen.id3 import APIC, ID3, ID3NoHeaderError

    original = EmbedThumbnailPP.run_ffmpeg_multiple_files

    def write_thumbnail(self, input_paths, out_path, opts, **kwargs):
        # Leave conversion, thumbnail cleanup and timestamps to yt-dlp. Only
        # replace its MP3 remux; other formats and custom FFmpeg options use it.
        if (len(input_paths) != 2 or not input_paths[0].lower().endswith('.mp3')
                or self.get_param('postprocessor_args')):
            return original(self, input_paths, out_path, opts, **kwargs)

        filename, thumbnail = input_paths
        extension = os.path.splitext(thumbnail)[1].lower()
        mime = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png'}.get(extension)
        if not mime:
            return original(self, input_paths, out_path, opts, **kwargs)

        try:
            # Keep the original intact until yt-dlp replaces it on success,
            # including when a paused/cancelled download kills this process.
            shutil.copyfile(filename, out_path)
            try:
                tags = ID3(out_path)
            except ID3NoHeaderError:
                tags = ID3()
            tags.delall('APIC')
            with open(thumbnail, 'rb') as image:
                tags.add(APIC(encoding=3, mime=mime, type=3, desc='Album cover', data=image.read()))
            tags.update_to_v23()
            tags.save(out_path, v2_version=3, v1=2)
            self.write_debug('MP3 cover art written with mutagen; audio frames copied unchanged')
            return ''
        except (OSError, ValueError, mutagen.MutagenError) as error:
            self.report_warning(f'Unable to write MP3 cover art with mutagen; falling back to ffmpeg: {error}')
            return original(self, input_paths, out_path, opts, **kwargs)

    EmbedThumbnailPP.run_ffmpeg_multiple_files = write_thumbnail
