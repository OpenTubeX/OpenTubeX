"""Exercise the packaged EJS provider without relying on YouTube or its rate limits."""
import json
import os
import sys

os.setsid()
with open(sys.argv[3], 'w') as group:
    group.write(str(os.getpid()))

sys.path.insert(0, sys.argv[1])
from yt_dlp import YoutubeDL
from yt_dlp.extractor.youtube import YoutubeIE
from yt_dlp.extractor.youtube.jsc._builtin.quickjs import QuickJSJCP
from yt_dlp.extractor.youtube.jsc.provider import JsChallengeRequest, JsChallengeType, SigChallengeInput

class Logger:
    def debug(self, message):
        pass

    def warning(self, message, **kwargs):
        raise AssertionError(message)

with YoutubeDL({'js_runtimes': {'quickjs': {'path': sys.argv[2]}}, 'cachedir': False}) as ydl:
    provider = QuickJSJCP(YoutubeIE(ydl), Logger(), {})
    assert provider.is_available(), 'Packaged QuickJS is unavailable to yt-dlp'
    request = JsChallengeRequest(JsChallengeType.SIG, SigChallengeInput('fixture', ['abcdef']))
    script = provider._construct_stdin('_result.sig = s => s.split("").reverse().join("");', True, [request])
    result = json.loads(provider._run_js_runtime(script))
    assert result['responses'][0]['data']['abcdef'] == 'fedcba', result
    print('EJS_QUICKJS_OK')
