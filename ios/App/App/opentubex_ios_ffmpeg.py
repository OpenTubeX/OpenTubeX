"""Run yt-dlp's FFmpeg/FFprobe commands in-process on iOS, without spawning."""

import ctypes
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading

from yt_dlp.utils import Popen

_worker = threading.local()
_native = None
_original_new = Popen.__new__


def install(address):
    global _native
    _native = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_char_p, ctypes.c_char_p)(address)
    Popen.__new__ = staticmethod(_new_process)


def set_control_file(path):
    _worker.control_file = path


def _new_process(cls, args, *remaining, **kwargs):
    if isinstance(args, (list, tuple)) and args and os.fsdecode(args[0]) in ('ffmpeg', 'ffprobe'):
        return _EmbeddedProcess(args, *remaining, **kwargs)
    return _original_new(cls)


class _EmbeddedProcess:
    def __init__(self, args, *remaining, text=False, encoding=None, errors=None,
                 universal_newlines=False, shell=False, cwd=None, **kwargs):
        if remaining or shell or cwd:
            raise ValueError('Unsupported embedded FFmpeg process options')
        self.args = [os.fsdecode(arg) for arg in args]
        self._Popen__text_mode = text or encoding or errors or universal_newlines
        self.encoding = encoding or 'utf-8'
        self.errors = errors or 'replace'
        self.returncode = None
        self._result = None
        self._control_file = getattr(_worker, 'control_file', '')
        self._stdout = kwargs.get('stdout')
        self._stderr = kwargs.get('stderr')

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def communicate_or_kill(self, input=None, timeout=None):
        return self.communicate(input=input, timeout=timeout)

    def communicate(self, input=None, timeout=None):
        if input is not None:
            raise ValueError('Embedded FFmpeg does not support piped input')
        if self._result is None:
            if _native is None:
                raise RuntimeError('Bundled FFmpeg bridge is not initialized')
            with tempfile.TemporaryDirectory(prefix='opentubex-ffmpeg-') as temp:
                request = Path(temp) / 'request.json'
                response = Path(temp) / 'response.json'
                request.write_text(json.dumps({
                    'args': self.args, 'controlFile': self._control_file,
                    'timeout': timeout,
                }), encoding='utf-8')
                if _native(os.fsencode(request), os.fsencode(response)) != 0:
                    raise RuntimeError('Bundled FFmpeg command failed')
                result = json.loads(response.read_text(encoding='utf-8'))
            self.returncode = result['returncode']
            if result.get('timedOut'):
                raise subprocess.TimeoutExpired(self.args, timeout)
            stdout, stderr = result['stdout'], result['stderr']
            if self._stderr == subprocess.STDOUT:
                stdout += stderr
            if not self._Popen__text_mode:
                stdout = stdout.encode(self.encoding, self.errors)
                stderr = stderr.encode(self.encoding, self.errors)
            self._result = (stdout if self._stdout == subprocess.PIPE else None,
                            stderr if self._stderr == subprocess.PIPE else None)
        return self._result

    def wait(self, timeout=None):
        self.communicate(timeout=timeout)
        return self.returncode

    def poll(self):
        return self.returncode

    def kill(self, *, timeout=0):
        if self._control_file:
            Path(self._control_file).touch()
        self.returncode = 255
        self._result = (None, None)

    terminate = kill
