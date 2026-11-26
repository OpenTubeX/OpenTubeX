import XCTest
import Capacitor
import AVFoundation
import WebKit
import MediaPlayer
import Network
import AVKit
@testable import App

@MainActor
final class AppTests: XCTestCase {
    func makeLoopbackListener(port: NWEndpoint.Port = .any) throws -> NWListener {
        let parameters = NWParameters.tcp
        // Fixture servers must not wait for the runner's external network interfaces.
        parameters.requiredInterfaceType = .loopback
        return try NWListener(using: parameters, on: port)
    }

    func startLoopbackListener(_ listener: NWListener) async throws {
        let ready = expectation(description: "Loopback server ready")
        var finished = false
        listener.stateUpdateHandler = { state in
            guard !finished else { return }
            switch state {
            case .ready, .failed:
                finished = true
                ready.fulfill()
            case .waiting(let error) where error == .posix(.EADDRINUSE):
                finished = true
                ready.fulfill()
            default: break
            }
        }
        // Deliver startup state on the same queue as the test's state inspection.
        listener.start(queue: .main)
        defer { listener.stateUpdateHandler = nil }
        await fulfillment(of: [ready], timeout: 30)
        switch listener.state {
        case .ready:
            guard let port = listener.port, port.rawValue != 0 else {
                listener.cancel()
                throw URLError(.cannotConnectToHost)
            }
        case .failed(let error), .waiting(let error):
            listener.cancel()
            throw error
        default:
            listener.cancel()
            throw URLError(.timedOut)
        }
    }

    func testSecretStorageEncryptsWithTheKeychainKeyAndRejectsOtherValues() throws {
        let encrypted = try SecretStorage.encrypt("token ä中")
        XCTAssertFalse(encrypted.contains("token"))
        XCTAssertNotEqual(encrypted, try SecretStorage.encrypt("token ä中"), "Each value gets its own nonce")
        XCTAssertEqual(try SecretStorage.decrypt(encrypted), "token ä中")

        var tampered = try XCTUnwrap(Data(base64Encoded: encrypted))
        tampered[tampered.count - 1] ^= 1
        XCTAssertNil(try SecretStorage.decrypt(tampered.base64EncodedString()))
        // Like a value restored from another device, encrypted with its key.
        XCTAssertNil(try SecretStorage.decrypt(Data(count: 40).base64EncodedString()))
        XCTAssertNil(try SecretStorage.decrypt("not base64!"))
    }

    func testLoopbackStartupRejectsOccupiedPort() async throws {
        let listener = try makeLoopbackListener()
        listener.newConnectionHandler = { $0.cancel() }
        defer { listener.cancel() }
        try await startLoopbackListener(listener)
        let occupied = try makeLoopbackListener(port: XCTUnwrap(listener.port))
        occupied.newConnectionHandler = { $0.cancel() }
        defer { occupied.cancel() }
        do {
            try await startLoopbackListener(occupied)
            XCTFail("An unready fixture must fail startup instead of requesting port zero")
        } catch let error as NWError {
            XCTAssertEqual(error, .posix(.EADDRINUSE))
        }
        let recovered = try await loopbackServer { _, connection in
            connection.send(content: Data("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".utf8),
                            completion: .contentProcessed { _ in connection.cancel() })
        }
        defer { recovered.cancel() }
        let port = try XCTUnwrap(recovered.port).rawValue
        let (data, response) = try await URLSession.shared.data(from: XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/recover")))
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual(data, Data("ok".utf8))
    }

    func loopbackServer(_ handle: @escaping (String, NWConnection) -> Void) async throws -> NWListener {
        let listener = try makeLoopbackListener()
        listener.newConnectionHandler = { connection in
            connection.start(queue: .global())
            func receive(_ buffered: Data) {
                connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, complete, error in
                    let request = buffered + (data ?? Data())
                    if let header = String(data: request, encoding: .utf8), header.contains("\r\n\r\n") {
                        let parts = header.components(separatedBy: "\r\n\r\n")
                        let length = parts[0].components(separatedBy: "\r\n").first(where: { $0.lowercased().hasPrefix("content-length:") })
                            .flatMap { Int($0.components(separatedBy: ":").last!.trimmingCharacters(in: .whitespaces)) } ?? 0
                        if request.count < parts[0].utf8.count + 4 + length && request.count <= 16384 {
                            receive(request)
                            return
                        }
                        handle(header, connection)
                    } else if complete || error != nil || request.count > 16384 { connection.cancel() }
                    else { receive(request) }
                }
            }
            receive(Data())
        }
        try await startLoopbackListener(listener)
        return listener
    }

