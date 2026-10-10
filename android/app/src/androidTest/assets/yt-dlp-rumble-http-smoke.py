import base64
import http.server
import json
import os
import runpy
import subprocess
import sys
import threading

os.setsid()
with open(sys.argv[3], 'w') as group:
    group.write(str(os.getpid()))
sys.path.insert(0, sys.argv[1])
runpy.run_path(sys.argv[2])['install_rumble_http']()

from yt_dlp import YoutubeDL
from yt_dlp.networking import Request
from yt_dlp.networking.exceptions import HTTPError, UnsupportedRequest

original_run = subprocess.run
calls = []


def fake_run(command, *, input, **kwargs):
    assert command == [os.environ['OPENTUBEX_RUMBLE_HTTP']]
    payload = json.loads(input)
    headers = {key.lower(): value for key, value in payload['headers'].items()}
    calls.append(payload)
    if payload['url'] == 'https://rumble.com/first':
        assert headers['authorization'] == 'Bearer fixture'
        assert headers['cookie'] == 'caller=fixture; kept=fixture'
        response = {'status': 302, 'headers': {
            'Location': [redirect_url],
            'Set-Cookie': ['session=fixture; Domain=.rumble.com; Path=/', 'other=value; Domain=.rumble.com; Path=/'],
        }, 'body': ''}
        if redirect_url == 'https://rumble.com/second':
            response['headers']['Set-Cookie'].append('caller=updated; Path=/')
    else:
        assert payload['url'] == redirect_url
        if redirect_url == 'https://rumble.com/second':
            assert headers['authorization'] == 'Bearer fixture'
            assert 'caller=updated' in headers['cookie']
            assert 'kept=fixture' in headers['cookie']
        else:
            assert 'authorization' not in headers
            assert 'kept=fixture' not in headers.get('cookie', '')
        assert 'caller=fixture' not in headers.get('cookie', '')
        if redirect_url == 'https://cdn.example.com/second':
            assert 'cookie' not in headers
        else:
            assert 'session=fixture' in headers['cookie'] and 'other=value' in headers['cookie']
        response = {'status': 403, 'headers': {}, 'body': base64.b64encode(b'blocked fixture').decode()}
    return subprocess.CompletedProcess(command, 0, json.dumps(response).encode())


subprocess.run = fake_run
try:
    credentials = {'Authorization': 'Bearer fixture', 'Cookie': 'caller=fixture; kept=fixture'}
    for redirect_url in ('https://rumble.com/second', 'https://www.rumble.com/second', 'http://rumble.com/second',
                         'https://cdn.example.com/second', 'file:///fixture', 'ftp://cdn.example.com/second'):
        for default_headers in (False, True):
            calls.clear()
            with YoutubeDL({'quiet': True, 'http_headers': {'Authorization': credentials['Authorization']} if default_headers else {}}) as ydl:
                handler = ydl._request_director.handlers['AndroidRumble']
                assert not ydl._get_available_impersonate_targets(), 'Rumble support must not advertise impersonation for other sites'
                try:
                    handler.send(Request('https://example.com/video'))
                    raise AssertionError('Native Rumble handler accepted another site')
                except UnsupportedRequest:
                    pass
                try:
                    handler.send(Request('https://rumble.com/first', headers={'Cookie': credentials['Cookie']} if default_headers else credentials))
                    raise AssertionError('HTTP 403 was silently accepted')
                except HTTPError as error:
                    assert error.status == 403 and error.response.read() == b'blocked fixture'
                    assert redirect_url.startswith(('http://', 'https://'))
                except UnsupportedRequest:
                    assert redirect_url.startswith(('file:', 'ftp:'))
                assert len(calls) == (1 if redirect_url.startswith(('file:', 'ftp:')) else 2)
finally:
    subprocess.run = original_run


class Metadata(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        assert 'Chrome/150.' in self.headers['User-Agent']
        assert self.headers['Cookie'] == 'test=fixture'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"metadata":true}')

    def log_message(self, *args):
        pass


with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Metadata) as server:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    payload = json.dumps({
        'url': f'http://127.0.0.1:{server.server_port}/metadata',
        'method': 'GET', 'headers': {'Cookie': 'test=fixture'}, 'timeout': 3000,
    }).encode()
    result = original_run([os.environ['OPENTUBEX_RUMBLE_HTTP']], input=payload,
                          capture_output=True, timeout=5, check=True)
    response = json.loads(result.stdout)
    assert response['status'] == 200
    assert json.loads(base64.b64decode(response['body'])) == {'metadata': True}
    server.shutdown()

print('RUMBLE_HTTP_OK')
