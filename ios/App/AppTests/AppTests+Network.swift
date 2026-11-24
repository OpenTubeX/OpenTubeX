import XCTest
import Capacitor
import AVFoundation
import WebKit
import MediaPlayer
import Network
import AVKit
@testable import App

extension AppTests {
    func testExternalMediaOutlivesSabrResourceTimeout() async throws {
        let listener = try await loopbackServer { header, connection in
            let long = header.contains(" /long ")
            let response = "HTTP/1.1 200 OK\r\nContent-Length: \(long ? 64 : 5)\r\nConnection: close\r\n\r\n"
            func send(_ index: Int) {
                guard index < 64 else { connection.cancel(); return }
                connection.send(content: Data([UInt8(index)]), completion: .contentProcessed { error in
                    if error != nil { connection.cancel(); return }
                    DispatchQueue.global().asyncAfter(deadline: .now() + 2) { send(index + 1) }
                })
            }
            connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in
                if long { send(0) }
                else { connection.send(content: Data("short".utf8), completion: .contentProcessed { _ in connection.cancel() }) }
            })
        }
        defer { listener.cancel() }
        let base = "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)"
        let network = IOSNetwork()
        let mediaID = network.prepareExternal(URLRequest(url: try XCTUnwrap(URL(string: base + "/long"))))
        let sabrID = network.prepare(URLRequest(url: try XCTUnwrap(URL(string: base + "/short"))))
        let mediaDone = expectation(description: "Media completes beyond two minutes")
        let sabrDone = expectation(description: "Concurrent SABR task completes independently")
        let media = RecordingSchemeTask(url: try XCTUnwrap(URL(string: "capacitor://localhost/_opentubex_media/\(mediaID)")), done: mediaDone)
        let sabr = RecordingSchemeTask(url: try XCTUnwrap(URL(string: "capacitor://localhost/_opentubex_sabr/\(sabrID)")), done: sabrDone)
        defer { network.stop(media); network.stop(sabr) }
        network.start(media)
        network.start(sabr)
        await fulfillment(of: [sabrDone, mediaDone], timeout: 145)
        XCTAssertNil(sabr.error)
        XCTAssertEqual(sabr.data, Data("short".utf8))
        XCTAssertNil(media.error)
        XCTAssertEqual(media.data, Data((0..<64).map(UInt8.init)))
    }

    func testAPIReadTimeoutAllowsContinuouslyArrivingData() async throws {
        try await openApplication()
        let listener = try await loopbackServer { _, connection in
            let header = "HTTP/1.1 200 OK\r\nContent-Length: 12\r\nConnection: close\r\n\r\n"
            func send(_ count: Int) {
                guard count < 12 else { connection.cancel(); return }
                connection.send(content: Data("x".utf8), completion: .contentProcessed { error in
                    if error != nil { connection.cancel(); return }
                    DispatchQueue.global().asyncAfter(deadline: .now() + 0.2) { send(count + 1) }
                })
            }
            connection.send(content: Data(header.utf8), completion: .contentProcessed { _ in send(0) })
        }
        defer { listener.cancel() }
        let result = try await webView.callPageScript("""
            return await Capacitor.Plugins.IOSHttp.request({requestId: crypto.randomUUID(), url,
                method: 'GET', responseType: 'text', connectTimeout: 500, readTimeout: 500});
            """, arguments: ["url": "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/trickle"]) as? [String: Any]
        XCTAssertEqual(result?["status"] as? Int, 200)
        XCTAssertEqual(result?["data"] as? String, String(repeating: "x", count: 12))
    }

    func testPoTokenAttestationIsKeptOnlyWhileAttestedAndUnexpired() {
        let attested = String(repeating: "a", count: PoTokenPlugin.maxAttestedPoTokenLength)
        let pending = String(repeating: "p", count: PoTokenPlugin.maxAttestedPoTokenLength + 4)
        let startedAt = Date(timeIntervalSince1970: 1)
        let now = Date(timeIntervalSince1970: 3)
        XCTAssertEqual(PoTokenPlugin.attestationExpiry(token: attested, startedAt: startedAt, validForSecs: 43_200, now: now),
                       Date(timeIntervalSince1970: 43_201))
        XCTAssertNil(PoTokenPlugin.attestationExpiry(token: pending, startedAt: startedAt, validForSecs: 43_200, now: now))
        XCTAssertNil(PoTokenPlugin.attestationExpiry(token: attested, startedAt: startedAt, validForSecs: 1, now: now))
    }

    func testBotGuardScriptCallsTheDefaultExportRspackEmits() throws {
        XCTAssertEqual(try PoTokenPlugin.botGuardCall("let a=1;export default async function(e){return e+a}\n", arguments: "...[\"id\"]"),
                       "let a=1;const ftBotGuardScript=async function(e){return e+a}\n;ftBotGuardScript(...[\"id\"])")
        XCTAssertEqual(try PoTokenPlugin.botGuardCall("async function bg(e){return e}export{bg as default};\n", arguments: "...[\"id\"]"),
                       "async function bg(e){return e};bg(...[\"id\"])\n")
    }

    func testPoTokenWebViewKeepsYouTubeNavigationInsideApp() async throws {
        let redirected = expectation(description: "Blocked navigation to a YouTube watch page")
        let guardDelegate = RecordingPoTokenNavigationGuard { url, policy in
            if url.path == "/watch" {
                XCTAssertEqual(policy, .cancel)
                redirected.fulfill()
            }
        }
        let isolatedView = WKWebView(frame: .zero)
        isolatedView.navigationDelegate = guardDelegate
        isolatedView.loadHTMLString("""
            <html><body id="token-test"><script>
            window.addEventListener('load', () => location.assign('https://www.youtube.com/watch?v=jNQXAC9IVRw'));
            </script></body></html>
            """, baseURL: URL(string: "https://www.youtube.com/"))
        await fulfillment(of: [redirected], timeout: 45)
        let retained = try await isolatedView.evaluatePageScript("!!document.getElementById('token-test')") as? Bool
        XCTAssertEqual(retained, true)
    }

    func testOnlyConnectionFailuresWaitToReconnect() {
        // URLSession localizes its descriptions, so the error code decides.
        XCTAssertTrue(isConnectionFailure(URLError(.timedOut, userInfo: [NSLocalizedDescriptionKey: "Zeitüberschreitung bei der Anforderung."])))
        // A certificate failure is permanent; retrying it would wait forever.
        XCTAssertFalse(isConnectionFailure(URLError(.serverCertificateUntrusted)))
    }

    func testRumblePagesKeepTheCookieOfTheRedirectToTheSamePage() async throws {
        let url = "https://rumble.com/search/video?q=news"
        var cookies: [String?] = []
        RumbleStubProtocol.respond = { request in
            let cookie = request.value(forHTTPHeaderField: "Cookie")
            cookies.append(cookie)
            // URLSession joins the Set-Cookie headers of a response
            return cookie == nil
                ? (307, ["Location": url, "Set-Cookie": [
                    "RNSC=1;max-age=3600;path=/;domain=rumble.com;secure;HttpOnly;SameSite=lax",
                    "__cf_bm=token; HttpOnly; SameSite=None; Partitioned; Secure; Path=/; Domain=rumble.com; Expires=Fri, 01 Jan 2100 00:00:00 GMT",
                    // Expired, so it isn't sent
                    "old=value; Path=/; Expires=Sat, 01-Jan-2000 00:00:00 GMT",
                ].joined(separator: ", ")], "")
                : (200, [:], "<html>results</html>")
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RumbleStubProtocol.self]
        let pages = RumblePages(configuration: configuration)

        let page = try await pages.fetch(url)
        XCTAssertEqual(page.status, 200)
        XCTAssertEqual(page.text, "<html>results</html>")
        guard cookies.count == 2 else { return XCTFail("Requested the page \(cookies.count) times") }
        XCTAssertNil(cookies[0])
        XCTAssertEqual(Set(cookies[1]?.components(separatedBy: "; ") ?? []), ["RNSC=1", "__cf_bm=token"])
    }

    func testRumblePagesReportTheCheckAndUseTheBrowserThatPassedIt() async throws {
        let url = "https://rumble.com/search/video?q=news"
        var requests: [URLRequest] = []
        RumbleStubProtocol.respond = { request in
            requests.append(request)
            return request.value(forHTTPHeaderField: "Cookie")?.contains("cf_clearance=passed") == true
                ? (200, [:], "<html>results</html>")
                : (403, ["cf-mitigated": "challenge"], "Just a moment...")
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RumbleStubProtocol.self]
        let pages = RumblePages(configuration: configuration)

        let check = try await pages.fetch(url)
        XCTAssertEqual(check.status, 403)
        XCTAssertTrue(check.challenge)

        let browserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
        let cookie = { (name: String, domain: String) in
            HTTPCookie(properties: [.name: name, .value: "passed", .domain: domain, .path: "/"])!
        }
        // Only Rumble's cookies are taken
        pages.acceptBrowserSession(cookies: [cookie("cf_clearance", ".rumble.com"), cookie("other", ".example.test")], userAgent: browserAgent)
        let page = try await pages.fetch(url)
        XCTAssertEqual(page.status, 200)
        XCTAssertFalse(page.challenge)
        XCTAssertEqual(requests.last?.value(forHTTPHeaderField: "Cookie"), "cf_clearance=passed")
        XCTAssertEqual(requests.last?.value(forHTTPHeaderField: "User-Agent"), browserAgent)
    }

    func testRumblePagesLoadOnlyRumblePages() async throws {
        XCTAssertTrue(RumblePages.isRumblePage(URL(string: "https://rumble.com/c/Example?page=2")))
        for url in ["http://rumble.com/c/Example", "https://rumble.com.example.test/c/Example", "https://notrumble.com/c/Example",
                    "https://user@rumble.com/c/Example", "https://rumble.com:8443/c/Example", "file:///etc/hosts"] {
            XCTAssertFalse(RumblePages.isRumblePage(URL(string: url)), url)
        }
        // Nor does it follow redirects elsewhere
        RumbleStubProtocol.respond = { _ in (302, ["Location": "https://example.test/"], "") }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RumbleStubProtocol.self]
        do {
            _ = try await RumblePages(configuration: configuration).fetch("https://rumble.com/c/Example")
            XCTFail("Followed a redirect away from Rumble")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Not a Rumble page")
        }
    }

    func testMediaRequestOrigins() throws {
        for address in ["https://rr1.googlevideo.com/videoplayback", "https://euc1.playlist.ttvnw.net/v1/playlist/session.m3u8",
                        "https://d1example.cloudfront.net/key_channel_1/chunked/index-dvr.m3u8", "https://d1example.cloudfront.net/channel/123/key_channel_1/720p60/12-muted.ts"] {
            XCTAssertTrue(IOSNetwork.isMediaURL(try XCTUnwrap(URL(string: address))), address)
        }
        for address in ["http://rr1.googlevideo.com/videoplayback", "https://googlevideo.com.attacker.invalid/", "https://notgooglevideo.com/", "https://user:password@rr1.googlevideo.com/",
                        "https://euc1.playlist.ttvnw.net.attacker.invalid/v1/playlist/session.m3u8", "https://euc1.playlist.ttvnw.net/v1/segment/session.ts",
                        "https://euc1.playlist.ttvnw.net:8443/v1/playlist/session.m3u8", "https://usher.ttvnw.net/api/channel/hls/example.m3u8",
                        "https://d1example.cloudfront.net.attacker.invalid/key_channel_1/chunked/index-dvr.m3u8", "https://d1example.cloudfront.net/key_channel_1/other/index-dvr.m3u8"] {
            XCTAssertFalse(IOSNetwork.isMediaURL(try XCTUnwrap(URL(string: address))), address)
        }
    }

    func testNativeMediaRequestMethods() async throws {
        try await openApplication()
        let result = try await webView.callPageScript("""
        const plugin = Capacitor.Plugins.SabrHttp;
        const url = 'https://manifest.googlevideo.com/api/manifest/test';
        for (const method of ['GET', 'HEAD']) {
            const prepared = await plugin.prepare({url, method});
            if (!prepared.requestId) throw new Error('Missing native request');
            await plugin.abort(prepared);
        }
        let rejected = 0;
        for (const options of [{url, method: 'DELETE'}, {url, method: 'POST'},
            {url: 'https://googlevideo.com.attacker.invalid/test', method: 'GET'},
            {url: 'http://manifest.googlevideo.com/test', method: 'GET'}]) {
            try { await plugin.prepare(options); } catch { rejected++; }
        }
        return rejected;
        """) as? Int
        XCTAssertEqual(result, 4)
    }

    func testLocalHTTPTransport() async throws {
        try await openApplication()
        let listener = try makeLoopbackListener()
        listener.newConnectionHandler = { connection in
            connection.start(queue: .global())
            connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { _, _, _, _ in
                let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}"
                connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
            }
        }
        defer { listener.cancel() }
        try await startLoopbackListener(listener)
        let port = try XCTUnwrap(listener.port).rawValue
        let result = try await webView.callPageScript("return await Capacitor.Plugins.CapacitorHttp.request({url, method: 'GET', responseType: 'json'})", arguments: ["url": "http://127.0.0.1:\(port)/health"]) as? [String: Any]
        XCTAssertEqual(result?["status"] as? Int, 200)
        XCTAssertEqual((result?["data"] as? [String: Bool])?["ok"], true)
    }

    func testHTTPErrorRedirectHeadersAndRecovery() async throws {
        try await verifyHTTPErrorRedirectHeadersAndRecovery(plugin: "CapacitorHttp")
    }

    func testCancellableHTTPErrorRedirectHeadersAndRecovery() async throws {
        try await verifyHTTPErrorRedirectHeadersAndRecovery(plugin: "IOSHttp")
    }

    private func verifyHTTPErrorRedirectHeadersAndRecovery(plugin: String) async throws {
        try await openApplication()
        _ = try await webView.callPageScript("await testRouter.push('/subscriptions')")
        let listener = try makeLoopbackListener()
        listener.newConnectionHandler = { connection in
            connection.start(queue: .global())
            func receive(_ buffered: Data) {
                connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, complete, error in
                    var request = buffered
                    if let data { request.append(data) }
                    guard let header = String(data: request, encoding: .utf8), header.contains("\r\n\r\n") else {
                        if complete || error != nil || request.count > 16384 { connection.cancel() }
                        else { receive(request) }
                        return
                    }
                    let path = header.components(separatedBy: " ").dropFirst().first ?? ""
                    let response: String
                    if path == "/empty-error" {
                        response = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    } else if path == "/redirect" {
                        response = "HTTP/1.1 302 Found\r\nLocation: /echo\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    } else if path == "/set-cookie" {
                        response = "HTTP/1.1 200 OK\r\nSet-Cookie: opentubex-ios-test=retained; Path=/; SameSite=Lax\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
                    } else if path == "/cookie" {
                        let body = header.contains("opentubex-ios-test=retained") ? "cookie-retained" : "cookie-missing"
                        response = "HTTP/1.1 200 OK\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
                    } else if path == "/cross-redirect" {
                        response = "HTTP/1.1 302 Found\r\nLocation: http://localhost:\(listener.port!.rawValue)/authorization\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    } else if path == "/authorization" {
                        let body = header.lowercased().contains("authorization:") ? "authorization-present" : "authorization-absent"
                        response = "HTTP/1.1 200 OK\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
                    } else if path == "/slow" {
                        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { _, _, _, _ in connection.cancel() }
                        return
                    } else if path == "/disconnect" {
                        connection.cancel()
                        return
                    } else {
                        let found = header.lowercased().contains("x-opentubex-test: retained")
                        let body = found ? "header-retained" : "header-missing"
                        response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
                    }
                    connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
                }
            }
            receive(Data())
        }
        defer { listener.cancel() }
        try await startLoopbackListener(listener)
        let port = try XCTUnwrap(listener.port).rawValue
        let result = try await webView.callPageScript("""
        const nativeRequest = options => Capacitor.Plugins[plugin].request({...options, requestId: crypto.randomUUID()});
        const request = path => nativeRequest({
            url: base + path, method: 'GET', responseType: 'text',
            headers: {'X-OpenTubeX-Test': 'retained'}, connectTimeout: 3000, readTimeout: 3000
        });
        const empty = await request('/empty-error');
        const redirected = await request('/redirect');
        let disconnected = false;
        try { await request('/disconnect'); } catch { disconnected = true; }
        const recovered = await request('/echo');
        await request('/set-cookie');
        const cookie = await request('/cookie');
        const cross = await nativeRequest({url: base + '/cross-redirect', method: 'GET', responseType: 'text', headers: {Authorization: 'Bearer simulator-fixture'}});
        const noRedirect = await nativeRequest({url: base + '/redirect', method: 'GET', disableRedirects: true});
        let timeoutError = '';
        const began = Date.now();
        try { await nativeRequest({url: base + '/slow', method: 'GET', connectTimeout: 500, readTimeout: 500}); }
        catch (error) { timeoutError = error.message; }
        const elapsed = Date.now() - began;
        await Capacitor.Plugins.CapacitorCookies.deleteCookie({url: base, key: 'opentubex-ios-test'});
        const afterTimeout = await request('/echo');
        return {cookie: cookie.data, cross: cross.data, noRedirectStatus: noRedirect.status,
            timeoutError, elapsed, afterTimeout: afterTimeout.status, emptyStatus: empty.status, emptyBody: empty.data,
            redirectStatus: redirected.status, redirectBody: redirected.data,
            disconnected, recoveredStatus: recovered.status, recoveredBody: recovered.data};
        """, arguments: ["base": "http://127.0.0.1:\(port)", "plugin": plugin]) as? [String: Any]
        XCTAssertEqual(result?["emptyStatus"] as? Int, 503)
        XCTAssertEqual(result?["emptyBody"] as? String, "")
        XCTAssertEqual(result?["redirectStatus"] as? Int, 200)
        XCTAssertEqual(result?["redirectBody"] as? String, "header-retained")
        XCTAssertEqual(result?["disconnected"] as? Bool, true)
        XCTAssertEqual(result?["recoveredStatus"] as? Int, 200)
        XCTAssertEqual(result?["recoveredBody"] as? String, "header-retained")
        // IOSHttp carries the YouTube API requests, which must not link loads
        // through stored cookies.
        XCTAssertEqual(result?["cookie"] as? String, plugin == "IOSHttp" ? "cookie-missing" : "cookie-retained")
        XCTAssertEqual(result?["cross"] as? String, "authorization-absent")
        XCTAssertEqual(result?["noRedirectStatus"] as? Int, 302)
        XCTAssertTrue((result?["timeoutError"] as? String)?.lowercased().contains("timed out") == true, String(describing: result?["timeoutError"]))
        if plugin == "IOSHttp" {
            // JavaScript recognizes the prefix, not URLSession's localized text.
            XCTAssertTrue((result?["timeoutError"] as? String)?.hasPrefix("Failed to fetch: ") == true)
        }
        XCTAssertLessThan(try XCTUnwrap(result?["elapsed"] as? Double), 10000)
        XCTAssertEqual(result?["afterTimeout"] as? Int, 200)
    }

    func testStreamingCancellationClosesNativeConnection() async throws {
        try await openApplication()
        _ = try await webView.callPageScript("await testRouter.push('/subscriptions')")
        for cancelThroughBridge in [true, false] {
            let listener = try makeLoopbackListener()
            let started = expectation(description: "Partial response sent")
            let closed = expectation(description: "Native transport closed connection")
            listener.newConnectionHandler = { connection in
                connection.start(queue: .global())
                connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { _, _, _, _ in
                    let response = "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 10000\r\nConnection: close\r\n\r\nabc"
                    connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in
                        started.fulfill()
                        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { _, _, complete, error in
                            if complete || error != nil { closed.fulfill() }
                            connection.cancel()
                        }
                    })
                }
            }
            defer { listener.cancel() }
            try await startLoopbackListener(listener)
            let port = try XCTUnwrap(listener.port).rawValue
            // Inject a loopback request into the transport; production plugin URL
            // validation remains covered separately and still forbids this origin.
            let url = try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/stream"))
            let id = IOSNetwork.shared.prepare(URLRequest(url: url))
            _ = try await webView.callPageScript("""
            window.iosCancelResult = 'pending';
            window.iosAbortController = new AbortController();
            fetch('/_opentubex_sabr/' + id, {signal: iosAbortController.signal})
                .then(response => response.arrayBuffer())
                .then(() => iosCancelResult = 'completed')
                .catch(() => iosCancelResult = 'cancelled');
            """, arguments: ["id": id])
            await fulfillment(of: [started], timeout: 10)
            if cancelThroughBridge {
                _ = try await webView.callPageScript("await Capacitor.Plugins.SabrHttp.abort({requestId: id})", arguments: ["id": id])
            } else {
                _ = try await evaluate("iosAbortController.abort(); true")
            }
            try await wait("iosCancelResult === 'cancelled'", timeout: 10)
            await fulfillment(of: [closed], timeout: 10)
        }
    }

    func testAPICancellationClosesNativeConnection() async throws {
        try await openApplication()
        _ = try await webView.callPageScript("await testRouter.push('/subscriptions')")
        for immediate in [false, true] {
            let listener = try makeLoopbackListener()
            let started = immediate ? nil : expectation(description: "Partial response sent")
            let closed = immediate ? nil : expectation(description: "Native transport closed connection")
            listener.newConnectionHandler = { connection in
                connection.start(queue: .global())
                connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, _, _ in
                    if String(data: data ?? Data(), encoding: .utf8)?.contains("/recover ") == true {
                        connection.send(content: Data("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".utf8), completion: .contentProcessed { _ in connection.cancel() })
                        return
                    }
                    let response = "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 10000\r\nConnection: close\r\n\r\nabc"
                    connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in
                        started?.fulfill()
                        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { _, _, complete, error in
                            if complete || error != nil { closed?.fulfill() }
                            connection.cancel()
                        }
                    })
                }
            }
            defer { listener.cancel() }
            try await startLoopbackListener(listener)
            let port = try XCTUnwrap(listener.port).rawValue
            let id = UUID().uuidString
            _ = try await webView.callPageScript("""
            window.iosCancelResult = 'pending';
            Capacitor.Plugins.IOSHttp.request({requestId: id, url, method: 'GET', responseType: 'text'})
                .then(() => iosCancelResult = 'completed')
                .catch(() => iosCancelResult = 'cancelled');
            if (immediate) await Capacitor.Plugins.IOSHttp.abort({requestId: id});
            """, arguments: ["id": id, "url": "http://127.0.0.1:\(port)/api", "immediate": immediate])
            if !immediate {
                await fulfillment(of: [try XCTUnwrap(started)], timeout: 10)
                _ = try await webView.callPageScript("await Capacitor.Plugins.IOSHttp.abort({requestId: id})", arguments: ["id": id])
            }
            try await wait("iosCancelResult === 'cancelled'", timeout: 10)
            if !immediate { await fulfillment(of: [try XCTUnwrap(closed)], timeout: 10) }
            // A cancelled task must not poison the next request's URLSession.
            let recovered = try await webView.callPageScript("""
            return await Capacitor.Plugins.IOSHttp.request({requestId: crypto.randomUUID(), url, method: 'GET'});
            """, arguments: ["url": "http://127.0.0.1:\(port)/recover"]) as? [String: Any]
            XCTAssertEqual(recovered?["data"] as? String, "ok")
        }
    }

    func testInvidiousBrowsing() async throws {
        try await openApplication()
        let listener = try makeLoopbackListener()
        listener.newConnectionHandler = { connection in
            connection.start(queue: .global())
            connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { data, _, _, _ in
                let path = String(data: data ?? Data(), encoding: .utf8)?.components(separatedBy: " ").dropFirst().first ?? ""
                let base = "http://127.0.0.1:\(listener.port!.rawValue)"
                let image: [[String: Any]] = [["url": base + "/image", "width": 176, "height": 176]]
                let video: [String: Any] = ["type": "video", "title": "iOS Invidious fixture", "videoId": "jNQXAC9IVRw",
                    "author": "iOS fixture channel", "authorId": "UCaaaaaaaaaaaaaaaaaaaaaa", "authorUrl": "/channel/UCaaaaaaaaaaaaaaaaaaaaaa",
                    "videoThumbnails": image, "description": "", "viewCount": 10, "lengthSeconds": 19, "published": 1_700_000_000,
                    "publishedText": "2 years ago", "liveNow": false, "isUpcoming": false]
                let json: Any
                if path.hasPrefix("/api/v1/search") {
                    json = [video]
                } else if path.hasPrefix("/api/v1/channels") {
                    json = ["author": "iOS fixture channel", "authorId": "UCaaaaaaaaaaaaaaaaaaaaaa", "authorBanners": [],
                        "authorThumbnails": image, "subCount": 1, "totalViews": 2, "joined": 1_700_000_000,
                        "autoGenerated": false, "isFamilyFriendly": true, "description": "Fixture channel description", "descriptionHtml": "",
                        "allowedRegions": [], "tabs": [], "latestVideos": [], "relatedChannels": []] as [String: Any]
                } else if path.hasPrefix("/api/v1/playlists") {
                    json = ["title": "iOS fixture playlist", "playlistId": "PLaaaaaaaaaaaaaaaaaaaaaa", "author": "iOS fixture channel",
                        "authorId": "UCaaaaaaaaaaaaaaaaaaaaaa", "authorThumbnails": image, "description": "", "descriptionHtml": "",
                        "videoCount": 0, "viewCount": 0, "updated": 1_756_000_000, "videos": []] as [String: Any]
                } else { json = [] }
                let isImage = path == "/image"
                let body = isImage ? Data("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"176\" height=\"176\"><rect width=\"176\" height=\"176\" fill=\"green\"/></svg>".utf8) : (try! JSONSerialization.data(withJSONObject: json))
                let header = "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: \(isImage ? "image/svg+xml" : "application/json")\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
                connection.send(content: Data(header.utf8) + body, completion: .contentProcessed { _ in connection.cancel() })
            }
        }
        defer { listener.cancel() }
        try await startLoopbackListener(listener)
        let base = "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)"
        _ = try await webView.callPageScript("""
        window.invidiousBefore = {backend: testStore.getters.getBackendPreference, instance: testStore.getters.getDefaultInvidiousInstance};
        await testStore.dispatch('hideSettingsWindow');
        await testStore.dispatch('updateDefaultInvidiousInstance', base);
        await testStore.dispatch('updateBackendPreference', 'invidious');
        await testRouter.push('/search/ios-invidious-fixture');
        """, arguments: ["base": base])
        do {
            try await wait("document.body.innerText.includes('iOS Invidious fixture')", timeout: 20)
            let thumbnailLabel = try await evaluate("document.querySelector('.ft-list-video .thumbnailLink')?.getAttribute('aria-label')") as? String
            XCTAssertEqual(thumbnailLabel, "iOS Invidious fixture")

            _ = try await webView.callPageScript("await testRouter.push('/channel/UCaaaaaaaaaaaaaaaaaaaaaa')")
            try await wait("document.querySelector('.channelDetails .name')?.textContent.includes('iOS fixture channel') === true", timeout: 20)
            try await wait("document.querySelector('.channelDetails img.thumbnail')?.naturalWidth > 0", timeout: 20)
            _ = try await webView.callPageScript("await testRouter.push('/playlist/PLaaaaaaaaaaaaaaaaaaaaaa')")
            try await wait("document.querySelector('.playlistTitle')?.textContent.includes('iOS fixture playlist') === true", timeout: 20)
        } catch {
            _ = try? await webView.callPageScript("await testStore.dispatch('updateBackendPreference', invidiousBefore.backend); await testStore.dispatch('updateDefaultInvidiousInstance', invidiousBefore.instance)")
            throw error
        }
        _ = try await webView.callPageScript("""
        await testStore.dispatch('updateBackendPreference', invidiousBefore.backend);
        await testStore.dispatch('updateDefaultInvidiousInstance', invidiousBefore.instance);
        await testRouter.push('/subscriptions');
        """)
    }
}