    func testPlaybackAudioSessionConfiguration() throws {
        let session = AVAudioSession.sharedInstance()
        let category = session.category
        let mode = session.mode
        let options = session.categoryOptions
        defer { try? session.setCategory(category, mode: mode, options: options) }
        try session.setCategory(.ambient)

        OpenTubeXViewController().capacitorDidLoad()

        XCTAssertEqual(session.category, .playback)
        XCTAssertEqual(session.mode, .moviePlayback)
        XCTAssertFalse(session.categoryOptions.contains(.allowAirPlay),
                       "Explicit allowAirPlay is valid only with playAndRecord; playback supports AirPlay by default")
    }

    func testTabletTabAccessibility() async throws {
        try await openApplication()
        let role = try await evaluate("document.querySelector('.capacitorTabletTabs')?.getAttribute('role')") as? String
        XCTAssertEqual(role, "group")
        let active = try await evaluate("document.querySelectorAll('.capacitorTabletTabTarget[aria-pressed=true]').length") as? Int
        XCTAssertEqual(active, 1)
        let named = try await evaluate("Array.from(document.querySelectorAll('.capacitorTabletTabTarget, .capacitorTabletTabClose')).every(el=>el.getAttribute('aria-label')?.trim())") as? Bool
        XCTAssertEqual(named, true)
    }

    func testBackgroundPreparationEvent() async throws {
        try await openApplication()
        _ = try await evaluate("""
            window.iosPreparedForBackground = false;
            window.addEventListener('opentubex:prepare-background', () => {
                window.iosPreparedForBackground = true;
            }, { once: true });
            window.iosSceneEvents = [];
            for (const name of ['opentubex:enter-background', 'opentubex:enter-foreground']) {
                window.addEventListener(name, () => window.iosSceneEvents.push(name), { once: true });
            }
            """)
        let scene = try XCTUnwrap(webView.window?.windowScene)
        let delegate = try XCTUnwrap(scene.delegate as? SceneDelegate)
        delegate.sceneWillResignActive(scene)
        try await wait("window.iosPreparedForBackground === true")
        // Only these switch playback to audio, unlike overlays that merely resign activity.
        delegate.sceneDidEnterBackground(scene)
        delegate.sceneWillEnterForeground(scene)
        try await wait("iosSceneEvents.join() === 'opentubex:enter-background,opentubex:enter-foreground'")
    }

    var webView: WKWebView {
        get throws {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let controller = scenes.flatMap(\.windows).compactMap { $0.rootViewController as? OpenTubeXViewController }.first
            return try XCTUnwrap(controller?.webView)
        }
    }

    func evaluate(_ script: String) async throws -> Any? {
        try await webView.evaluatePageScript(script)
    }

