"""Use the packaged Chrome TLS transport for Rumble's metadata requests."""

import base64
import io
import json
import os
import subprocess
import urllib.parse
import urllib.request
from types import SimpleNamespace


def _origin(url):
    parts = urllib.parse.urlsplit(url)
    return parts.scheme, parts.hostname, parts.port or (443 if parts.scheme == 'https' else 80)


def install_rumble_http():
    from yt_dlp.networking.common import Features, RequestHandler, register_preference, register_rh
    from yt_dlp.networking import Response
    from yt_dlp.networking.exceptions import HTTPError, TransportError, UnsupportedRequest
    from yt_dlp.utils.networking import std_headers

    @register_rh
    class AndroidRumbleRH(RequestHandler):
        _SUPPORTED_URL_SCHEMES = ('http', 'https')
        _SUPPORTED_PROXY_SCHEMES = ('http',)
        _SUPPORTED_FEATURES = (Features.ALL_PROXY, Features.NO_PROXY)

        def _validate(self, request):
            super()._validate(request)
            host = urllib.parse.urlsplit(request.url).hostname or ''
            if host != 'rumble.com' and not host.endswith('.rumble.com'):
                raise UnsupportedRequest('Android Chrome transport is limited to Rumble metadata')

        def _check_extensions(self, extensions):
            super()._check_extensions(extensions)
            for name in ('impersonate', 'cookiejar', 'timeout'):
                extensions.pop(name, None)

        def _send(self, request):
            request = request.copy()
            jar = self._get_cookiejar(request)
            request.headers = self._merge_headers(request.headers)
            # Merge defaults once so redirects cannot restore stripped credentials.
            # Use Chrome's defaults without advertising browser targets for other sites.
            for name, value in std_headers.items():
                if request.headers.get(name) == value:
                    request.headers.pop(name)
            for attempt in range(11):
                self.validate(request)
                cookie_request = urllib.request.Request(request.url, headers=request.headers)
                jar.add_cookie_header(cookie_request)
                headers = dict(cookie_request.header_items())
                timeout = max(1, min(60000, int(self._calculate_timeout(request) * 1000)))
                payload = json.dumps({
                    'url': request.url, 'method': request.method, 'headers': headers,
                    'body': base64.b64encode(request.data).decode() if request.data else None,
                    'timeout': timeout,
                }).encode()
                try:
                    result = subprocess.run([os.environ['OPENTUBEX_RUMBLE_HTTP']], input=payload,
                                            capture_output=True, timeout=timeout / 1000 + 5, check=True)
                    data = json.loads(result.stdout)
                except (subprocess.SubprocessError, ValueError) as error:
                    # Do not echo request headers or the helper's diagnostic, which
                    # may contain credentials from a configured proxy.
                    raise TransportError('Android Rumble HTTP request failed', cause=error) from error
                response = Response(io.BytesIO(base64.b64decode(data['body'])), request.url, {}, data['status'])
                for name, values in data['headers'].items():
                    for value in values:
                        response.headers.add_header(name, value)
                jar.extract_cookies(SimpleNamespace(info=lambda: response.headers), cookie_request)
                location = response.get_header('Location')
                if response.status in (301, 302, 303, 307, 308) and location:
                    if attempt == 10:
                        raise HTTPError(response, redirect_loop=True)
                    previous = _origin(request.url)
                    request.url = urllib.parse.urljoin(request.url, location)
                    if _origin(request.url) != previous:
                        request.headers.pop('Authorization', None)
                        request.headers.pop('Cookie', None)
                    if response.status == 303 or (response.status in (301, 302) and request.method == 'POST'):
                        request.method, request.data = 'GET', None
                        request.headers.pop('Content-Type', None)
                        request.headers.pop('Content-Length', None)
                    response.close()
                    continue
                if response.status >= 400:
                    raise HTTPError(response)
                return response

    @register_preference(AndroidRumbleRH)
    def prefer_rumble_transport(handler, request):
        return 1000