private final class RecordingPoTokenNavigationGuard: PoTokenNavigationGuard {
    private let didDecide: (URL, WKNavigationActionPolicy) -> Void

    init(didDecide: @escaping (URL, WKNavigationActionPolicy) -> Void) {
        self.didDecide = didDecide
        super.init()
    }

    override func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                          decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        super.webView(webView, decidePolicyFor: navigationAction) { [didDecide] policy in
            if let url = navigationAction.request.url { didDecide(url, policy) }
            decisionHandler(policy)
        }
    }
}

private final class RecordingSchemeTask: NSObject, WKURLSchemeTask {
    let request: URLRequest
    let done: XCTestExpectation
    var data = Data()
    var error: Error?
    init(url: URL, done: XCTestExpectation) { self.request = URLRequest(url: url); self.done = done }
    func didReceive(_ response: URLResponse) {}
    func didReceive(_ bytes: Data) { data.append(bytes) }
    func didFinish() { done.fulfill() }
    func didFailWithError(_ error: Error) { self.error = error; done.fulfill() }
}

/// Answers the requests of a test's session, which only reach Rumble hosts.
private final class RumbleStubProtocol: URLProtocol {
    static var respond: (URLRequest) -> (Int, [String: String], String) = { _ in (500, [:], "") }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (status, headers, body) = Self.respond(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