    func wait(_ script: String, in view: WKWebView? = nil, timeout: TimeInterval = 60) async throws {
        let target = try view ?? webView
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if (try? await target.evaluatePageScript(script, timeout: 10)) as? Bool == true { return }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        let text = try? await target.evaluatePageScript("document.body.innerText", timeout: 10)
        let messages = try? await target.evaluatePageScript("JSON.stringify(window.iosTestMessages)", timeout: 10)
        let media = try? await target.evaluatePageScript("JSON.stringify(Array.from(document.querySelectorAll('video')).map(video => ({time: video.currentTime, paused: video.paused, seeking: video.seeking, ready: video.readyState, rate: video.playbackRate, buffered: Array.from({length: video.buffered.length}, (_, i) => [video.buffered.start(i), video.buffered.end(i)]), width: video.getBoundingClientRect().width, error: video.error?.message, held: video === window.iosSustainedPlayer})))", timeout: 10)
        if let screenshot = try? await target.takeSnapshot(configuration: nil) {
            let attachment = XCTAttachment(image: screenshot)
            attachment.name = "iOS failure"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTFail("Timed out: \(script)\nPage: \(String(describing: text))\nConsole: \(String(describing: messages))\nMedia: \(String(describing: media))")
        throw URLError(.timedOut)
    }

    @nonobjc func waitForNative(timeout: TimeInterval = 60, _ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            guard Date() < deadline else {
                XCTFail("Native state did not reach the expected state")
                throw URLError(.timedOut)
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    func dismiss(_ controller: UIViewController) async throws {
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

    func testApplicationReadinessWaitsForNavigationBeforePollingVue() async throws {
        let listener = try await loopbackServer { _, connection in
            DispatchQueue.global().asyncAfter(deadline: .now() + 1) {
                let html = "<div id='app'></div><script>document.querySelector('#app').__vue_app__ = {};</script>"
                let body = Data(html.utf8)
                let header = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
                connection.send(content: Data(header.utf8) + body,
                                completion: .contentProcessed { _ in connection.cancel() })
            }
        }
        defer { listener.cancel() }
        let view = WKWebView()
        view.load(URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/"))))
        try await waitForApplication(in: view, timeout: 0.2)
    }

    func waitForApplication(in view: WKWebView, timeout: TimeInterval = 60) async throws {
        // Cold navigation must finish before the Vue readiness deadline starts.
        try await waitForNative(timeout: 120) { !view.isLoading }
        try await wait("!!document.querySelector('#app')?.__vue_app__", in: view, timeout: timeout)
    }

    func openApplication() async throws {
        try await waitForApplication(in: webView)
        _ = try await evaluate("window.testStore = document.querySelector('#app').__vue_app__.config.globalProperties.$store; window.testRouter = document.querySelector('#app').__vue_app__.config.globalProperties.$router; true")
        _ = try await evaluate("if (!window.iosTestMessages) { window.iosTestMessages = []; for (const level of ['warn', 'error']) { const original = console[level]; console[level] = (...args) => { iosTestMessages.push(args.map(value => { try { return value instanceof Error ? String(value.stack || value) : typeof value === 'string' ? value : JSON.stringify(value) } catch { return String(value) } }).join(' ')); original(...args); }; } } true")
        try await wait("!!document.querySelector('#app .app')")
        let platform = try await evaluate("Capacitor.getPlatform()") as? String
        XCTAssertEqual(platform, "ios")
        let plugin = try await evaluate("Capacitor.isPluginAvailable('PoToken') && Capacitor.isPluginAvailable('SabrHttp') && Capacitor.isPluginAvailable('IOSStorage') && Capacitor.isPluginAvailable('YtDlp')") as? Bool
        XCTAssertEqual(plugin, true)
        // Dismiss the first-run tutorial through its real controls if present.
        // The audience is decided before .app renders, but the overlay loads asynchronously.
        try await wait("localStorage.getItem('opentubex.tutorial.audience') !== 'new' || !!document.querySelector('.tutorialSkip button')", timeout: 15)
        _ = try await evaluate("document.querySelector('.tutorialSkip button')?.click(); true")
        try await wait("!document.querySelector('.tutorialOverlay')", timeout: 15)
    }

    func testApplicationOffline() async throws {
        try await openApplication()
        let ytDlpAvailable = try await webView.callPageScript("return (await Capacitor.Plugins.YtDlp.info()).ytDlp.available") as? Bool
        XCTAssertEqual(ytDlpAvailable, true)
        _ = try await webView.callPageScript("await testStore.dispatch('updateRememberHistory', false)")
        _ = try await evaluate("testRouter.push('/subscriptions'); localStorage.setItem('ios-test-persistence', 'retained'); true")
        let cleared = try await webView.callPageScript("return (await Capacitor.Plugins.IOSStorage.clearCache()).cleared") as? Bool
        XCTAssertEqual(cleared, true)
        _ = try await evaluate("window.iosTestReloadMarker = true")
        try webView.reload()
        try await wait("window.iosTestReloadMarker !== true")
        try await openApplication()
        let persisted = try await evaluate("localStorage.getItem('ios-test-persistence')") as? String
        XCTAssertEqual(persisted, "retained")
        try await wait("testStore.getters.getRememberHistory === false")
        _ = try await webView.callPageScript("await testStore.dispatch('updateRememberHistory', true)")
        _ = try await evaluate("localStorage.removeItem('ios-test-persistence'); true")
        let attachment = XCTAttachment(image: try await webView.takeSnapshot(configuration: nil))
        attachment.name = "iOS subscriptions"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testPlayerSandbox() async throws {
        try await openApplication()
        let result = try await webView.callPageScript("""
        const worker = new Worker('/player-script-worker.js');
        try {
            return await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Worker timed out')), 15000);
                worker.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); };
                worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
                worker.postMessage({ id: 1, code: 'return 42' });
            });
        } finally { worker.terminate(); }
        """) as? [String: Any]
        XCTAssertEqual(result?["result"] as? Int, 42)
    }

    func testHomeWidgetsUseTheAppGroupTheirProfileGrants() throws {
        let profile = Data("""
        \u{30}\u{82}<?xml version="1.0" encoding="UTF-8"?>
        <plist version="1.0"><dict><key>Entitlements</key><dict>
        <key>com.apple.security.application-groups</key>
        <array><string>group.org.opentubex.app.ABCDE12345</string></array>
        </dict></dict></plist>\u{a0}\u{82}
        """.utf8)
        let groups = HomeWidgetStore.provisionedAppGroups(profile)
        XCTAssertEqual(groups, ["group.org.opentubex.app.ABCDE12345"])
        XCTAssertEqual(HomeWidgetStore.appGroup("group.org.opentubex.app", provisioned: groups), "group.org.opentubex.app.ABCDE12345")
        XCTAssertEqual(HomeWidgetStore.appGroup("group.org.opentubex.app.nightly", provisioned: groups), "group.org.opentubex.app.nightly")
        XCTAssertEqual(HomeWidgetStore.appGroup("group.org.opentubex.app",
                                                provisioned: ["group.org.opentubex.app.nightly", "group.org.opentubex.app"]),
                       "group.org.opentubex.app")
        XCTAssertEqual(HomeWidgetStore.appGroup("group.org.opentubex.app", provisioned: HomeWidgetStore.provisionedAppGroups(nil)),
                       "group.org.opentubex.app")
    }

    func testHomeWidgetsValidateDownloadsAndWatchTime() {
        XCTAssertNil(HomeWidgetDownload(json: ["id": -1, "title": "Invalid"]))
        let download = HomeWidgetDownload(json: ["id": 7, "title": "Download", "thumbnail": "http://i.ytimg.com/vi/jNQXAC9IVRw/mqdefault.jpg"])
        XCTAssertEqual(download?.id, 7)
        XCTAssertEqual(download?.thumbnail, "", "Thumbnails require HTTPS")
        XCTAssertEqual(HomeWidgetStore.parseWatchTime(["2026-03-03": 90, "../../files": 10, "2026-03-02": -5, "2026-03-01": "x"]),
                       ["2026-03-03": 90])
    }

    func testHomeWidgetsCacheContinueWatchingAndOpenTheirLinks() async throws {
        try await openApplication()
        XCTAssertNotNil(HomeWidgetStore.directory, "The app and its widgets must share an App Group")
        _ = try await evaluate("testStore.dispatch('updateHistory', { videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', author: 'jawed', lengthSeconds: 19, watchProgress: 7.5, timeWatched: Date.now(), isWatched: false, type: 'video' }); true")
        var deadline = Date().addingTimeInterval(15)
        // History can already hold this video, so wait for the new progress too.
        while HomeWidgetStore.videos().first.map({ $0.videoId != "jNQXAC9IVRw" || $0.watchProgress != 7 }) ?? true && Date() < deadline {
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        let video = try XCTUnwrap(HomeWidgetStore.videos().first)
        XCTAssertEqual(video.videoId, "jNQXAC9IVRw")
        XCTAssertEqual(video.title, "Me at the zoo")
        XCTAssertEqual(video.author, "jawed")
        XCTAssertEqual(video.watchProgress, 7)
        XCTAssertEqual(video.lengthSeconds, 19)
        XCTAssertTrue(video.thumbnail.hasSuffix("/vi/jNQXAC9IVRw/mqdefault.jpg"), video.thumbnail)

        for (page, path) in [("subscriptions", "/subscriptions"), ("watch-later", "/playlist/watchLater")] {
            let opened = await UIApplication.shared.open(try XCTUnwrap(URL(string: "opentubex://open/\(page)")))
            XCTAssertTrue(opened)
            try await wait("testRouter.currentRoute.value.path === '\(path)'")
        }
        _ = await UIApplication.shared.open(try XCTUnwrap(URL(string: "opentubex://open/search")))
        try await wait("document.activeElement?.closest('.searchInput') != null")
        _ = await UIApplication.shared.open(try XCTUnwrap(URL(string: "opentubex://https://www.youtube.com/watch?v=jNQXAC9IVRw&t=7s")))
        try await wait("testRouter.currentRoute.value.path === '/watch/jNQXAC9IVRw' && testRouter.currentRoute.value.query.timestamp == 7")

        // The watch page saves its video to history, so leave it first.
        _ = try await evaluate("testRouter.push('/subscriptions'); true")
        try await wait("testRouter.currentRoute.value.path === '/subscriptions'")
        _ = try await evaluate("testStore.dispatch('removeFromHistory', 'jNQXAC9IVRw'); true")
        deadline = Date().addingTimeInterval(15)
        while HomeWidgetStore.videos().contains(where: { $0.videoId == "jNQXAC9IVRw" }) && Date() < deadline {
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        XCTAssertFalse(HomeWidgetStore.videos().contains(where: { $0.videoId == "jNQXAC9IVRw" }))
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
        let result = try await webView.callPageScript("""
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
        """) as? [String: Any]
        XCTAssertTrue((result?["error"] as? String)?.contains("InternalError: stack overflow") == true, String(describing: result))
        XCTAssertEqual(result?["next"] as? Int, 42)
    }

    func testClipboardAndSceneShortcuts() async throws {
        try await openApplication()
        let previous = UIPasteboard.general.items
        defer { UIPasteboard.general.items = previous }
        let copied = try await webView.callPageScript("await Capacitor.Plugins.Clipboard.write({text: 'OpenTubeX Grüße 日本語'}); return await Capacitor.Plugins.Clipboard.read()") as? [String: String]
        XCTAssertEqual(copied?["value"], "OpenTubeX Grüße 日本語")
        XCTAssertEqual(UIPasteboard.general.string, "OpenTubeX Grüße 日本語")
        let scene = try XCTUnwrap(webView.window?.windowScene)
        let delegate = try XCTUnwrap(scene.delegate as? SceneDelegate)
        for _ in 0..<20 {
            if (UIApplication.shared.shortcutItems ?? []).contains(where: { $0.type == "downloads" }) { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let shortcuts = UIApplication.shared.shortcutItems ?? []
        XCTAssertTrue(shortcuts.contains { $0.type == "downloads" })
        for (type, path) in [("history", "/history"), ("userplaylists", "/userplaylists"), ("refreshSubscriptions", "/subscriptions")] {
            let shortcut = try XCTUnwrap(shortcuts.first { $0.type == type }, type)
            var handled = false
            delegate.windowScene(scene, performActionFor: shortcut) { handled = $0 }
            XCTAssertTrue(handled)
            try await wait("testRouter.currentRoute.value.path === '\(path)'")
        }
    }

    func testNativeServices() async throws {
        try await openApplication()
        let keyboard = try await webView.callPageScript("return (await Capacitor.Plugins.IOSUi.getHardwareKeyboardState()).attached")
        XCTAssertNotNil(keyboard as? Bool)
        let usage = try await webView.callPageScript("return await Capacitor.Plugins.IOSStorage.getUsage()") as? [String: Double]
        XCTAssertGreaterThan(try XCTUnwrap(usage?["appDataBytes"]), 0)
        let image = try await webView.callPageScript("return (await Capacitor.Plugins.Screenshot.take({ width: 320 })).dataUrl") as? String
        XCTAssertTrue(image?.hasPrefix("data:image/jpeg;base64,") == true)
        _ = try await webView.callPageScript("await Capacitor.Plugins.IOSMediaSession.update({state: {title: 'Native media test', duration: 120, position: 12, playbackState: 'paused', actions: ['play', 'seekto']}})")
        XCTAssertEqual(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyTitle] as? String, "Native media test")
        XCTAssertTrue(MPRemoteCommandCenter.shared().playCommand.isEnabled)
        XCTAssertFalse(MPRemoteCommandCenter.shared().nextTrackCommand.isEnabled)
        _ = try await webView.callPageScript("await Capacitor.Plugins.IOSMediaSession.clear()")
        XCTAssertNil(MPNowPlayingInfoCenter.default().nowPlayingInfo)
        XCTAssertFalse(MPRemoteCommandCenter.shared().playCommand.isEnabled)
    }

    func testNowPlayingArtworkRejectsLocalDestinations() throws {
        XCTAssertTrue(isPublicArtworkURL(try XCTUnwrap(URL(string: "https://8.8.8.8/thumbnail.jpg"))))
        XCTAssertTrue(isPublicArtworkURL(try XCTUnwrap(URL(string: "https://[2001:4860:4860::8888]/thumbnail.jpg"))))
        for source in [
            "http://8.8.8.8/thumbnail.jpg", "https://user:password@8.8.8.8/thumbnail.jpg",
            "https://localhost/thumbnail.jpg", "https://127.1/thumbnail.jpg", "https://10.0.0.1/thumbnail.jpg",
            "https://172.16.0.1/thumbnail.jpg", "https://192.168.0.1/thumbnail.jpg", "https://169.254.1.1/thumbnail.jpg",
            "https://100.64.0.1/thumbnail.jpg", "https://[::1]/thumbnail.jpg", "https://[fc00::1]/thumbnail.jpg",
            "https://[fe80::1]/thumbnail.jpg", "https://[::ffff:192.168.0.1]/thumbnail.jpg", "https://[64:ff9b::a00:1]/thumbnail.jpg",
            "https://[64:ff9b:1::a00:1]/thumbnail.jpg"
        ] {
            XCTAssertFalse(isPublicArtworkURL(try XCTUnwrap(URL(string: source))), source)
        }
    }

    func testTouchSearchDismissal() async throws {
        try await openApplication()
        _ = try await webView.callPageScript("await testStore.dispatch('hideSettingsWindow')")
        try await wait("!document.querySelector('.settingsWindow')")
        _ = try await webView.callPageScript("await testRouter.push('/subscriptions')")
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
        _ = try await webView.callPageScript("await testStore.dispatch('hideSettingsWindow')")
        try await wait("!document.querySelector('.settingsWindow')")
        _ = try await evaluate("window.dispatchEvent(Object.assign(new Event('opentubex:hardware-keyboard'), {attached: false})); true")
        _ = try await webView.callPageScript("testStore.commit('setSettingsWindowSection', 'general'); await testStore.dispatch('showSettingsWindow')")
        try await wait("!!document.querySelector('.settingsWindow .select-text')")
        // Touch WebKit may keep non-text focus on the body. Check that opening
        // settings avoids text-input focus after its initial focus requests.
        _ = try await webView.callPageScript("await new Promise(requestAnimationFrame)")
        let searchFocused = try await evaluate("document.activeElement?.matches('input, textarea')") as? Bool
        XCTAssertEqual(searchFocused, false)
        // The label paints the custom switch; its native input stays invisible.
        let hiddenNativeSwitches = try await evaluate("Array.from(document.querySelectorAll('.settingsWindow .switch-input')).every(input => { const style = getComputedStyle(input); return style.opacity === '0' && style.appearance === 'none' })") as? Bool
        XCTAssertEqual(hiddenNativeSwitches, true)
        _ = try await evaluate("document.querySelector('.settingsWindow .select-text').click(); true")
        try await wait("!!document.querySelector('.mobileSheetEnabled[open] .phonePicker')")
        _ = try await evaluate("document.querySelector('.mobileSheetEnabled[open] .mobileSheetHeader button:last-child').click(); true")
        _ = try await webView.callPageScript("await testStore.dispatch('hideSettingsWindow')")
    }

    func testLandscapeSafeAreasAtMobileScales() async throws {
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "iPad multitasking window rotation requires simulator UI input")
        try await openApplication()
        _ = try await webView.callPageScript("await Capacitor.Plugins.ScreenOrientation.lock({type: 'landscape'})")
        try await wait("innerWidth > innerHeight")
        for scale in [75, 100, 125, 150] {
            _ = try await webView.callPageScript("await testStore.dispatch('updateUiScale', scale); await testRouter.push('/subscriptions')", arguments: ["scale": scale])
            try await wait("Math.abs(visualViewport.scale - \(Double(scale) / 100)) < 0.02")
            try await Task.sleep(nanoseconds: 200_000_000)
            let inset = try webView.safeAreaInsets.left
            let navigationLeft = try await evaluate("document.querySelector('.sideNav .navOption').getBoundingClientRect().left * visualViewport.scale") as? Double
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(navigationLeft) + 1, inset, "Navigation overlaps cutout at \(scale)%")
            _ = try await evaluate("testStore.dispatch('showSettingsWindow'); true")
            try await wait("!!document.querySelector('.settingsWindowHeader')")
            let headerLeft = try await evaluate("document.querySelector('.settingsWindowHeader').getBoundingClientRect().left * visualViewport.scale") as? Double
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(headerLeft) + 1, inset, "Settings overlaps cutout at \(scale)%")
        }
        _ = try await webView.callPageScript("await testStore.dispatch('updateUiScale', 100); await Capacitor.Plugins.ScreenOrientation.lock({type: 'portrait'}); await testRouter.push('/subscriptions')")
    }

    func testPortraitSafeAreasAtMobileScales() async throws {
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "iPad multitasking window rotation requires simulator UI input")
        try await openApplication()
        _ = try await webView.callPageScript("await Capacitor.Plugins.ScreenOrientation.lock({type: 'portrait'})")
        try await wait("innerHeight > innerWidth")
        for scale in [75, 100, 125, 150] {
            _ = try await webView.callPageScript("await testStore.dispatch('updateUiScale', scale); await testRouter.push('/subscriptions')", arguments: ["scale": scale])
            try await wait("Math.abs(visualViewport.scale - \(Double(scale) / 100)) < 0.02")
            try await Task.sleep(nanoseconds: 300_000_000)
            if try await evaluate("innerWidth <= 680") as? Bool == true {
                let bottom = try await evaluate("document.querySelector('.sideNav .navOption').getBoundingClientRect().bottom * visualViewport.scale") as? Double
                XCTAssertLessThanOrEqual(try XCTUnwrap(bottom), try webView.bounds.height - webView.safeAreaInsets.bottom + 1, "Navigation overlaps home indicator at \(scale)%")
            }
            let top = try await evaluate("document.querySelector('.topNav').getBoundingClientRect().top * visualViewport.scale") as? Double
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(top) + 1, try webView.safeAreaInsets.top, "Header overlaps status bar at \(scale)%")
        }
        _ = try await webView.callPageScript("await testStore.dispatch('updateUiScale', 100)")
    }

    func testSettingsAtMobileScales() async throws {
        try await openApplication()
        _ = try await evaluate("testStore.dispatch('showSettingsWindow'); true")
        try await wait("!!document.querySelector('.settingsMenu')")
        for scale in [75, 100, 150] {
            _ = try await webView.callPageScript("await testStore.dispatch('updateUiScale', scale)", arguments: ["scale": scale])
            // WebKit can report the new scale before innerWidth catches up with the layout viewport.
            try await wait("Math.abs(visualViewport.scale - \(Double(scale) / 100)) < 0.02 && Math.abs(innerWidth - document.documentElement.clientWidth) <= 1")
            let overflow = try await evaluate("document.documentElement.scrollWidth > innerWidth + 1") as? Bool
            XCTAssertEqual(overflow, false, "Horizontal overflow at \(scale)%")
            let attachment = XCTAttachment(image: try await webView.takeSnapshot(configuration: nil))
            attachment.name = "iOS settings at \(scale)%"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        _ = try await webView.callPageScript("await testStore.dispatch('updateUiScale', 100)")
    }

    func testWakeLockAndBrightnessBridge() async throws {
        try await openApplication()
        let initialIdle = UIApplication.shared.isIdleTimerDisabled
        let initialBrightness = UIScreen.main.brightness
        defer {
            UIApplication.shared.isIdleTimerDisabled = initialIdle
            UIScreen.main.brightness = initialBrightness
        }
        _ = try await webView.callPageScript("await Capacitor.Plugins.KeepAwake.keepAwake()")
        XCTAssertTrue(UIApplication.shared.isIdleTimerDisabled)
        _ = try await webView.callPageScript("await Capacitor.Plugins.KeepAwake.allowSleep()")
        XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        _ = try await webView.callPageScript("await Capacitor.Plugins.ScreenBrightness.setBrightness({brightness: 0.4})")
        let brightness = try await webView.callPageScript("return (await Capacitor.Plugins.ScreenBrightness.getBrightness()).brightness") as? Double
        XCTAssertEqual(try XCTUnwrap(brightness), Double(UIScreen.main.brightness), accuracy: 0.02)
        #if targetEnvironment(simulator)
        // The simulator can acknowledge writes without changing screen brightness.
        UIScreen.main.brightness = 0.4
        print("Simulator brightness after direct UIKit write: \(UIScreen.main.brightness)")
        #else
        XCTAssertEqual(try XCTUnwrap(brightness), 0.4, accuracy: 0.02)
        #endif
        _ = try await webView.callPageScript("await Capacitor.Plugins.ScreenBrightness.setBrightness({brightness})", arguments: ["brightness": initialBrightness])
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
            _ = try await webView.callPageScript("window.iosFirstTabPlayer = iosVisiblePlayer(); await iosFirstTabPlayer.play()")
            try await wait("iosFirstTabPlayer.currentTime > 1 && !iosFirstTabPlayer.paused", timeout: 30)
            _ = try await evaluate("window.iosPreviousTabId = testStore.getters.getActiveTabId; document.querySelector('.capacitorTabletNewTab').click(); true")
            try await wait("testStore.getters.getActiveTabId !== iosPreviousTabId")
            _ = try await evaluate("iosLifecycleTabs.push(testStore.getters.getActiveTabId); testRouter.push('/watch/jNQXAC9IVRw?oneTimeTimestamp=0'); true")
            try await wait("iosVisiblePlayer() !== iosFirstTabPlayer", timeout: 30)
            try await waitForLifecyclePlayback()
            _ = try await webView.callPageScript("window.iosSecondTabPlayer = iosVisiblePlayer(); await iosSecondTabPlayer.play()")
            try await wait("iosSecondTabPlayer.currentTime > 2 && !iosSecondTabPlayer.paused && iosFirstTabPlayer.paused && !iosFirstTabPlayer.ended", timeout: 30)
            let playing = try await evaluate("Array.from(document.querySelectorAll('video')).filter(video => !video.paused).length") as? Int
            XCTAssertEqual(playing, 1)
            _ = try await evaluate("Array.from(document.querySelectorAll('.capacitorTabletTabTarget')).find(tab => tab.dataset.tabId === iosLifecycleTabs[1]).closest('.capacitorTabletTab').querySelector('.capacitorTabletTabClose').click(); true")
            try await wait("!iosSecondTabPlayer.isConnected && iosSecondTabPlayer.paused", timeout: 15)
            _ = try await evaluate("Array.from(document.querySelectorAll('.capacitorTabletTabTarget')).find(tab => tab.dataset.tabId === iosLifecycleTabs[0]).click(); true")
            try await wait("iosVisiblePlayer() === iosFirstTabPlayer && iosFirstTabPlayer.readyState >= 2", timeout: 30)
            _ = try await webView.callPageScript("await iosFirstTabPlayer.play()")
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
            _ = try await webView.callPageScript("await testRouter.push('/subscriptions'); window.iosVisibleVideo = () => Array.from(document.querySelectorAll('video')).find(video => video.getBoundingClientRect().width > 0)")
            try await wait("!iosVisibleVideo()")
            _ = try await webView.callPageScript("await testStore.dispatch('updateDefaultQuality', '480')")
            _ = try await webView.callPageScript("await testRouter.push('/watch/aqz-KE-bpKQ?oneTimeTimestamp=0')")
            try await wait("iosVisibleVideo()?.readyState >= 2", timeout: 120)
            _ = try await webView.callPageScript("window.iosSustainedPlayer = iosVisibleVideo(); await iosSustainedPlayer.play()")
            try await wait("iosSustainedPlayer.currentTime > 2 && iosSustainedPlayer.currentTime < 10", timeout: 30)
            // Leave the real player running without driving its JavaScript timers.
            try await Task.sleep(nanoseconds: 90_000_000_000)
            try await wait("iosVisibleVideo() === iosSustainedPlayer && iosSustainedPlayer.currentTime > 80 && !iosSustainedPlayer.paused", timeout: 1)
        } catch {
            _ = try? await webView.callPageScript("await testStore.dispatch('updateDefaultQuality', quality)", arguments: ["quality": quality])
            throw error
        }
        _ = try await webView.callPageScript("await testStore.dispatch('updateDefaultQuality', quality)", arguments: ["quality": quality])
    }
}

/// WebKit waits forever for a script whose promise never settles. These fail
/// the test instead, before XCTest has to kill a hung test runner.
@MainActor
extension WKWebView {
    func callPageScript(_ body: String, arguments: [String: Any] = [:], timeout: TimeInterval = 120) async throws -> Any? {
        try await withPageScriptTimeout(timeout, body) {
            try await self.callAsyncJavaScript(body, arguments: arguments, in: nil, contentWorld: .page)
        }
    }

    func evaluatePageScript(_ script: String, timeout: TimeInterval = 120) async throws -> Any? {
        try await withPageScriptTimeout(timeout, script) { try await self.evaluateJavaScript(script) }
    }
}

struct PageScriptTimeout: LocalizedError {
    let script: String
    var errorDescription: String? { "Page script did not finish: \(script.prefix(300))" }
}

@MainActor
private func withPageScriptTimeout(_ timeout: TimeInterval, _ script: String,
                                   _ operation: @escaping @MainActor () async throws -> Any?) async throws -> Any? {
    let race = PageScriptRace()
    return try await withCheckedThrowingContinuation { continuation in
        race.continuation = continuation
        race.timer = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            if !Task.isCancelled { race.finish(.failure(PageScriptTimeout(script: script))) }
        }
        Task { @MainActor in
            do { race.finish(.success(try await operation())) } catch { race.finish(.failure(error)) }
        }
    }
}

/// Resumes with whichever finishes first, the script or its timeout.
@MainActor
private final class PageScriptRace {
    var continuation: CheckedContinuation<Any?, Error>?
    var timer: Task<Void, Never>?

    func finish(_ result: Result<Any?, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        timer?.cancel()
        continuation.resume(with: result)
    }
}
