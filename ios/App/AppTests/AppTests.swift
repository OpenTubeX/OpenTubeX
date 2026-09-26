import XCTest
import WebKit
import MediaPlayer
import Network
@testable import App

@MainActor
final class AppTests: XCTestCase {
    func testBackgroundPreparationEvent() async throws {
        try await openApplication()
        _ = try await evaluate("""
            window.iosPreparedForBackground = false;
            window.addEventListener('opentubex:prepare-background', () => {
                window.iosPreparedForBackground = true;
            }, { once: true });
            """)
        let scene = try XCTUnwrap(webView.window?.windowScene)
        let delegate = try XCTUnwrap(scene.delegate as? SceneDelegate)
        delegate.sceneWillResignActive(scene)
        try await wait("window.iosPreparedForBackground === true")
    }

    func testStorageUsageDoesNotDoubleCountCache() async throws {
        try await openApplication()
        func usage() async throws -> [String: Double] {
            let value = try await webView.callAsyncJavaScript("return await Capacitor.Plugins.IOSStorage.getUsage()", arguments: [:], in: nil, contentWorld: .page)
            return try XCTUnwrap(value as? [String: Double])
        }
        let before = try await usage()
        let directory = try XCTUnwrap(FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first)
        let file = directory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: file) }
        let size = 8 * 1024 * 1024
        try Data(repeating: 42, count: size).write(to: file)
        let after = try await usage()
        XCTAssertEqual(try XCTUnwrap(after["cacheBytes"]) - XCTUnwrap(before["cacheBytes"]), Double(size), accuracy: 1024 * 1024)
        XCTAssertEqual(try XCTUnwrap(after["appDataBytes"]) - XCTUnwrap(before["appDataBytes"]), 0, accuracy: 1024 * 1024)
    }

    func testMediaRequestOrigins() throws {
        XCTAssertTrue(IOSNetwork.isMediaURL(try XCTUnwrap(URL(string: "https://rr1.googlevideo.com/videoplayback"))))
        for address in ["http://rr1.googlevideo.com/videoplayback", "https://googlevideo.com.attacker.invalid/", "https://notgooglevideo.com/", "https://user:password@rr1.googlevideo.com/"] {
            XCTAssertFalse(IOSNetwork.isMediaURL(try XCTUnwrap(URL(string: address))), address)
        }
    }

    private var webView: WKWebView {
        get throws {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let controller = scenes.flatMap(\.windows).compactMap { $0.rootViewController as? OpenTubeXViewController }.first
            return try XCTUnwrap(controller?.webView)
        }
    }

    private func evaluate(_ script: String) async throws -> Any? {
        try await webView.evaluateJavaScript(script)
    }

    private func wait(_ script: String, timeout: TimeInterval = 60) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if (try? await evaluate(script)) as? Bool == true { return }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        let text = try? await evaluate("document.body.innerText")
        let messages = try? await evaluate("JSON.stringify(window.iosTestMessages)")
        let media = try? await evaluate("JSON.stringify(Array.from(document.querySelectorAll('video')).map(video => ({time: video.currentTime, paused: video.paused, seeking: video.seeking, ready: video.readyState, rate: video.playbackRate, buffered: Array.from({length: video.buffered.length}, (_, i) => [video.buffered.start(i), video.buffered.end(i)]), width: video.getBoundingClientRect().width, error: video.error?.message, held: video === window.iosSustainedPlayer})))")
        if let screenshot = try? await webView.takeSnapshot(configuration: nil) {
            let attachment = XCTAttachment(image: screenshot)
            attachment.name = "iOS failure"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTFail("Timed out: \(script)\nPage: \(String(describing: text))\nConsole: \(String(describing: messages))\nMedia: \(String(describing: media))")
        throw URLError(.timedOut)
    }

    private func waitForNative(_ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(60)
        while !condition() {
            guard Date() < deadline else {
                XCTFail("Native presentation did not reach the expected state")
                throw URLError(.timedOut)
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    private func dismiss(_ controller: UIViewController) async throws {
        // UIKit ignores dismissal while the presentation transition is still running.
        try await waitForNative { !controller.isBeingPresented && controller.transitionCoordinator == nil }
        controller.dismiss(animated: false)
        try await waitForNative { controller.presentingViewController == nil && !controller.isBeingDismissed }
    }

    override func tearDown() async throws {
        if let controller = try? webView.window?.rootViewController,
           let presented = controller.presentedViewController {
            if let picker = presented as? UIDocumentPickerViewController {
                picker.delegate?.documentPickerWasCancelled?(picker)
            }
            try await dismiss(presented)
        }
        try await super.tearDown()
    }

    private func openApplication() async throws {
        try await wait("!!document.querySelector('#app')?.__vue_app__")
        _ = try await evaluate("window.testStore = document.querySelector('#app').__vue_app__.config.globalProperties.$store; window.testRouter = document.querySelector('#app').__vue_app__.config.globalProperties.$router; true")
        _ = try await evaluate("if (!window.iosTestMessages) { window.iosTestMessages = []; for (const level of ['warn', 'error']) { const original = console[level]; console[level] = (...args) => { iosTestMessages.push(args.map(value => { try { return value instanceof Error ? String(value.stack || value) : typeof value === 'string' ? value : JSON.stringify(value) } catch { return String(value) } }).join(' ')); original(...args); }; } } true")
        try await wait("!!document.querySelector('#app .app')")
        let platform = try await evaluate("Capacitor.getPlatform()") as? String
        XCTAssertEqual(platform, "ios")
        let plugin = try await evaluate("Capacitor.isPluginAvailable('PoToken') && Capacitor.isPluginAvailable('SabrHttp') && Capacitor.isPluginAvailable('IOSStorage')") as? Bool
        XCTAssertEqual(plugin, true)
        // Dismiss the first-run tutorial through its real controls if present.
        _ = try await evaluate("Array.from(document.querySelectorAll('button')).find(b => /^(Skip|Überspringen)$/.test(b.innerText.trim()))?.click(); true")
    }

    func testApplicationOffline() async throws {
        try await openApplication()
        _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateRememberHistory', false)", arguments: [:], in: nil, contentWorld: .page)
        _ = try await evaluate("testRouter.push('/subscriptions'); localStorage.setItem('ios-test-persistence', 'retained'); true")
        let cleared = try await webView.callAsyncJavaScript("return (await Capacitor.Plugins.IOSStorage.clearCache()).cleared", arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(cleared, true)
        _ = try await evaluate("window.iosTestReloadMarker = true")
        try webView.reload()
        try await wait("window.iosTestReloadMarker !== true")
        try await openApplication()
        let persisted = try await evaluate("localStorage.getItem('ios-test-persistence')") as? String
        XCTAssertEqual(persisted, "retained")
        try await wait("testStore.getters.getRememberHistory === false")
        _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateRememberHistory', true)", arguments: [:], in: nil, contentWorld: .page)
        _ = try await evaluate("localStorage.removeItem('ios-test-persistence'); true")
        let attachment = XCTAttachment(image: try await webView.takeSnapshot(configuration: nil))
        attachment.name = "iOS subscriptions"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testUserRecordsSurviveReloadAndCacheClear() async throws {
        try await openApplication()
        let id = "ios-test-" + UUID().uuidString
        let videoId = String(UUID().uuidString.prefix(11))
        let arguments: [String: Any] = ["id": id, "videoId": videoId]
        _ = try await webView.callAsyncJavaScript("""
        await testRouter.push('/subscriptions');
        const video = {videoId, title: 'iOS Grüße 日本語', author: 'Fixture', authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
            published: Date.now(), lengthSeconds: 100, watchProgress: 37, isLive: false, isWatched: false, timeWatched: Date.now(), type: 'video'};
        await testStore.dispatch('createProfile', {_id: id, name: 'iOS Grüße 日本語', bgColor: '#112233',
            subscriptions: [{id: video.authorId, name: 'Fixture channel', thumbnail: ''}]});
        await testStore.dispatch('addPlaylist', {_id: id, playlistName: 'iOS Grüße 日本語', description: 'Persistence fixture', videos: [video]});
        await testStore.dispatch('updateHistory', video);
        await testStore.dispatch('updateSearchHistoryEntry', {_id: id, query: 'iOS Grüße 日本語 ' + id, lastUpdatedAt: Date.now()});
        localStorage.setItem(id, 'retained');
        await Capacitor.Plugins.IOSStorage.clearCache();
        """, arguments: arguments, in: nil, contentWorld: .page)
        _ = try await evaluate("window.iosRecordReloadMarker = true")
        try webView.reload()
        try await wait("window.iosRecordReloadMarker !== true")
        try await openApplication()
        let restored = try await webView.callAsyncJavaScript("""
        await Promise.all(['grabAllProfiles', 'grabAllPlaylists', 'grabHistory', 'grabSearchHistoryEntries'].map(action => testStore.dispatch(action)));
        const profile = testStore.getters.getProfileList.find(profile => profile._id === id);
        const playlist = testStore.getters.getPlaylist(id);
        const history = testStore.getters.getHistoryCacheById[videoId];
        return {profile: profile?.name, subscription: profile?.subscriptions[0]?.id,
            playlist: playlist?.playlistName, video: playlist?.videos[0]?.videoId,
            progress: history?.watchProgress, title: history?.title,
            search: testStore.getters.getSearchHistoryEntries.some(entry => entry._id === id), local: localStorage.getItem(id)};
        """, arguments: arguments, in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(restored?["profile"] as? String, "iOS Grüße 日本語")
        XCTAssertEqual(restored?["subscription"] as? String, "UCaaaaaaaaaaaaaaaaaaaaaa")
        XCTAssertEqual(restored?["playlist"] as? String, "iOS Grüße 日本語")
        XCTAssertEqual(restored?["video"] as? String, videoId)
        XCTAssertEqual(restored?["progress"] as? Int, 37)
        XCTAssertEqual(restored?["title"] as? String, "iOS Grüße 日本語")
        XCTAssertEqual(restored?["search"] as? Bool, true)
        XCTAssertEqual(restored?["local"] as? String, "retained")
        _ = try await webView.callAsyncJavaScript("""
        await testStore.dispatch('removeProfile', id);
        await testStore.dispatch('removePlaylist', id);
        await testStore.dispatch('removeFromHistory', videoId);
        await testStore.dispatch('removeSearchHistoryEntry', id);
        localStorage.removeItem(id);
        """, arguments: arguments, in: nil, contentWorld: .page)
    }

    func testPlayerSandbox() async throws {
        try await openApplication()
        let result = try await webView.callAsyncJavaScript("""
        const worker = new Worker('/player-script-worker.js');
        try {
            return await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Worker timed out')), 15000);
                worker.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); };
                worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
                worker.postMessage({ id: 1, code: 'return 42' });
            });
        } finally { worker.terminate(); }
        """, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(result?["result"] as? Int, 42)
    }

    func testCustomURLRouting() async throws {
        try await openApplication()
        _ = try await evaluate("testRouter.push('/subscriptions'); true")
        try await wait("testRouter.currentRoute.value.path === '/subscriptions'")
        let url = try XCTUnwrap(URL(string: "opentubex://https://www.youtube.com/feed/history"))
        let opened = await UIApplication.shared.open(url)
        XCTAssertTrue(opened)
        try await wait("testRouter.currentRoute.value.path === '/history'")
    }

    func testPlayerSandboxStackLimit() async throws {
        try await openApplication()
        let result = try await webView.callAsyncJavaScript("""
        const worker = new Worker('/player-script-worker.js');
        const run = (id, code) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Worker timed out')), 15000);
            worker.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); };
            worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
            worker.postMessage({ id, code });
        });
        try {
            const failure = await run(1, 'function recurse() { return 1 + recurse() } return recurse()');
            const next = await run(2, 'return 42');
            return { error: failure.error, next: next.result };
        } finally { worker.terminate(); }
        """, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertTrue((result?["error"] as? String)?.contains("InternalError: stack overflow") == true, String(describing: result))
        XCTAssertEqual(result?["next"] as? Int, 42)
    }

    func testNativeMediaRequestMethods() async throws {
        try await openApplication()
        let result = try await webView.callAsyncJavaScript("""
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
        """, arguments: [:], in: nil, contentWorld: .page) as? Int
        XCTAssertEqual(result, 4)
    }

    func testLocalHTTPTransport() async throws {
        try await openApplication()
        let listener = try NWListener(using: .tcp, on: .any)
        let ready = expectation(description: "Local HTTP server ready")
        listener.stateUpdateHandler = { state in
            if case .ready = state { ready.fulfill() }
        }
        listener.newConnectionHandler = { connection in
            connection.start(queue: .global())
            connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { _, _, _, _ in
                let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}"
                connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
            }
        }
        listener.start(queue: .global())
        defer { listener.cancel() }
        await fulfillment(of: [ready], timeout: 10)
        let port = try XCTUnwrap(listener.port).rawValue
        let result = try await webView.callAsyncJavaScript("return await Capacitor.Plugins.CapacitorHttp.request({url, method: 'GET', responseType: 'json'})", arguments: ["url": "http://127.0.0.1:\(port)/health"], in: nil, contentWorld: .page) as? [String: Any]
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
        _ = try await webView.callAsyncJavaScript("await testRouter.push('/subscriptions')", arguments: [:], in: nil, contentWorld: .page)
        let listener = try NWListener(using: .tcp, on: .any)
        let ready = expectation(description: "HTTP edge-case server ready")
        listener.stateUpdateHandler = { state in
            if case .ready = state { ready.fulfill() }
        }
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
        listener.start(queue: .global())
        defer { listener.cancel() }
        await fulfillment(of: [ready], timeout: 10)
        let port = try XCTUnwrap(listener.port).rawValue
        let result = try await webView.callAsyncJavaScript("""
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
        """, arguments: ["base": "http://127.0.0.1:\(port)", "plugin": plugin], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(result?["emptyStatus"] as? Int, 503)
        XCTAssertEqual(result?["emptyBody"] as? String, "")
        XCTAssertEqual(result?["redirectStatus"] as? Int, 200)
        XCTAssertEqual(result?["redirectBody"] as? String, "header-retained")
        XCTAssertEqual(result?["disconnected"] as? Bool, true)
        XCTAssertEqual(result?["recoveredStatus"] as? Int, 200)
        XCTAssertEqual(result?["recoveredBody"] as? String, "header-retained")
        XCTAssertEqual(result?["cookie"] as? String, "cookie-retained")
        XCTAssertEqual(result?["cross"] as? String, "authorization-absent")
        XCTAssertEqual(result?["noRedirectStatus"] as? Int, 302)
        XCTAssertTrue((result?["timeoutError"] as? String)?.lowercased().contains("timed out") == true, String(describing: result?["timeoutError"]))
        XCTAssertLessThan(try XCTUnwrap(result?["elapsed"] as? Double), 10000)
        XCTAssertEqual(result?["afterTimeout"] as? Int, 200)
    }

    func testStreamingCancellationClosesNativeConnection() async throws {
        try await openApplication()
        _ = try await webView.callAsyncJavaScript("await testRouter.push('/subscriptions')", arguments: [:], in: nil, contentWorld: .page)
        for cancelThroughBridge in [true, false] {
            let listener = try NWListener(using: .tcp, on: .any)
            let ready = expectation(description: "Cancellation server ready")
            let started = expectation(description: "Partial response sent")
            let closed = expectation(description: "Native transport closed connection")
            listener.stateUpdateHandler = { state in
                if case .ready = state { ready.fulfill() }
            }
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
            listener.start(queue: .global())
            defer { listener.cancel() }
            await fulfillment(of: [ready], timeout: 10)
            let port = try XCTUnwrap(listener.port).rawValue
            // Inject a loopback request into the transport; production plugin URL
            // validation remains covered separately and still forbids this origin.
            let url = try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/stream"))
            let id = IOSNetwork.shared.prepare(URLRequest(url: url))
            _ = try await webView.callAsyncJavaScript("""
            window.iosCancelResult = 'pending';
            window.iosAbortController = new AbortController();
            fetch('/_opentubex_sabr/' + id, {signal: iosAbortController.signal})
                .then(response => response.arrayBuffer())
                .then(() => iosCancelResult = 'completed')
                .catch(() => iosCancelResult = 'cancelled');
            """, arguments: ["id": id], in: nil, contentWorld: .page)
            await fulfillment(of: [started], timeout: 10)
            if cancelThroughBridge {
                _ = try await webView.callAsyncJavaScript("await Capacitor.Plugins.SabrHttp.abort({requestId: id})", arguments: ["id": id], in: nil, contentWorld: .page)
            } else {
                _ = try await evaluate("iosAbortController.abort(); true")
            }
            try await wait("iosCancelResult === 'cancelled'", timeout: 10)
            await fulfillment(of: [closed], timeout: 10)
        }
    }

    func testAPICancellationClosesNativeConnection() async throws {
        try await openApplication()
        _ = try await webView.callAsyncJavaScript("await testRouter.push('/subscriptions')", arguments: [:], in: nil, contentWorld: .page)
        for immediate in [false, true] {
            let listener = try NWListener(using: .tcp, on: .any)
            let ready = expectation(description: "Cancellation server ready")
            let started = immediate ? nil : expectation(description: "Partial response sent")
            let closed = immediate ? nil : expectation(description: "Native transport closed connection")
            listener.stateUpdateHandler = { state in
                if case .ready = state { ready.fulfill() }
            }
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
            listener.start(queue: .global())
            defer { listener.cancel() }
            await fulfillment(of: [ready], timeout: 10)
            let port = try XCTUnwrap(listener.port).rawValue
            let id = UUID().uuidString
            _ = try await webView.callAsyncJavaScript("""
            window.iosCancelResult = 'pending';
            Capacitor.Plugins.IOSHttp.request({requestId: id, url, method: 'GET', responseType: 'text'})
                .then(() => iosCancelResult = 'completed')
                .catch(() => iosCancelResult = 'cancelled');
            if (immediate) await Capacitor.Plugins.IOSHttp.abort({requestId: id});
            """, arguments: ["id": id, "url": "http://127.0.0.1:\(port)/api", "immediate": immediate], in: nil, contentWorld: .page)
            if !immediate {
                await fulfillment(of: [try XCTUnwrap(started)], timeout: 10)
                _ = try await webView.callAsyncJavaScript("await Capacitor.Plugins.IOSHttp.abort({requestId: id})", arguments: ["id": id], in: nil, contentWorld: .page)
            }
            try await wait("iosCancelResult === 'cancelled'", timeout: 10)
            if !immediate { await fulfillment(of: [try XCTUnwrap(closed)], timeout: 10) }
            // A cancelled task must not poison the next request's URLSession.
            let recovered = try await webView.callAsyncJavaScript("""
            return await Capacitor.Plugins.IOSHttp.request({requestId: crypto.randomUUID(), url, method: 'GET'});
            """, arguments: ["url": "http://127.0.0.1:\(port)/recover"], in: nil, contentWorld: .page) as? [String: Any]
            XCTAssertEqual(recovered?["data"] as? String, "ok")
        }
    }

    func testInvidiousBrowsing() async throws {
        try await openApplication()
        let listener = try NWListener(using: .tcp, on: .any)
        let ready = expectation(description: "Invidious fixture ready")
        listener.stateUpdateHandler = { if case .ready = $0 { ready.fulfill() } }
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
        listener.start(queue: .global())
        defer { listener.cancel() }
        await fulfillment(of: [ready], timeout: 10)
        let base = "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)"
        _ = try await webView.callAsyncJavaScript("""
        window.invidiousBefore = {backend: testStore.getters.getBackendPreference, instance: testStore.getters.getDefaultInvidiousInstance};
        await testStore.dispatch('hideSettingsWindow');
        await testStore.dispatch('updateDefaultInvidiousInstance', base);
        await testStore.dispatch('updateBackendPreference', 'invidious');
        await testRouter.push('/search/ios-invidious-fixture');
        """, arguments: ["base": base], in: nil, contentWorld: .page)
        do {
            try await wait("document.body.innerText.includes('iOS Invidious fixture')", timeout: 20)
            _ = try await webView.callAsyncJavaScript("await testRouter.push('/channel/UCaaaaaaaaaaaaaaaaaaaaaa')", arguments: [:], in: nil, contentWorld: .page)
            try await wait("document.querySelector('.channelDetails .name')?.textContent.includes('iOS fixture channel') === true", timeout: 20)
            try await wait("document.querySelector('.channelDetails img.thumbnail')?.naturalWidth > 0", timeout: 20)
            _ = try await webView.callAsyncJavaScript("await testRouter.push('/playlist/PLaaaaaaaaaaaaaaaaaaaaaa')", arguments: [:], in: nil, contentWorld: .page)
            try await wait("document.querySelector('.playlistTitle')?.textContent.includes('iOS fixture playlist') === true", timeout: 20)
        } catch {
            _ = try? await webView.callAsyncJavaScript("await testStore.dispatch('updateBackendPreference', invidiousBefore.backend); await testStore.dispatch('updateDefaultInvidiousInstance', invidiousBefore.instance)", arguments: [:], in: nil, contentWorld: .page)
            throw error
        }
        _ = try await webView.callAsyncJavaScript("""
        await testStore.dispatch('updateBackendPreference', invidiousBefore.backend);
        await testStore.dispatch('updateDefaultInvidiousInstance', invidiousBefore.instance);
        await testRouter.push('/subscriptions');
        """, arguments: [:], in: nil, contentWorld: .page)
    }

    func testClipboardAndSceneShortcuts() async throws {
        try await openApplication()
        let previous = UIPasteboard.general.items
        defer { UIPasteboard.general.items = previous }
        let copied = try await webView.callAsyncJavaScript("await Capacitor.Plugins.Clipboard.write({text: 'OpenTubeX Grüße 日本語'}); return await Capacitor.Plugins.Clipboard.read()", arguments: [:], in: nil, contentWorld: .page) as? [String: String]
        XCTAssertEqual(copied?["value"], "OpenTubeX Grüße 日本語")
        XCTAssertEqual(UIPasteboard.general.string, "OpenTubeX Grüße 日本語")
        let scene = try XCTUnwrap(webView.window?.windowScene)
        let delegate = try XCTUnwrap(scene.delegate as? SceneDelegate)
        let shortcuts = UIApplication.shared.shortcutItems ?? []
        XCTAssertFalse(shortcuts.contains { $0.type == "downloads" })
        for type in ["history", "userplaylists", "subscriptions"] {
            let shortcut = try XCTUnwrap(shortcuts.first { $0.type == type })
            var handled = false
            delegate.windowScene(scene, performActionFor: shortcut) { handled = $0 }
            XCTAssertTrue(handled)
            try await wait("testRouter.currentRoute.value.path === '/\(type)'")
        }
    }

    func testFilePickerRejectsOtherPresentedDialog() async throws {
        try await openApplication()
        let controller = try XCTUnwrap(webView.window?.rootViewController as? OpenTubeXViewController)
        let dialog = UIAlertController(title: "Native modal fixture", message: "Another dialog owns presentation", preferredStyle: .alert)
        try await waitForNative { controller.presentedViewController == nil }
        controller.present(dialog, animated: false)
        try await waitForNative { dialog.presentingViewController != nil && !dialog.isBeingPresented }
        let result = try await webView.callAsyncJavaScript("""
        return await Promise.race([
            Capacitor.Plugins.IOSStorage.saveFile({fileName: 'modal-test.json', data: btoa('{}')}).then(() => 'resolved').catch(() => 'rejected'),
            new Promise(resolve => setTimeout(() => resolve('pending'), 1000))
        ]);
        """, arguments: [:], in: nil, contentWorld: .page) as? String
        // Clean up the pending fixture too if the rejection regression fails.
        if result == "pending" {
            (controller.bridge?.plugin(withName: "IOSStorage") as? IOSStoragePlugin)?.documentPickerWasCancelled(UIDocumentPickerViewController(forOpeningContentTypes: []))
        }
        try await dismiss(dialog)
        XCTAssertEqual(result, "rejected", "File export must reject instead of hanging behind a different native dialog")
        let files = try XCTUnwrap(FileManager.default.enumerator(at: FileManager.default.temporaryDirectory, includingPropertiesForKeys: nil))
        XCTAssertFalse(files.compactMap { $0 as? URL }.contains { $0.lastPathComponent == "modal-test.json" })
        _ = try await evaluate("window.iosModalRetry = 'pending'; Capacitor.Plugins.IOSStorage.chooseDirectory().then(result => iosModalRetry = result.path); true")
        try await waitForNative { controller.presentedViewController != nil }
        let picker = try XCTUnwrap(controller.presentedViewController as? UIDocumentPickerViewController)
        picker.delegate?.documentPickerWasCancelled?(picker)
        try await dismiss(picker)
        try await wait("iosModalRetry === null")
    }

    func testNativeServices() async throws {
        try await openApplication()
        let keyboard = try await webView.callAsyncJavaScript("return (await Capacitor.Plugins.IOSUi.getHardwareKeyboardState()).attached", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertNotNil(keyboard as? Bool)
        let usage = try await webView.callAsyncJavaScript("return await Capacitor.Plugins.IOSStorage.getUsage()", arguments: [:], in: nil, contentWorld: .page) as? [String: Double]
        XCTAssertGreaterThan(try XCTUnwrap(usage?["appDataBytes"]), 0)
        let image = try await webView.callAsyncJavaScript("return (await Capacitor.Plugins.Screenshot.take({ width: 320 })).dataUrl", arguments: [:], in: nil, contentWorld: .page) as? String
        XCTAssertTrue(image?.hasPrefix("data:image/jpeg;base64,") == true)
        _ = try await webView.callAsyncJavaScript("await Capacitor.Plugins.IOSMediaSession.update({state: {title: 'Native media test', duration: 120, position: 12, playbackState: 'paused', actions: ['play', 'seekto']}})", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyTitle] as? String, "Native media test")
        XCTAssertTrue(MPRemoteCommandCenter.shared().playCommand.isEnabled)
        XCTAssertFalse(MPRemoteCommandCenter.shared().nextTrackCommand.isEnabled)
        _ = try await webView.callAsyncJavaScript("await Capacitor.Plugins.IOSMediaSession.clear()", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertNil(MPNowPlayingInfoCenter.default().nowPlayingInfo)
        XCTAssertFalse(MPRemoteCommandCenter.shared().playCommand.isEnabled)
    }

    func testTouchSearchDismissal() async throws {
        try await openApplication()
        _ = try await webView.callAsyncJavaScript("await testStore.dispatch('hideSettingsWindow')", arguments: [:], in: nil, contentWorld: .page)
        try await wait("!document.querySelector('.settingsWindow')")
        _ = try await webView.callAsyncJavaScript("await testRouter.push('/subscriptions')", arguments: [:], in: nil, contentWorld: .page)
        // Phone layouts keep the input hidden until the search button is tapped.
        _ = try await evaluate("if (!document.querySelector('.topNav input').getClientRects().length) document.querySelector('.navSearchButton').click(); true")
        try await wait("document.querySelector('.topNav input').getClientRects().length > 0")
        _ = try await evaluate("document.querySelector('.topNav input').focus(); true")
        try await wait("document.activeElement?.matches('.topNav input') === true")
        _ = try await evaluate("document.querySelector('.routerView').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerType: 'touch'})); true")
        try await wait("document.activeElement?.matches('.topNav input') === false && !document.querySelector('.topNav .options .list')")
    }

    func testTouchSettingsControls() async throws {
        try await openApplication()
        _ = try await webView.callAsyncJavaScript("await testStore.dispatch('hideSettingsWindow')", arguments: [:], in: nil, contentWorld: .page)
        try await wait("!document.querySelector('.settingsWindow')")
        _ = try await evaluate("window.dispatchEvent(Object.assign(new Event('opentubex:hardware-keyboard'), {attached: false})); true")
        _ = try await webView.callAsyncJavaScript("testStore.commit('setSettingsWindowSection', 'general'); await testStore.dispatch('showSettingsWindow')", arguments: [:], in: nil, contentWorld: .page)
        try await wait("!!document.querySelector('.settingsWindow .select-text')")
        try await wait("document.activeElement?.matches('.settingsCloseButton') === true")
        let searchFocused = try await evaluate("document.activeElement?.matches('input, textarea')") as? Bool
        XCTAssertEqual(searchFocused, false)
        let transparentSwitches = try await evaluate("Array.from(document.querySelectorAll('.settingsWindow .switch-input')).every(input => getComputedStyle(input).backgroundColor === 'rgba(0, 0, 0, 0)')") as? Bool
        XCTAssertEqual(transparentSwitches, true)
        _ = try await evaluate("document.querySelector('.settingsWindow .select-text').click(); true")
        try await wait("!!document.querySelector('.mobileSheetEnabled[open] .phonePicker')")
        _ = try await evaluate("document.querySelector('.mobileSheetEnabled[open] .mobileSheetHeader button:last-child').click(); true")
        _ = try await webView.callAsyncJavaScript("await testStore.dispatch('hideSettingsWindow')", arguments: [:], in: nil, contentWorld: .page)
    }

    func testFileExportCancellation() async throws {
        try await openApplication()
        _ = try await evaluate("window.iosFileResult = null; Capacitor.Plugins.IOSStorage.saveFile({fileName: 'opentubex-test.json', data: btoa('{}')}).then(result => window.iosFileResult = result); true")
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        try await waitForNative { controller.presentedViewController != nil }
        let picker = try XCTUnwrap(controller.presentedViewController as? UIDocumentPickerViewController)
        let files = try XCTUnwrap(FileManager.default.enumerator(at: FileManager.default.temporaryDirectory, includingPropertiesForKeys: nil))
        let exported = try XCTUnwrap(files.compactMap { $0 as? URL }.first { $0.lastPathComponent == "opentubex-test.json" })
        XCTAssertEqual(try String(contentsOf: exported, encoding: .utf8), "{}")
        picker.delegate?.documentPickerWasCancelled?(picker)
        try await dismiss(picker)
        try await wait("window.iosFileResult?.saved === false")
        XCTAssertFalse(FileManager.default.fileExists(atPath: exported.path))
    }

    func testLargeFileExportAndCleanup() async throws {
        try await openApplication()
        _ = try await webView.callAsyncJavaScript("""
        const blob = new Blob(['Grüße ', 'x'.repeat(16 * 1024 * 1024)], {type: 'text/plain;charset=utf-8'});
        const data = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob);
        });
        window.iosLargeFile = 'pending';
        Capacitor.Plugins.IOSStorage.saveFile({fileName: 'ios-large-export.txt', data}).then(result => iosLargeFile = result.saved).catch(error => iosLargeFile = error.message);
        """, arguments: [:], in: nil, contentWorld: .page)
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        try await waitForNative { controller.presentedViewController != nil }
        let picker = try XCTUnwrap(controller.presentedViewController as? UIDocumentPickerViewController)
        let files = try XCTUnwrap(FileManager.default.enumerator(at: FileManager.default.temporaryDirectory, includingPropertiesForKeys: nil))
        let exported = try XCTUnwrap(files.compactMap { $0 as? URL }.first { $0.lastPathComponent == "ios-large-export.txt" })
        let attributes = try FileManager.default.attributesOfItem(atPath: exported.path)
        XCTAssertEqual((attributes[.size] as? NSNumber)?.intValue, 16 * 1024 * 1024 + 8)
        let handle = try FileHandle(forReadingFrom: exported)
        XCTAssertEqual(String(data: try XCTUnwrap(try handle.read(upToCount: 8)), encoding: .utf8), "Grüße ")
        try handle.close()
        picker.delegate?.documentPickerWasCancelled?(picker)
        try await dismiss(picker)
        try await wait("iosLargeFile === false")
        XCTAssertFalse(FileManager.default.fileExists(atPath: exported.path))
    }

    func testLandscapeSafeAreasAtMobileScales() async throws {
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "iPad multitasking window rotation requires simulator UI input")
        try await openApplication()
        _ = try await webView.callAsyncJavaScript("await Capacitor.Plugins.ScreenOrientation.lock({type: 'landscape'})", arguments: [:], in: nil, contentWorld: .page)
        try await wait("innerWidth > innerHeight")
        for scale in [75, 100, 125, 150] {
            _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateUiScale', scale); await testRouter.push('/subscriptions')", arguments: ["scale": scale], in: nil, contentWorld: .page)
            try await wait("Math.abs(visualViewport.scale - \(Double(scale) / 100)) < 0.02")
            try await Task.sleep(nanoseconds: 200_000_000)
            let inset = try webView.safeAreaInsets.left
            let navigationLeft = try await evaluate("document.querySelector('.sideNav .navOption').getBoundingClientRect().left * visualViewport.scale") as? Double
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(navigationLeft) + 1, inset, "Navigation overlaps cutout at \(scale)%")
            _ = try await evaluate("testRouter.push('/settings'); true")
            try await wait("!!document.querySelector('.settingsWindowHeader')")
            let headerLeft = try await evaluate("document.querySelector('.settingsWindowHeader').getBoundingClientRect().left * visualViewport.scale") as? Double
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(headerLeft) + 1, inset, "Settings overlaps cutout at \(scale)%")
        }
        _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateUiScale', 100); await Capacitor.Plugins.ScreenOrientation.lock({type: 'portrait'}); await testRouter.push('/subscriptions')", arguments: [:], in: nil, contentWorld: .page)
    }

    func testPortraitSafeAreasAtMobileScales() async throws {
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "iPad multitasking window rotation requires simulator UI input")
        try await openApplication()
        _ = try await webView.callAsyncJavaScript("await Capacitor.Plugins.ScreenOrientation.lock({type: 'portrait'})", arguments: [:], in: nil, contentWorld: .page)
        try await wait("innerHeight > innerWidth")
        for scale in [75, 100, 125, 150] {
            _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateUiScale', scale); await testRouter.push('/subscriptions')", arguments: ["scale": scale], in: nil, contentWorld: .page)
            try await wait("Math.abs(visualViewport.scale - \(Double(scale) / 100)) < 0.02")
            try await Task.sleep(nanoseconds: 300_000_000)
            if try await evaluate("innerWidth <= 680") as? Bool == true {
                let bottom = try await evaluate("document.querySelector('.sideNav .navOption').getBoundingClientRect().bottom * visualViewport.scale") as? Double
                XCTAssertLessThanOrEqual(try XCTUnwrap(bottom), try webView.bounds.height - webView.safeAreaInsets.bottom + 1, "Navigation overlaps home indicator at \(scale)%")
            }
            let top = try await evaluate("document.querySelector('.topNav').getBoundingClientRect().top * visualViewport.scale") as? Double
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(top) + 1, try webView.safeAreaInsets.top, "Header overlaps status bar at \(scale)%")
        }
        _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateUiScale', 100)", arguments: [:], in: nil, contentWorld: .page)
    }

    func testSettingsAtMobileScales() async throws {
        try await openApplication()
        _ = try await evaluate("testRouter.push('/settings'); true")
        try await wait("!!document.querySelector('.settingsMenu')")
        for scale in [75, 100, 150] {
            _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateUiScale', scale)", arguments: ["scale": scale], in: nil, contentWorld: .page)
            // WebKit can report the new scale before innerWidth catches up with the layout viewport.
            try await wait("Math.abs(visualViewport.scale - \(Double(scale) / 100)) < 0.02 && Math.abs(innerWidth - document.documentElement.clientWidth) <= 1")
            let overflow = try await evaluate("document.documentElement.scrollWidth > innerWidth + 1") as? Bool
            XCTAssertEqual(overflow, false, "Horizontal overflow at \(scale)%")
            let attachment = XCTAttachment(image: try await webView.takeSnapshot(configuration: nil))
            attachment.name = "iOS settings at \(scale)%"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateUiScale', 100)", arguments: [:], in: nil, contentWorld: .page)
    }

    func testFileValidationAndConcurrentPicker() async throws {
        try await openApplication()
        let errors = try await webView.callAsyncJavaScript("""
        const inputs = [
            { fileName: '../outside.json', data: btoa('{}') },
            { fileName: '..', data: btoa('{}') },
            { fileName: 'invalid.json', data: 'not base64!' },
            { fileName: 'denied.json', data: btoa('{}'), directory: '{}' }
        ];
        return await Promise.all(inputs.map(async input => {
            try { await Capacitor.Plugins.IOSStorage.saveFile(input); return false; }
            catch { return true; }
        }));
        """, arguments: [:], in: nil, contentWorld: .page) as? [Bool]
        XCTAssertEqual(errors, [true, true, true, true])
        _ = try await evaluate("window.iosDirectoryResult = 'pending'; Capacitor.Plugins.IOSStorage.chooseDirectory().then(result => iosDirectoryResult = result.path); true")
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        try await waitForNative { controller.presentedViewController != nil }
        let picker = try XCTUnwrap(controller.presentedViewController as? UIDocumentPickerViewController)
        let busy = try await webView.callAsyncJavaScript("try { await Capacitor.Plugins.IOSStorage.saveFile({fileName: 'busy.json', data: btoa('{}')}); return false; } catch (error) { return error.message.includes('already open'); }", arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(busy, true)
        XCTAssertTrue(controller.presentedViewController === picker)
        picker.delegate?.documentPickerWasCancelled?(picker)
        try await dismiss(picker)
        try await wait("iosDirectoryResult === null")
    }

    func testSharePresentationAndCancellation() async throws {
        try await openApplication()
        _ = try await evaluate("window.iosShareResult = 'pending'; Capacitor.Plugins.Share.share({title: 'OpenTubeX test', text: 'Native share test', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw'}).then(() => iosShareResult = 'shared').catch(error => iosShareResult = error.message); true")
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        try await waitForNative { controller.presentedViewController != nil }
        let share = try XCTUnwrap(controller.presentedViewController as? UIActivityViewController)
        if UIDevice.current.userInterfaceIdiom == .pad {
            XCTAssertNotNil(share.popoverPresentationController?.sourceView)
        }
        share.completionWithItemsHandler?(nil, false, nil, nil)
        try await dismiss(share)
        try await wait("iosShareResult === 'Share canceled'")
    }

    func testWakeLockAndBrightnessBridge() async throws {
        try await openApplication()
        let initialIdle = UIApplication.shared.isIdleTimerDisabled
        let initialBrightness = UIScreen.main.brightness
        defer {
            UIApplication.shared.isIdleTimerDisabled = initialIdle
            UIScreen.main.brightness = initialBrightness
        }
        _ = try await webView.callAsyncJavaScript("await Capacitor.Plugins.KeepAwake.keepAwake()", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertTrue(UIApplication.shared.isIdleTimerDisabled)
        _ = try await webView.callAsyncJavaScript("await Capacitor.Plugins.KeepAwake.allowSleep()", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        _ = try await webView.callAsyncJavaScript("await Capacitor.Plugins.ScreenBrightness.setBrightness({brightness: 0.4})", arguments: [:], in: nil, contentWorld: .page)
        let brightness = try await webView.callAsyncJavaScript("return (await Capacitor.Plugins.ScreenBrightness.getBrightness()).brightness", arguments: [:], in: nil, contentWorld: .page) as? Double
        XCTAssertEqual(try XCTUnwrap(brightness), Double(UIScreen.main.brightness), accuracy: 0.02)
        #if targetEnvironment(simulator)
        // The simulator can acknowledge writes without changing screen brightness.
        UIScreen.main.brightness = 0.4
        print("Simulator brightness after direct UIKit write: \(UIScreen.main.brightness)")
        #else
        XCTAssertEqual(try XCTUnwrap(brightness), 0.4, accuracy: 0.02)
        #endif
        _ = try await webView.callAsyncJavaScript("await Capacitor.Plugins.ScreenBrightness.setBrightness({brightness})", arguments: ["brightness": initialBrightness], in: nil, contentWorld: .page)
        XCTAssertEqual(UIScreen.main.brightness, initialBrightness, accuracy: 0.02)
    }

    func testApplicationAndDirectPlayback() async throws {
        try await openApplication()
        _ = try await evaluate("testRouter.push('/search/cats'); true")
        try await wait("document.querySelectorAll('.ft-list-video, .ftListVideo, .videoThumbnail').length > 0", timeout: 90)
        _ = try await evaluate("testRouter.push('/watch/jNQXAC9IVRw'); true")
        try await wait("!!document.querySelector('video')", timeout: 90)
        try await wait("document.querySelector('video')?.readyState >= 2", timeout: 120)
        _ = try await evaluate("document.querySelector('video').play(); true")
        try await wait("document.querySelector('video').currentTime > 2", timeout: 30)
        _ = try await evaluate("document.querySelector('video').currentTime = 8; true")
        try await wait("document.querySelector('video').currentTime >= 8 && !document.querySelector('video').seeking", timeout: 30)
        _ = try await evaluate("document.querySelector('video').pause(); true")
        let paused = try await evaluate("document.querySelector('video').paused") as? Bool
        XCTAssertEqual(paused, true)
        let attachment = XCTAttachment(image: try await webView.takeSnapshot(configuration: nil))
        attachment.name = "iOS direct playback"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func waitForLifecyclePlayback(timeout: TimeInterval = 120) async throws {
        try await wait("iosVisiblePlayer()?.readyState >= 2 || !!document.querySelector('.tabContent[aria-hidden=false] .errorMessage')", timeout: timeout)
        if let message = try await evaluate("document.querySelector('.tabContent[aria-hidden=false] .errorMessage')?.textContent") as? String {
            XCTFail("Playback startup failed before lifecycle assertions: \(message)")
            throw NSError(domain: "PlaybackStartup", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        }
    }

    func testPlaybackTabTeardown() async throws {
        try await openApplication()
        _ = try await evaluate("window.iosLifecycleTabs = []; window.iosVisiblePlayer = () => document.querySelector('.tabContent[aria-hidden=false] video'); true")
        do {
            _ = try await evaluate("window.iosPreviousTabId = testStore.getters.getActiveTabId; document.querySelector('.capacitorTabletNewTab').click(); true")
            try await wait("testStore.getters.getActiveTabId !== iosPreviousTabId")
            _ = try await evaluate("iosLifecycleTabs.push(testStore.getters.getActiveTabId); testRouter.push('/watch/aqz-KE-bpKQ?oneTimeTimestamp=0'); true")
            try await waitForLifecyclePlayback()
            _ = try await webView.callAsyncJavaScript("window.iosFirstTabPlayer = iosVisiblePlayer(); await iosFirstTabPlayer.play()", arguments: [:], in: nil, contentWorld: .page)
            try await wait("iosFirstTabPlayer.currentTime > 1 && !iosFirstTabPlayer.paused", timeout: 30)
            _ = try await evaluate("window.iosPreviousTabId = testStore.getters.getActiveTabId; document.querySelector('.capacitorTabletNewTab').click(); true")
            try await wait("testStore.getters.getActiveTabId !== iosPreviousTabId")
            _ = try await evaluate("iosLifecycleTabs.push(testStore.getters.getActiveTabId); testRouter.push('/watch/jNQXAC9IVRw?oneTimeTimestamp=0'); true")
            try await wait("iosVisiblePlayer() !== iosFirstTabPlayer", timeout: 30)
            try await waitForLifecyclePlayback()
            _ = try await webView.callAsyncJavaScript("window.iosSecondTabPlayer = iosVisiblePlayer(); await iosSecondTabPlayer.play()", arguments: [:], in: nil, contentWorld: .page)
            try await wait("iosSecondTabPlayer.currentTime > 2 && !iosSecondTabPlayer.paused && iosFirstTabPlayer.paused && !iosFirstTabPlayer.ended", timeout: 30)
            let playing = try await evaluate("Array.from(document.querySelectorAll('video')).filter(video => !video.paused).length") as? Int
            XCTAssertEqual(playing, 1)
            _ = try await evaluate("Array.from(document.querySelectorAll('.capacitorTabletTabTarget')).find(tab => tab.dataset.tabId === iosLifecycleTabs[1]).closest('.capacitorTabletTab').querySelector('.capacitorTabletTabClose').click(); true")
            try await wait("!iosSecondTabPlayer.isConnected && iosSecondTabPlayer.paused", timeout: 15)
            _ = try await evaluate("Array.from(document.querySelectorAll('.capacitorTabletTabTarget')).find(tab => tab.dataset.tabId === iosLifecycleTabs[0]).click(); true")
            try await wait("iosVisiblePlayer() === iosFirstTabPlayer && iosFirstTabPlayer.readyState >= 2", timeout: 30)
            _ = try await webView.callAsyncJavaScript("await iosFirstTabPlayer.play()", arguments: [:], in: nil, contentWorld: .page)
            try await wait("!iosFirstTabPlayer.paused")
            _ = try await evaluate("Array.from(document.querySelectorAll('.capacitorTabletTabTarget')).find(tab => tab.dataset.tabId === iosLifecycleTabs[0]).closest('.capacitorTabletTab').querySelector('.capacitorTabletTabClose').click(); true")
            try await wait("!iosFirstTabPlayer.isConnected && iosFirstTabPlayer.paused && iosSecondTabPlayer.paused", timeout: 15)
        } catch {
            _ = try? await evaluate("for (const id of iosLifecycleTabs) { Array.from(document.querySelectorAll('.capacitorTabletTabTarget')).find(tab => tab.dataset.tabId === id)?.closest('.capacitorTabletTab').querySelector('.capacitorTabletTabClose')?.click(); } true")
            throw error
        }
    }

    func testSustainedPlayback() async throws {
        try await openApplication()
        let quality = try await evaluate("testStore.getters.getDefaultQuality") as? String ?? "720"
        do {
            _ = try await webView.callAsyncJavaScript("await testRouter.push('/subscriptions'); window.iosVisibleVideo = () => Array.from(document.querySelectorAll('video')).find(video => video.getBoundingClientRect().width > 0)", arguments: [:], in: nil, contentWorld: .page)
            try await wait("!iosVisibleVideo()")
            _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateDefaultQuality', '480')", arguments: [:], in: nil, contentWorld: .page)
            _ = try await webView.callAsyncJavaScript("await testRouter.push('/watch/aqz-KE-bpKQ?oneTimeTimestamp=0')", arguments: [:], in: nil, contentWorld: .page)
            try await wait("iosVisibleVideo()?.readyState >= 2", timeout: 120)
            _ = try await webView.callAsyncJavaScript("window.iosSustainedPlayer = iosVisibleVideo(); await iosSustainedPlayer.play()", arguments: [:], in: nil, contentWorld: .page)
            try await wait("iosSustainedPlayer.currentTime > 2 && iosSustainedPlayer.currentTime < 10", timeout: 30)
            // Leave the real player running without driving its JavaScript timers.
            try await Task.sleep(nanoseconds: 90_000_000_000)
            try await wait("iosVisibleVideo() === iosSustainedPlayer && iosSustainedPlayer.currentTime > 80 && !iosSustainedPlayer.paused", timeout: 1)
        } catch {
            _ = try? await webView.callAsyncJavaScript("await testStore.dispatch('updateDefaultQuality', quality)", arguments: ["quality": quality], in: nil, contentWorld: .page)
            throw error
        }
        _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateDefaultQuality', quality)", arguments: ["quality": quality], in: nil, contentWorld: .page)
    }
}
