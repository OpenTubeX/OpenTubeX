"""Keep every yt-dlp output file inside the download's --paths folder."""

import os


def install_output_containment():
    from yt_dlp import YoutubeDL

    original = YoutubeDL.prepare_filename

    def prepare_filename(self, *args, **kwargs):
        # YtDlpArguments checks the template text, but yt-dlp expands ~ and
        # $VARIABLES in it and keeps '..' metadata values, so check its result.
        filename = original(self, *args, **kwargs)
        home = self.params.get('paths', {}).get('home')
        if filename and home:
            root = os.path.realpath(home)
            if os.path.commonpath((root, os.path.realpath(filename))) != root:
                raise ValueError('Output path escapes the download folder')
        return filename

    YoutubeDL.prepare_filename = prepare_filename
