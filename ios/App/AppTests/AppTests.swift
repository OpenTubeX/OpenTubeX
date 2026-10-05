import XCTest
import AVFoundation
import WebKit
import MediaPlayer
import Network
import AVKit
@testable import App

@MainActor
final class AppTests: XCTestCase {
    private func makeLoopbackListener(port: NWEndpoint.Port = .any) throws -> NWListener {
        let parameters = NWParameters.tcp
        // Fixture servers must not wait for the runner's external network interfaces.
        parameters.requiredInterfaceType = .loopback
        return try NWListener(using: parameters, on: port)
    }

    private func startLoopbackListener(_ listener: NWListener) async throws {
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

    private func loopbackServer(_ handle: @escaping (String, NWConnection) -> Void) async throws -> NWListener {
        let listener = try makeLoopbackListener()
        listener.newConnectionHandler = { connection in
            connection.start(queue: .global())
            func receive(_ buffered: Data) {
                connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, complete, error in
                    let request = buffered + (data ?? Data())
                    if let header = String(data: request, encoding: .utf8), header.contains("\r\n\r\n") {
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
        let result = try await webView.callAsyncJavaScript("""
            return await Capacitor.Plugins.IOSHttp.request({requestId: crypto.randomUUID(), url,
                method: 'GET', responseType: 'text', connectTimeout: 500, readTimeout: 500});
            """, arguments: ["url": "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/trickle"], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(result?["status"] as? Int, 200)
        XCTAssertEqual(result?["data"] as? String, String(repeating: "x", count: 12))
    }

    func testYtDlpExportRemainsResponsiveAndRollsBackCancellation() async throws {
        try await verifyExportInterruption("cancel")
    }

    func testYtDlpExportPausePreservesStagingAndResumes() async throws {
        try await verifyExportInterruption("pause")
    }

    private func verifyExportInterruption(_ action: String) async throws {
        try await openApplication()
        let media = try Data(contentsOf: XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "mp4")))
        let listener = try await loopbackServer { header, connection in
            let response = "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: \(media.count)\r\nConnection: close\r\n\r\n"
            connection.send(content: Data(response.utf8) + (header.hasPrefix("HEAD ") ? Data() : media),
                            completion: .contentProcessed { _ in connection.cancel() })
        }
        defer { listener.cancel() }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("export-cancel-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let originalFile = folder.appendingPathComponent("keep.mp4")
        try Data("original".utf8).write(to: originalFile)
        let bookmark = try folder.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        let reference = String(decoding: try JSONSerialization.data(withJSONObject: ["name": folder.lastPathComponent, "bookmark": bookmark.base64EncodedString()]), as: UTF8.self)
        let copied = expectation(description: "Export copy reached")
        let release = DispatchSemaphore(value: 0)
        let observer = BlockingCopyObserver(target: folder, reached: copied, release: release)
        let oldDelegate = FileManager.default.delegate
        FileManager.default.delegate = observer
        defer { release.signal(); FileManager.default.delegate = oldDelegate }
        _ = try await webView.callAsyncJavaScript("await Capacitor.Plugins.YtDlp.configure({configuration:{enabled:true,folder,concurrency:1}})", arguments: ["folder": reference], in: nil, contentWorld: .page)
        let response = try await webView.callAsyncJavaScript("return await Capacitor.Plugins.YtDlp.download({payload:{mode:'video',externalUrl:url,title:'Export cancellation regression'}})", arguments: ["url": "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/fixture.mp4"], in: nil, contentWorld: .page) as? [String: Any]
        let id = try XCTUnwrap(response?["id"] as? Int)
        await fulfillment(of: [copied], timeout: 15)
        XCTAssertFalse(observer.onMain, "A slow File Provider copy must not block the main thread")
        let cancelled = try await webView.callAsyncJavaScript("return await Promise.race([Capacitor.Plugins.YtDlp.control({id,action}),new Promise(resolve=>setTimeout(()=>resolve({ok:false}),1000))])", arguments: ["id": id, "action": action], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(cancelled?["ok"] as? Bool, true)
        release.signal()
        var status: String?
        for _ in 0..<60 {
            status = try await webView.callAsyncJavaScript("return (await Capacitor.Plugins.YtDlp.list()).downloads.find(d=>d.id===id)?.status", arguments: ["id": id], in: nil, contentWorld: .page) as? String
            if status == (action == "pause" ? "paused" : "cancelled") { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertEqual(status, action == "pause" ? "paused" : "cancelled")
        FileManager.default.delegate = oldDelegate
        if action == "pause" {
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path), ["keep.mp4"])
            let resumed = try await webView.callAsyncJavaScript("return (await Capacitor.Plugins.YtDlp.control({id,action:'resume'})).ok", arguments: ["id": id], in: nil, contentWorld: .page) as? Bool
            XCTAssertEqual(resumed, true)
            var destination: String?
            for _ in 0..<100 {
                destination = try await webView.callAsyncJavaScript("return (await Capacitor.Plugins.YtDlp.list()).downloads.find(d=>d.id===id && d.status==='completed')?.destination ?? null", arguments: ["id": id], in: nil, contentWorld: .page) as? String
                if destination != nil { break }
                try await Task.sleep(nanoseconds: 100_000_000)
            }
            XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: XCTUnwrap(destination))), media)
            _ = try await webView.callAsyncJavaScript("return await Capacitor.Plugins.YtDlp.remove({id})", arguments: ["id": id], in: nil, contentWorld: .page)
        }
        var removed = false
        for _ in 0..<60 {
            removed = try await webView.callAsyncJavaScript("await Capacitor.Plugins.YtDlp.clear({ids:[id]}); return !(await Capacitor.Plugins.YtDlp.list()).downloads.some(d=>d.id===id)", arguments: ["id": id], in: nil, contentWorld: .page) as? Bool == true
            if removed { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertTrue(removed, "Export cleanup must release the running job")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path), ["keep.mp4"])
        XCTAssertEqual(try Data(contentsOf: originalFile), Data("original".utf8))
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
        let retained = try await isolatedView.evaluateJavaScript("!!document.getElementById('token-test')") as? Bool
        XCTAssertEqual(retained, true)
    }

    func testYtDlpRuntimeLoadsBundledCertificates() async throws {
        try await openApplication()
        let available = try await webView.callAsyncJavaScript("return (await Capacitor.Plugins.YtDlp.info()).ytDlp.available",
                                                             arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(available, true)
        let certificates = Bundle.main.bundleURL.appendingPathComponent("python-packages/certifi/cacert.pem")
        XCTAssertTrue(FileManager.default.fileExists(atPath: certificates.path))
        XCTAssertEqual(getenv("SSL_CERT_FILE").map { String(cString: $0) }, certificates.path)
    }

    func testDownloadsSettingSurvivesCategorySwitch() async throws {
        try await openApplication()
        let saved = try await webView.callAsyncJavaScript(
            "return testStore.state.settings.enableDownloads", arguments: [:], in: nil, contentWorld: .page) as? Bool
        let original = try XCTUnwrap(saved)
        _ = try await webView.callAsyncJavaScript(
            "await testStore.dispatch('updateEnableDownloads', false); await testRouter.push('/settings')",
            arguments: [:], in: nil, contentWorld: .page)
        try await wait("!!document.querySelector('.settingsMenu button[data-section=download]')")
        _ = try await evaluate("document.querySelector('.settingsMenu button[data-section=download]').click(); true")
        let toggle = ".section[data-section=download] [data-setting-key=enableDownloads] input"
        try await wait("!!document.querySelector('\(toggle)')")
        let initiallyEnabled = try await evaluate("document.querySelector('\(toggle)').checked") as? Bool
        XCTAssertEqual(initiallyEnabled, false)
        _ = try await evaluate("document.querySelector('\(toggle)').click(); true")
        try await wait("document.querySelector('\(toggle)')?.checked === true")
        try await wait("testStore.getters.getEnableDownloads === true")
        _ = try await evaluate("document.querySelector('.settingsMenu button[data-section=appearance]').click(); true")
        try await wait("!!document.querySelector('.section[data-section=appearance]')")
        _ = try await evaluate("document.querySelector('.settingsMenu button[data-section=download]').click(); true")
        try await wait("!!document.querySelector('\(toggle)')")
        let retained = try await evaluate("document.querySelector('\(toggle)').checked") as? Bool
        XCTAssertEqual(retained, true)
        _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateEnableDownloads', original)",
                                                arguments: ["original": original], in: nil, contentWorld: .page)
    }

    func testDownloadCancelUsesNeutralButtonText() async throws {
        try await openApplication()
        let saved = try await evaluate("({enabled: testStore.getters.getEnableDownloads, theme: testStore.getters.getBaseTheme})")
        let original = try XCTUnwrap(saved as? [String: Any])
        let cleanup = "await testStore.dispatch('hideSettingsWindow'); await testStore.dispatch('updateEnableDownloads', original.enabled); await testStore.dispatch('updateBaseTheme', original.theme)"
        do {
            _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateEnableDownloads', true); await testStore.dispatch('showSettingsWindow', 'downloads')", arguments: [:], in: nil, contentWorld: .page)
            try await wait("!!document.querySelector('.downloadHeaderActions .btn')")
            _ = try await evaluate("document.querySelector('.downloadHeaderActions .btn').click(); true")
            try await wait("document.querySelectorAll('.addDownloadPrompt .btn').length === 2")
            for theme in ["light", "dark"] {
                _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateBaseTheme', theme)", arguments: ["theme": theme], in: nil, contentWorld: .page)
                try await wait("document.body.classList.contains('\(theme)')")
                let result = try await evaluate("""
                    (() => {
                        const buttons = document.querySelectorAll('.addDownloadPrompt .btn');
                        const cancel = buttons[1];
                        const reference = document.createElement('button');
                        reference.style.color = 'var(--primary-text-color)';
                        reference.style.visibility = 'hidden';
                        document.body.append(reference);
                        const expected = getComputedStyle(reference).color;
                        reference.remove();
                        return {text: getComputedStyle(cancel).color,
                                icon: getComputedStyle(cancel.querySelector('svg')).color, expected};
                    })()
                    """)
                let colors = try XCTUnwrap(result as? [String: String])
                XCTAssertEqual(colors["text"], colors["expected"], "Neutral Cancel text in \(theme)")
                XCTAssertEqual(colors["icon"], colors["expected"], "Neutral Cancel icon in \(theme)")
            }
            _ = try await evaluate("document.querySelectorAll('.addDownloadPrompt .btn')[1].click(); true")
            try await wait("!document.querySelector('.addDownloadPrompt')")
        } catch {
            _ = try? await webView.callAsyncJavaScript(cleanup, arguments: ["original": original], in: nil, contentWorld: .page)
            throw error
        }
        _ = try await webView.callAsyncJavaScript(cleanup, arguments: ["original": original], in: nil, contentWorld: .page)
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

    func testYtDlpExportRollsBackEarlierFilesOnFailure() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("yt-dlp-export-\(UUID().uuidString)")
        let staging = root.appendingPathComponent("stage")
        let destination = root.appendingPathComponent("destination")
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("first".utf8).write(to: staging.appendingPathComponent("first.mp4"))
        let existing = destination.appendingPathComponent("first.mp4")
        try Data("existing".utf8).write(to: existing)

        XCTAssertThrowsError(try IOSYtDlpExporter.copy(["first.mp4", "missing.mp4"], from: staging,
                                                         to: destination, videoId: "fixture"))
        XCTAssertEqual(try Data(contentsOf: existing), Data("existing".utf8))
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.appendingPathComponent("first (2).mp4").path))
    }

    func testYtDlpExportRejectsEscapingFilename() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("yt-dlp-export-\(UUID().uuidString)")
        let staging = root.appendingPathComponent("input/stage")
        let destination = root.appendingPathComponent("output/folder")
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("private".utf8).write(to: root.appendingPathComponent("input/secret.mp4"))

        XCTAssertThrowsError(try IOSYtDlpExporter.copy(["../secret.mp4"], from: staging,
                                                         to: destination, videoId: "fixture"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("output/secret.mp4").path))
    }

    func testYtDlpMergeUsesSampleDurationForFragmentedTracks() async throws {
        // A two-second synthetic fragmented MP4 with populated initialization
        // durations. AVFoundation counts that duration again when reading fragments.
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("yt-dlp-duration-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let video = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fragmented-duration", withExtension: "mp4"))
        let audio = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "m4a"))
        try FileManager.default.copyItem(at: video, to: root.appendingPathComponent("video.mp4"))
        try FileManager.default.copyItem(at: audio, to: root.appendingPathComponent("audio.m4a"))
        let value: [String: Any] = ["merges": [["video": "video.mp4", "audio": "audio.m4a", "output": "merged.mp4"]]]
        let _: [String: Any] = try await withCheckedThrowingContinuation { continuation in
            IOSYtDlpMerger.run(value, in: root) { continuation.resume(with: $0) }
        }
        let asset = AVURLAsset(url: root.appendingPathComponent("merged.mp4"))
        let duration = try await asset.load(.duration)
        XCTAssertEqual(duration.seconds, 2, accuracy: 0.05)
        let videoTracks = try await asset.loadTracks(withMediaType: .video)
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        let videoTrack = try XCTUnwrap(videoTracks.first)
        let audioTrack = try XCTUnwrap(audioTracks.first)
        let videoRange = try await videoTrack.load(.timeRange)
        let audioRange = try await audioTrack.load(.timeRange)
        XCTAssertEqual(videoRange.duration.seconds, 2, accuracy: 0.05)
        XCTAssertEqual(audioRange.duration.seconds, 2, accuracy: 0.05)
    }

    func testYtDlpMergeReplacesStaleOutputOnRetry() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("yt-dlp-merge-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let video = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "mp4"))
        let audio = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "m4a"))
        try FileManager.default.copyItem(at: video, to: root.appendingPathComponent("video.mp4"))
        try FileManager.default.copyItem(at: audio, to: root.appendingPathComponent("audio.m4a"))
        let output = root.appendingPathComponent("merged.mp4")
        try Data("stale".utf8).write(to: output)

        let value: [String: Any] = ["merges": [["video": "video.mp4", "audio": "audio.m4a", "output": "merged.mp4"]]]
        let result: [String: Any] = try await withCheckedThrowingContinuation { continuation in
            IOSYtDlpMerger.run(value, in: root) { continuation.resume(with: $0) }
        }

        XCTAssertEqual(result["files"] as? [String], ["merged.mp4"])
        let asset = AVURLAsset(url: output)
        let videoTracks = try await asset.loadTracks(withMediaType: .video)
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(videoTracks.count, 1)
        XCTAssertEqual(audioTracks.count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("video.mp4").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("audio.m4a").path))
    }

    func testYtDlpMergeRejectsParentOutput() async throws {
        let sandbox = FileManager.default.temporaryDirectory.appendingPathComponent("yt-dlp-merge-unsafe-\(UUID().uuidString)")
        let staging = sandbox.appendingPathComponent("job")
        let sibling = sandbox.appendingPathComponent("other-job/marker")
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: sibling.deletingLastPathComponent(), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: sandbox) }
        try Data("retained".utf8).write(to: sibling)
        let video = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "mp4"))
        let audio = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "m4a"))
        try FileManager.default.copyItem(at: video, to: staging.appendingPathComponent("video.mp4"))
        try FileManager.default.copyItem(at: audio, to: staging.appendingPathComponent("audio.m4a"))

        let value: [String: Any] = ["merges": [["video": "video.mp4", "audio": "audio.m4a", "output": ".."]]]
        let result: Result<[String: Any], Error> = await withCheckedContinuation { continuation in
            IOSYtDlpMerger.run(value, in: staging) { continuation.resume(returning: $0) }
        }
        if case .success = result { XCTFail("Parent output was accepted") }
        XCTAssertEqual(try Data(contentsOf: sibling), Data("retained".utf8))
    }

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
        let plugin = try await evaluate("Capacitor.isPluginAvailable('PoToken') && Capacitor.isPluginAvailable('SabrHttp') && Capacitor.isPluginAvailable('IOSStorage') && Capacitor.isPluginAvailable('YtDlp')") as? Bool
        XCTAssertEqual(plugin, true)
        // Dismiss the first-run tutorial through its real controls if present.
        _ = try await evaluate("Array.from(document.querySelectorAll('button')).find(b => /^(Skip|Überspringen)$/.test(b.innerText.trim()))?.click(); true")
    }

    func testApplicationOffline() async throws {
        try await openApplication()
        let ytDlpAvailable = try await webView.callAsyncJavaScript("return (await Capacitor.Plugins.YtDlp.info()).ytDlp.available", arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(ytDlpAvailable, true)
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

    func testYtDlpQueueReordering() async throws {
        try await openApplication()
        let listener = try makeLoopbackListener()
        let connectionLock = NSLock()
        var connections: [NWConnection] = []
        listener.newConnectionHandler = { connection in
            connectionLock.lock()
            connections.append(connection)
            connectionLock.unlock()
            connection.start(queue: .global())
        }
        defer { listener.cancel() }
        try await startLoopbackListener(listener)

        let folder = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
            .appendingPathComponent("yt-dlp-queue", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let bookmark = try folder.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        let reference = try JSONSerialization.data(withJSONObject: ["name": folder.lastPathComponent,
                                                                     "bookmark": bookmark.base64EncodedString()])
        _ = try await webView.callAsyncJavaScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": ["enabled": true, "folder": String(decoding: reference, as: UTF8.self), "concurrency": 1]],
            in: nil, contentWorld: .page)
        let url = "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/blocked.mp4"
        var ids: [Int] = []
        for index in 1...3 {
            let started = try await webView.callAsyncJavaScript(
                "return await Capacitor.Plugins.YtDlp.download({payload: {mode: 'video', externalUrl: url, title: 'Queue fixture ' + index}})",
                arguments: ["url": url, "index": index], in: nil, contentWorld: .page) as? [String: Any]
            ids.append(try XCTUnwrap(started?["id"] as? Int))
        }
        let moved = try await webView.callAsyncJavaScript(
            "return (await Capacitor.Plugins.YtDlp.control({id, action: 'move', value: -1})).ok",
            arguments: ["id": ids[2]], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(moved, true)
        let listed = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.list()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        let records = listed?["downloads"] as? [[String: Any]] ?? []
        let second = records.first(where: { $0["id"] as? Int == ids[1] })
        let third = records.first(where: { $0["id"] as? Int == ids[2] })
        XCTAssertEqual(second?["status"] as? String, "queued")
        XCTAssertEqual(third?["status"] as? String, "queued")
        XCTAssertLessThan(try XCTUnwrap(third?["queuePosition"] as? Int),
                          try XCTUnwrap(second?["queuePosition"] as? Int))
        let thirdStage = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("yt-dlp-downloads/\(ids[2])", isDirectory: true)
        try FileManager.default.createDirectory(at: thirdStage, withIntermediateDirectories: true)
        let staleProgress = thirdStage.appendingPathComponent("progress.json")
        try Data(#"{"status":"downloading","percent":90,"speed":42,"eta":5}"#.utf8).write(to: staleProgress)
        let secondStage = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("yt-dlp-downloads/\(ids[1])", isDirectory: true)
        try FileManager.default.createDirectory(at: secondStage, withIntermediateDirectories: true)
        try Data("partial retry".utf8).write(to: secondStage.appendingPathComponent("partial.mp4"))
        let cancelledQueued = try await webView.callAsyncJavaScript(
            "return (await Capacitor.Plugins.YtDlp.control({id, action: 'cancel'})).ok",
            arguments: ["id": ids[1]], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(cancelledQueued, true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: secondStage.path))
        let firstStage = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("yt-dlp-downloads/\(ids[0])", isDirectory: true)
        let firstProgress = firstStage.appendingPathComponent("progress.json")
        try Data(#"{"status":"downloading","percent":25,"speed":42,"eta":5}"#.utf8).write(to: firstProgress)
        _ = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.control({id, action: 'cancel'})",
            arguments: ["id": ids[0]], in: nil, contentWorld: .page)
        try await Task.sleep(nanoseconds: 850_000_000)
        let cancelledStatus = try await webView.callAsyncJavaScript(
            "return (await Capacitor.Plugins.YtDlp.list()).downloads.find(record => record.id === id)?.status",
            arguments: ["id": ids[0]], in: nil, contentWorld: .page) as? String
        XCTAssertEqual(cancelledStatus, "cancelled")
        connectionLock.lock()
        let openConnections = connections
        connectionLock.unlock()
        openConnections.forEach { $0.cancel() }
        listener.cancel()
        var thirdStatus = "queued"
        for _ in 0..<80 {
            thirdStatus = try await webView.callAsyncJavaScript(
                "return (await Capacitor.Plugins.YtDlp.list()).downloads.find(record => record.id === id)?.status",
                arguments: ["id": ids[2]], in: nil, contentWorld: .page) as? String ?? "missing"
            if thirdStatus != "queued" { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertNotEqual(thirdStatus, "queued")
        XCTAssertFalse(FileManager.default.fileExists(atPath: staleProgress.path))
        for id in ids {
            _ = try await webView.callAsyncJavaScript(
                "return await Capacitor.Plugins.YtDlp.control({id, action: 'cancel'})",
                arguments: ["id": id], in: nil, contentWorld: .page)
        }
        for _ in 0..<80 {
            _ = try await webView.callAsyncJavaScript(
                "return await Capacitor.Plugins.YtDlp.clear({ids})",
                arguments: ["ids": ids], in: nil, contentWorld: .page)
            let remaining = try await webView.callAsyncJavaScript(
                "return (await Capacitor.Plugins.YtDlp.list()).downloads.filter(record => ids.includes(record.id)).length",
                arguments: ["ids": ids], in: nil, contentWorld: .page) as? Int
            if remaining == 0 { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        let remaining = try await webView.callAsyncJavaScript(
            "return (await Capacitor.Plugins.YtDlp.list()).downloads.filter(record => ids.includes(record.id)).length",
            arguments: ["ids": ids], in: nil, contentWorld: .page) as? Int
        XCTAssertEqual(remaining, 0)
    }

    func testYtDlpRejectsUnsafeDownloadURL() async throws {
        try await openApplication()
        _ = try await webView.callAsyncJavaScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration: {enabled: true}})",
            arguments: [:], in: nil, contentWorld: .page)
        for url in ["file:///etc/passwd", "ftp://example.org/video", "http://user:pass@example.org/video",
                    "https://example.org/" + String(repeating: "a", count: 8192)] {
            let result = try await webView.callAsyncJavaScript(
                "return await Capacitor.Plugins.YtDlp.download({payload: {mode: 'video', externalUrl: url}})",
                arguments: ["url": url], in: nil, contentWorld: .page) as? [String: Any]
            XCTAssertEqual(result?["error"] as? String, "INVALID_MEDIA_URL")
        }
    }

    func testYtDlpFixtureDownload() async throws {
        try await openApplication()
        let fixtureURL = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "mp4"))
        let media = try Data(contentsOf: fixtureURL)
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
                    let isHead = header.hasPrefix("HEAD ")
                    let response = "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: \(media.count)\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n"
                    connection.send(content: Data(response.utf8) + (isHead ? Data() : media),
                                    completion: .contentProcessed { _ in connection.cancel() })
                }
            }
            receive(Data())
        }
        defer { listener.cancel() }
        try await startLoopbackListener(listener)
        let url = "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/fixture.mp4"

        let extracted = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.extract({args: [url]})",
            arguments: ["url": url], in: nil, contentWorld: .page) as? [String: Any]
        let stdout = try XCTUnwrap(extracted?["stdout"] as? String)
        let info = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(stdout.utf8)) as? [String: Any])
        XCTAssertTrue((info["formats"] as? [[String: Any]])?.contains(where: { $0["ext"] as? String == "mp4" }) == true)

        let folder = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
            .appendingPathComponent("yt-dlp-fixture", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let bookmark = try folder.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        let reference = try JSONSerialization.data(withJSONObject: ["name": folder.lastPathComponent,
                                                                     "bookmark": bookmark.base64EncodedString()])
        let configuration: [String: Any] = ["enabled": true, "folder": String(decoding: reference, as: UTF8.self), "concurrency": 1]
        _ = try await webView.callAsyncJavaScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": configuration], in: nil, contentWorld: .page)
        let started = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.download({payload: {mode: 'video', externalUrl: url, title: 'Fixture'}})",
            arguments: ["url": url], in: nil, contentWorld: .page) as? [String: Any]
        let id = try XCTUnwrap(started?["id"] as? Int, String(describing: started))
        var record: [String: Any] = [:]
        for _ in 0..<120 {
            let listed = try await webView.callAsyncJavaScript(
                "return await Capacitor.Plugins.YtDlp.list()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id }) ?? [:]
            if ["completed", "failed", "cancelled"].contains(record["status"] as? String ?? "") { break }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "completed", String(describing: record))
        let destination = try XCTUnwrap(record["destination"] as? String)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: destination)), media)
        XCTAssertNotNil(UserDefaults.standard.data(forKey: "iosYtDlpDownloads"))
        listener.cancel()
        let offlineAsset = AVURLAsset(url: URL(fileURLWithPath: destination))
        let offlineVideoTracks = try await offlineAsset.loadTracks(withMediaType: .video)
        XCTAssertEqual(offlineVideoTracks.count, 1)
        let offlinePlayer = AVPlayer(url: URL(fileURLWithPath: destination))
        offlinePlayer.play()
        for _ in 0..<40 {
            if offlinePlayer.currentTime().seconds > 0.1 { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertGreaterThan(offlinePlayer.currentTime().seconds, 0.1)
        offlinePlayer.pause()
        let opened = try await webView.callAsyncJavaScript(
            "return (await Capacitor.Plugins.YtDlp.open({id})).ok",
            arguments: ["id": id], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(opened, true)
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        try await waitForNative { controller.presentedViewController is UIActivityViewController }
        if let activity = controller.presentedViewController { try await dismiss(activity) }
        let played = try await webView.callAsyncJavaScript(
            "return (await Capacitor.Plugins.YtDlp.play({id})).ok",
            arguments: ["id": id], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(played, true)
        try await waitForNative { controller.presentedViewController is AVPlayerViewController }
        let player = try XCTUnwrap(controller.presentedViewController as? AVPlayerViewController)
        for _ in 0..<40 {
            if player.player?.currentTime().seconds ?? 0 > 0.1 { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertGreaterThan(player.player?.currentTime().seconds ?? 0, 0.1)
        try await dismiss(player)
        _ = try await webView.callAsyncJavaScript("await testStore.dispatch('showSettingsWindow', 'downloads')", arguments: [:], in: nil, contentWorld: .page)
        let playButton = "Array.from(document.querySelectorAll('.downloadRow')).find(row => row.querySelector('h3')?.textContent.trim() === 'Fixture')?.querySelector('button[title=\"Play download\"], button[title=\"Download wiedergeben\"]')"
        try await wait("(() => { const button = \(playButton); if (!button) return false; const rect = button.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0 && getComputedStyle(button).visibility === 'visible' && Number(getComputedStyle(button.closest('.settingsWindow')).opacity) > 0.9; })()")
        let attachment = XCTAttachment(image: try await webView.takeSnapshot(configuration: nil))
        attachment.name = "iOS completed download with Play action"
        attachment.lifetime = .keepAlways
        add(attachment)
        _ = try await evaluate("(\(playButton)).click(); true")
        try await waitForNative { controller.presentedViewController is AVPlayerViewController }
        if let player = controller.presentedViewController { try await dismiss(player) }

        try FileManager.default.removeItem(atPath: destination)
        let missing = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.list()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        let missingRecord = (missing?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id })
        XCTAssertEqual(missingRecord?["availability"] as? String, "missing")
        XCTAssertEqual((missingRecord?["files"] as? [[String: Any]])?.first?["available"] as? Bool, false)
        let missingPlayback = try await webView.callAsyncJavaScript(
            "return (await Capacitor.Plugins.YtDlp.play({id})).ok",
            arguments: ["id": id], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(missingPlayback, false)
        let removed = try await webView.callAsyncJavaScript(
            "return (await Capacitor.Plugins.YtDlp.remove({id})).ok",
            arguments: ["id": id], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(removed, true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination))
    }

    func testYtDlpCancellationAndRetry() async throws {
        try await openApplication()
        let media = Data(repeating: 42, count: 2 * 1024 * 1024)
        let listener = try makeLoopbackListener()
        let lock = NSLock()
        var requestCount = 0
        var offline = true
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
                    lock.lock()
                    requestCount += 1
                    let slow = requestCount == 2
                    let unavailable = offline && header.contains(" /offline.mp4 ")
                    lock.unlock()
                    if unavailable {
                        let response = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
                        return
                    }
                    let headers = "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: \(media.count)\r\nConnection: close\r\n\r\n"
                    func sendChunk(_ offset: Int) {
                        guard offset < media.count else { connection.cancel(); return }
                        let end = min(offset + 16 * 1024, media.count)
                        connection.send(content: media.subdata(in: offset..<end), completion: .contentProcessed { error in
                            if error != nil { connection.cancel(); return }
                            DispatchQueue.global().asyncAfter(deadline: .now() + 0.05) { sendChunk(end) }
                        })
                    }
                    connection.send(content: Data(headers.utf8), completion: .contentProcessed { error in
                        if error != nil { connection.cancel() }
                        else if slow { sendChunk(0) }
                        else { connection.send(content: media, completion: .contentProcessed { _ in connection.cancel() }) }
                    })
                }
            }
            receive(Data())
        }
        defer { listener.cancel() }
        try await startLoopbackListener(listener)
        let url = "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/slow.mp4"
        let folder = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
            .appendingPathComponent("yt-dlp-cancel-fixture", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let bookmark = try folder.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        let reference = try JSONSerialization.data(withJSONObject: ["name": folder.lastPathComponent,
                                                                     "bookmark": bookmark.base64EncodedString()])
        _ = try await webView.callAsyncJavaScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": ["enabled": true, "folder": String(decoding: reference, as: UTF8.self), "concurrency": 1]],
            in: nil, contentWorld: .page)
        let payload: [String: Any] = ["mode": "video", "externalUrl": url, "title": "Slow fixture"]
        let started = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.download({payload})",
            arguments: ["payload": payload], in: nil, contentWorld: .page) as? [String: Any]
        let id = try XCTUnwrap(started?["id"] as? Int, String(describing: started))

        var record: [String: Any] = [:]
        for _ in 0..<120 {
            let listed = try await webView.callAsyncJavaScript(
                "return await Capacitor.Plugins.YtDlp.list()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id }) ?? [:]
            if (record["percent"] as? Double ?? 0) > 0 { break }
            if ["completed", "failed"].contains(record["status"] as? String ?? "") { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "downloading", String(describing: record))
        XCTAssertGreaterThan(record["percent"] as? Double ?? 0, 0)
        let scene = try XCTUnwrap(webView.window?.windowScene)
        (scene.delegate as? SceneDelegate)?.sceneWillResignActive(scene)
        let cancelled = try await webView.callAsyncJavaScript(
            "return (await Capacitor.Plugins.YtDlp.control({id, action: 'cancel'})).ok",
            arguments: ["id": id], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(cancelled, true)
        let staging = try XCTUnwrap(FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first)
            .appendingPathComponent("yt-dlp-downloads/\(id)")
        for _ in 0..<80 {
            if !FileManager.default.fileExists(atPath: staging.path) { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: staging.path))
        let retry = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.download({payload, retryDownloadId: id})",
            arguments: ["payload": payload, "id": id], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(retry?["id"] as? Int, id, String(describing: retry))
        for _ in 0..<120 {
            let listed = try await webView.callAsyncJavaScript(
                "return await Capacitor.Plugins.YtDlp.list()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id }) ?? [:]
            if ["completed", "failed"].contains(record["status"] as? String ?? "") { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "completed", String(describing: record))
        let destination = try XCTUnwrap(record["destination"] as? String)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: destination)).count, media.count)
        _ = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.remove({id})", arguments: ["id": id], in: nil, contentWorld: .page)

        let offlinePayload: [String: Any] = ["mode": "video", "externalUrl": "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/offline.mp4", "title": "Recovering fixture"]
        let failedStart = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.download({payload})",
            arguments: ["payload": offlinePayload], in: nil, contentWorld: .page) as? [String: Any]
        let failedId = try XCTUnwrap(failedStart?["id"] as? Int, String(describing: failedStart))
        for _ in 0..<80 {
            let listed = try await webView.callAsyncJavaScript(
                "return await Capacitor.Plugins.YtDlp.list()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == failedId }) ?? [:]
            if record["status"] as? String == "failed" { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "failed", String(describing: record))
        XCTAssertFalse((record["errorMessage"] as? String ?? "").isEmpty)
        lock.lock(); offline = false; lock.unlock()
        let recovered = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.download({payload, retryDownloadId: id})",
            arguments: ["payload": offlinePayload, "id": failedId], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(recovered?["id"] as? Int, failedId, String(describing: recovered))
        for _ in 0..<120 {
            let listed = try await webView.callAsyncJavaScript(
                "return await Capacitor.Plugins.YtDlp.list()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == failedId }) ?? [:]
            if ["completed", "failed"].contains(record["status"] as? String ?? "") { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "completed", String(describing: record))
        _ = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.remove({id})", arguments: ["id": failedId], in: nil, contentWorld: .page)

        listener.cancel()
        let lostPayload: [String: Any] = ["mode": "video", "externalUrl": url.replacingOccurrences(of: "/slow.mp4", with: "/lost.mp4"),
                                          "title": "Disconnected fixture"]
        let lostStart = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.download({payload})",
            arguments: ["payload": lostPayload], in: nil, contentWorld: .page) as? [String: Any]
        let lostId = try XCTUnwrap(lostStart?["id"] as? Int)
        for _ in 0..<120 {
            let listed = try await webView.callAsyncJavaScript(
                "return await Capacitor.Plugins.YtDlp.list()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == lostId }) ?? [:]
            if record["status"] as? String == "failed" { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "failed", String(describing: record))
        XCTAssertFalse((record["errorMessage"] as? String ?? "").isEmpty)
        _ = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.remove({id})", arguments: ["id": lostId], in: nil, contentWorld: .page)
    }

    func testYtDlpLiveExternalPlayback() async throws {
        try await openApplication()
        let mediaURL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
        _ = try await webView.callAsyncJavaScript(
            "await testRouter.push({path: '/external-media', query: {url}})",
            arguments: ["url": mediaURL], in: nil, contentWorld: .page)
        try await wait("!!document.querySelector('video')", timeout: 90)
        try await wait("document.querySelector('video')?.readyState >= 2", timeout: 90)
        _ = try await evaluate("document.querySelector('video').play(); true")
        try await wait("document.querySelector('video').currentTime > 1", timeout: 30)
        let attachment = XCTAttachment(image: try await webView.takeSnapshot(configuration: nil))
        attachment.name = "iOS external yt-dlp playback"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testYtDlpLiveYouTubePlayback() async throws {
        try await openApplication()
        let original = try await webView.callAsyncJavaScript(
            "return testStore.getters.getVideoPlaybackEngine", arguments: [:], in: nil, contentWorld: .page) as? String
        _ = try await webView.callAsyncJavaScript("""
            window.__poTokenRequests = 0;
            window.__poTokenCallDetails = [];
            window.__originalNativePromise = Capacitor.nativePromise;
            Capacitor.nativePromise = function(plugin, method, options) {
                if (plugin === 'PoToken' && method === 'generate') {
                    window.__poTokenRequests++;
                    window.__poTokenCallDetails.push({
                        videoId: options?.videoId,
                        route: testRouter.currentRoute.value.fullPath,
                        engine: testStore.getters.getVideoPlaybackEngine
                    });
                }
                return window.__originalNativePromise.call(this, plugin, method, options);
            };
            """, arguments: [:], in: nil, contentWorld: .page)
        _ = try await webView.callAsyncJavaScript(
            "await testRouter.push('/subscriptions'); await testStore.dispatch('updateVideoPlaybackEngine', 'yt-dlp'); await testRouter.push('/watch/jNQXAC9IVRw')",
            arguments: [:], in: nil, contentWorld: .page)
        do {
            try await wait("(() => { const url = document.querySelector('video')?.currentSrc; return url?.startsWith('capacitor://localhost/_opentubex_media/') || url?.startsWith('blob:capacitor://localhost/'); })()", timeout: 90)
            try await wait("document.querySelector('video')?.readyState >= 2", timeout: 90)
            _ = try await evaluate("document.querySelector('video').play(); true")
            try await wait("document.querySelector('video').currentTime > 1", timeout: 30)
            let source = try await webView.callAsyncJavaScript(
                "return document.querySelector('video').currentSrc", arguments: [:], in: nil, contentWorld: .page) as? String
            XCTAssertTrue(source?.hasPrefix("capacitor://localhost/_opentubex_media/") == true ||
                          source?.hasPrefix("blob:capacitor://localhost/") == true,
                          "Expected yt-dlp's native media stream, got \(source ?? "none")")
            let poTokenRequests = try await evaluate("window.__poTokenRequests") as? Int
            let poTokenCallDetails = try await evaluate("JSON.stringify(window.__poTokenCallDetails)") as? String
            XCTAssertEqual(poTokenRequests, 0,
                           "yt-dlp playback must not launch the token challenge WebView: \(poTokenCallDetails ?? "none")")
            let challengeHandler = NSClassFromString("PyForeignClass_WebViewHandler") as? NSObject.Type
            XCTAssertNotNil(challengeHandler, "Expected yt-dlp's WebKit challenge provider to run")
            XCTAssertTrue(challengeHandler?.instancesRespond(
                to: NSSelectorFromString("webView:decidePolicyForNavigationAction:decisionHandler:")) == true,
                "yt-dlp's challenge WebView must guard navigation before iOS opens Universal Links")
        } catch {
            _ = try? await webView.callAsyncJavaScript(
                "Capacitor.nativePromise = window.__originalNativePromise; await testStore.dispatch('updateVideoPlaybackEngine', original)",
                arguments: ["original": original ?? "built-in"], in: nil, contentWorld: .page)
            throw error
        }
        _ = try await webView.callAsyncJavaScript(
            "Capacitor.nativePromise = window.__originalNativePromise; await testStore.dispatch('updateVideoPlaybackEngine', original)",
            arguments: ["original": original ?? "built-in"], in: nil, contentWorld: .page)
    }

    func testYtDlpConcurrentPlaybackAndDownload() async throws {
        try await openApplication()
        let body = Data(repeating: 42, count: 4 * 1024 * 1024)
        let listener = try makeLoopbackListener()
        listener.newConnectionHandler = { connection in
            connection.start(queue: .global())
            connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, _, _ in
                guard let request = data.flatMap({ String(data: $0, encoding: .utf8) }) else {
                    connection.cancel(); return
                }
                let headers = "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
                if request.hasPrefix("HEAD ") {
                    connection.send(content: Data(headers.utf8), completion: .contentProcessed { _ in connection.cancel() })
                    return
                }
                func send(_ offset: Int) {
                    guard offset < body.count else { connection.cancel(); return }
                    let end = min(offset + 16 * 1024, body.count)
                    connection.send(content: body.subdata(in: offset..<end), completion: .contentProcessed { error in
                        if error != nil { connection.cancel(); return }
                        DispatchQueue.global().asyncAfter(deadline: .now() + 0.04) { send(end) }
                    })
                }
                connection.send(content: Data(headers.utf8), completion: .contentProcessed { error in
                    if error != nil { connection.cancel() } else { send(0) }
                })
            }
        }
        defer { listener.cancel() }
        try await startLoopbackListener(listener)
        let folder = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
            .appendingPathComponent("yt-dlp-concurrent", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let bookmark = try folder.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        let reference = try JSONSerialization.data(withJSONObject: ["name": folder.lastPathComponent,
                                                                     "bookmark": bookmark.base64EncodedString()])
        _ = try await webView.callAsyncJavaScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": ["enabled": true, "folder": String(decoding: reference, as: UTF8.self), "concurrency": 1]],
            in: nil, contentWorld: .page)
        let url = "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/slow.mp4"
        let started = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.download({payload: {mode: 'video', externalUrl: url, title: 'Concurrent fixture'}})",
            arguments: ["url": url], in: nil, contentWorld: .page) as? [String: Any]
        let id = try XCTUnwrap(started?["id"] as? Int)
        try await wait("!!document.querySelector('#app')")
        let mediaURL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
        _ = try await webView.callAsyncJavaScript(
            "await testRouter.push({path: '/external-media', query: {url}})",
            arguments: ["url": mediaURL], in: nil, contentWorld: .page)
        try await wait("document.querySelector('video')?.readyState >= 2", timeout: 90)
        _ = try await evaluate("document.querySelector('video').play(); true")
        try await wait("document.querySelector('video').currentTime > 1", timeout: 30)
        let listed = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.list()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        let record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id })
        XCTAssertEqual(record?["status"] as? String, "downloading", String(describing: record))
        XCTAssertGreaterThan(record?["percent"] as? Double ?? 0, 0)
        _ = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.control({id, action: 'cancel'})",
            arguments: ["id": id], in: nil, contentWorld: .page)
    }

    func testYtDlpLiveYouTubeDownload() async throws {
        try await openApplication()
        let videoId = "jNQXAC9IVRw"
        let mediaURL = "https://www.youtube.com/watch?v=\(videoId)"
        let extracted = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.extract({args: [url]})",
            arguments: ["url": mediaURL], in: nil, contentWorld: .page) as? [String: Any]
        let stdout = try XCTUnwrap(extracted?["stdout"] as? String)
        let info = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(stdout.utf8)) as? [String: Any])
        XCTAssertFalse((info["formats"] as? [[String: Any]] ?? []).isEmpty)
        let formatSummary = (info["formats"] as? [[String: Any]] ?? []).map {
            "\($0["format_id"] ?? "?"):\($0["ext"] ?? "?"):\($0["vcodec"] ?? "?"):\($0["acodec"] ?? "?")"
        }
        print("YouTube formats: \(formatSummary.joined(separator: ", "))")

        let folder = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
            .appendingPathComponent("yt-dlp-live", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let bookmark = try folder.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        let reference = try JSONSerialization.data(withJSONObject: ["name": folder.lastPathComponent,
                                                                     "bookmark": bookmark.base64EncodedString()])
        _ = try await webView.callAsyncJavaScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": ["enabled": true, "folder": String(decoding: reference, as: UTF8.self), "concurrency": 1]],
            in: nil, contentWorld: .page)
        _ = try await webView.callAsyncJavaScript(
            "window.iosProcessingEvents = []; window.iosProcessingListener = await Capacitor.Plugins.YtDlp.addListener('downloadStatus', record => { if (record.status === 'processing') iosProcessingEvents.push(record) })",
            arguments: [:], in: nil, contentWorld: .page)
        let started = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.download({payload: {mode: 'video', videoId, title: 'Me at the zoo'}})",
            arguments: ["videoId": videoId], in: nil, contentWorld: .page) as? [String: Any]
        let id = try XCTUnwrap(started?["id"] as? Int, String(describing: started))
        var record: [String: Any] = [:]
        for _ in 0..<360 {
            let listed = try await webView.callAsyncJavaScript(
                "return await Capacitor.Plugins.YtDlp.list()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id }) ?? [:]
            if ["completed", "failed", "cancelled"].contains(record["status"] as? String ?? "") { break }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "completed", String(describing: record))
        let processing = try await webView.callAsyncJavaScript(
            "return iosProcessingEvents.find(record => record.id === id)",
            arguments: ["id": id], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(processing?["percent"] as? Double, 0)
        XCTAssertTrue(processing?["speed"] is NSNull)
        XCTAssertTrue(processing?["eta"] is NSNull)
        _ = try await webView.callAsyncJavaScript("await iosProcessingListener.remove()", arguments: [:], in: nil, contentWorld: .page)
        let destination = try XCTUnwrap(record["destination"] as? String)
        let size = try XCTUnwrap(FileManager.default.attributesOfItem(atPath: destination)[.size] as? Int)
        XCTAssertGreaterThan(size, 100_000)
        let mergedAsset = AVURLAsset(url: URL(fileURLWithPath: destination))
        let mergedVideoTracks = try await mergedAsset.loadTracks(withMediaType: .video)
        let mergedAudioTracks = try await mergedAsset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(mergedVideoTracks.count, 1)
        XCTAssertEqual(mergedAudioTracks.count, 1)
        let removed = try await webView.callAsyncJavaScript(
            "return (await Capacitor.Plugins.YtDlp.remove({id})).ok",
            arguments: ["id": id], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(removed, true)

        let audioStart = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.download({payload: {mode: 'audio', videoId, title: 'Me at the zoo audio'}})",
            arguments: ["videoId": videoId], in: nil, contentWorld: .page) as? [String: Any]
        let audioId = try XCTUnwrap(audioStart?["id"] as? Int)
        var audioRecord: [String: Any] = [:]
        for _ in 0..<240 {
            let listed = try await webView.callAsyncJavaScript(
                "return await Capacitor.Plugins.YtDlp.list()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
            audioRecord = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == audioId }) ?? [:]
            if ["completed", "failed"].contains(audioRecord["status"] as? String ?? "") { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(audioRecord["status"] as? String, "completed", String(describing: audioRecord))
        let audioPath = try XCTUnwrap(audioRecord["destination"] as? String)
        XCTAssertEqual(URL(fileURLWithPath: audioPath).pathExtension, "m4a")
        let audioAsset = AVURLAsset(url: URL(fileURLWithPath: audioPath))
        let audioTracks = try await audioAsset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(audioTracks.count, 1)
        let played = try await webView.callAsyncJavaScript(
            "return (await Capacitor.Plugins.YtDlp.play({id})).ok",
            arguments: ["id": audioId], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(played, true)
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        try await waitForNative { controller.presentedViewController is AVPlayerViewController }
        let audioPlayer = try XCTUnwrap(controller.presentedViewController as? AVPlayerViewController)
        for _ in 0..<40 {
            if audioPlayer.player?.currentTime().seconds ?? 0 > 0.1 { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertGreaterThan(audioPlayer.player?.currentTime().seconds ?? 0, 0.1)
        try await dismiss(audioPlayer)
        _ = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.remove({id})",
            arguments: ["id": audioId], in: nil, contentWorld: .page)
    }

    func testYtDlpPersistenceSeed() async throws {
        try await openApplication()
        let folder = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
            .appendingPathComponent("yt-dlp-persistence", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let bookmark = try folder.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        let reference = try JSONSerialization.data(withJSONObject: ["name": folder.lastPathComponent,
                                                                     "bookmark": bookmark.base64EncodedString()])
        _ = try await webView.callAsyncJavaScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": ["enabled": true, "folder": String(decoding: reference, as: UTF8.self), "concurrency": 1]],
            in: nil, contentWorld: .page)
        let started = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.download({payload: {mode: 'video', externalUrl: url, title: 'Persistence fixture'}})",
            arguments: ["url": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"],
            in: nil, contentWorld: .page) as? [String: Any]
        let id = try XCTUnwrap(started?["id"] as? Int)
        var record: [String: Any] = [:]
        for _ in 0..<120 {
            let listed = try await webView.callAsyncJavaScript(
                "return await Capacitor.Plugins.YtDlp.list()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id }) ?? [:]
            if ["completed", "failed"].contains(record["status"] as? String ?? "") { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "completed", String(describing: record))
        let destination = try XCTUnwrap(record["destination"] as? String)
        XCTAssertTrue(FileManager.default.fileExists(atPath: destination))
        UserDefaults.standard.set(id, forKey: "iosYtDlpPersistenceTestId")
    }

    func testYtDlpPersistenceAfterRelaunch() async throws {
        try await openApplication()
        let id = UserDefaults.standard.integer(forKey: "iosYtDlpPersistenceTestId")
        try XCTSkipIf(id == 0, "Run the seed test in a separate xcodebuild invocation first")
        let listed = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.list()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        let record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id })
        XCTAssertEqual(record?["status"] as? String, "completed", String(describing: record))
        let destination = try XCTUnwrap(record?["destination"] as? String)
        let asset = AVURLAsset(url: URL(fileURLWithPath: destination))
        let videoTracks = try await asset.loadTracks(withMediaType: .video)
        XCTAssertEqual(videoTracks.count, 1)
        let played = try await webView.callAsyncJavaScript(
            "return (await Capacitor.Plugins.YtDlp.play({id})).ok",
            arguments: ["id": id], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(played, true)
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        try await waitForNative { controller.presentedViewController is AVPlayerViewController }
        let player = try XCTUnwrap(controller.presentedViewController as? AVPlayerViewController)
        for _ in 0..<40 {
            if player.player?.currentTime().seconds ?? 0 > 0.1 { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertGreaterThan(player.player?.currentTime().seconds ?? 0, 0.1)
        try await dismiss(player)
        _ = try await webView.callAsyncJavaScript(
            "return await Capacitor.Plugins.YtDlp.remove({id})", arguments: ["id": id], in: nil, contentWorld: .page)
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination))
        UserDefaults.standard.removeObject(forKey: "iosYtDlpPersistenceTestId")
        try? FileManager.default.removeItem(at: URL(fileURLWithPath: destination).deletingLastPathComponent())
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
        _ = try await webView.callAsyncJavaScript("""
        window.invidiousBefore = {backend: testStore.getters.getBackendPreference, instance: testStore.getters.getDefaultInvidiousInstance};
        await testStore.dispatch('hideSettingsWindow');
        await testStore.dispatch('updateDefaultInvidiousInstance', base);
        await testStore.dispatch('updateBackendPreference', 'invidious');
        await testRouter.push('/search/ios-invidious-fixture');
        """, arguments: ["base": base], in: nil, contentWorld: .page)
        do {
            try await wait("document.body.innerText.includes('iOS Invidious fixture')", timeout: 20)
            let thumbnailLabel = try await evaluate("document.querySelector('.ft-list-video .thumbnailLink')?.getAttribute('aria-label')") as? String
            XCTAssertEqual(thumbnailLabel, "iOS Invidious fixture")

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
        for _ in 0..<20 {
            if (UIApplication.shared.shortcutItems ?? []).contains(where: { $0.type == "downloads" }) { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let shortcuts = UIApplication.shared.shortcutItems ?? []
        XCTAssertTrue(shortcuts.contains { $0.type == "downloads" })
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
        // The label paints the custom switch; its native input stays invisible.
        let hiddenNativeSwitches = try await evaluate("Array.from(document.querySelectorAll('.settingsWindow .switch-input')).every(input => { const style = getComputedStyle(input); return style.opacity === '0' && style.appearance === 'none' })") as? Bool
        XCTAssertEqual(hiddenNativeSwitches, true)
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

    private func openDataSettings() async throws {
        try await openApplication()
        _ = try await webView.callAsyncJavaScript("for (const video of document.querySelectorAll('video')) video.pause(); await testRouter.push('/subscriptions'); testStore.commit('setSettingsWindowSection', 'data'); await testStore.dispatch('showSettingsWindow')", arguments: [:], in: nil, contentWorld: .page)
        try await wait("Array.from(document.querySelectorAll('.settingsWindow button')).some(button => button.textContent.trim() === 'Import Settings')")
    }

    private func importFixture(_ data: Data, name: String, action: String) async throws {
        // Exercise WebKit's file-input path and the real importer. Native picker
        // presentation and cancellation are covered separately.
        _ = try await webView.callAsyncJavaScript("""
        const originalClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () {
            if (this.type !== 'file') return originalClick.call(this);
            HTMLInputElement.prototype.click = originalClick;
            const transfer = new DataTransfer();
            transfer.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], name));
            this.files = transfer.files;
            this.dispatchEvent(new Event('change'));
            window.dispatchEvent(new Event('focus'));
        };
        try {
            const button = Array.from(document.querySelectorAll('.settingsWindow button')).find(button => button.textContent.trim() === action);
            if (!button) throw new Error('Import button missing: ' + action);
            button.click();
        } finally {
            HTMLInputElement.prototype.click = originalClick;
        }
        """, arguments: ["data": data.base64EncodedString(), "name": name, "action": action], in: nil, contentWorld: .page)
    }

    func testSettingsFileImportValidation() async throws {
        try await openDataSettings()
        let original = try await evaluate("testStore.getters.getRememberHistory") as? Bool ?? true
        do {
            _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateRememberHistory', true)", arguments: [:], in: nil, contentWorld: .page)
            let mixed = "\n{broken\n{\"_id\":\"rememberHistory\",\"value\":false}\nnull\n"
            try await importFixture(Data(mixed.utf8), name: "settings.db", action: "Import Settings")
            try await wait("testStore.getters.getRememberHistory === false && Array.from(document.querySelectorAll('.toast')).some(toast => toast.textContent.includes('Invalid JSON at row 2'))")
            try await importFixture(Data("\u{FEFF}{\"rememberHistory\":true}".utf8), name: "settings.json", action: "Import Settings")
            try await wait("testStore.getters.getRememberHistory === true")
            try await wait("!Array.from(document.querySelectorAll('.toast')).some(toast => toast.textContent.includes('All settings have been successfully imported'))")
            try await importFixture(Data("{\"_id\":\"rememberHistory\"}".utf8), name: "invalid.db", action: "Import Settings")
            try await wait("Array.from(document.querySelectorAll('.toast')).some(toast => toast.textContent.includes('Unable to read file'))")
            let unchanged = try await evaluate("testStore.getters.getRememberHistory === true && !Array.from(document.querySelectorAll('.toast')).some(toast => toast.textContent.includes('All settings have been successfully imported'))") as? Bool
            XCTAssertEqual(unchanged, true)
        } catch {
            _ = try? await webView.callAsyncJavaScript("await testStore.dispatch('updateRememberHistory', original); await testStore.dispatch('hideSettingsWindow')", arguments: ["original": original], in: nil, contentWorld: .page)
            throw error
        }
        _ = try await webView.callAsyncJavaScript("await testStore.dispatch('updateRememberHistory', original); await testStore.dispatch('hideSettingsWindow')", arguments: ["original": original], in: nil, contentWorld: .page)
    }

    func testUnifiedBackupNativeExportAndWebKitImport() async throws {
        try await openDataSettings()
        let id = "ios-backup-" + UUID().uuidString
        let videoId = String(UUID().uuidString.prefix(11))
        let originalHistorySetting = try await evaluate("testStore.getters.getRememberHistory") as? Bool ?? true
        let arguments: [String: Any] = ["id": id, "videoId": videoId]
        func cleanup() async {
            _ = try? await webView.callAsyncJavaScript("""
            await testStore.dispatch('removeProfile', id);
            await testStore.dispatch('removePlaylist', id);
            await testStore.dispatch('removeFromHistory', videoId);
            for (const entry of testStore.getters.getSearchHistoryEntries.filter(entry => entry.query === 'Backup Grüße 日本語 ' + id)) {
                await testStore.dispatch('removeSearchHistoryEntry', entry._id);
            }
            await testStore.dispatch('hideSettingsWindow');
            """, arguments: arguments, in: nil, contentWorld: .page)
            _ = try? await webView.callAsyncJavaScript("await testStore.dispatch('updateRememberHistory', original)", arguments: ["original": originalHistorySetting], in: nil, contentWorld: .page)
        }
        do {
            _ = try await webView.callAsyncJavaScript("""
            const video = {videoId, title: 'Backup Grüße 日本語', author: 'Fixture', authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
                published: Date.now(), lengthSeconds: 100, watchProgress: 37.25, isLive: false, isWatched: false, timeWatched: Date.now(), type: 'video'};
            await testStore.dispatch('createProfile', {_id: id, name: 'Backup Grüße 日本語', bgColor: '#112233', subscriptions: [{id: video.authorId, name: 'Fixture channel', thumbnail: ''}]});
            await testStore.dispatch('addPlaylist', {_id: id, playlistName: 'Backup Grüße 日本語', description: 'Native backup fixture', videos: [video]});
            await testStore.dispatch('updateHistory', video);
            await testStore.dispatch('updateSearchHistoryEntry', {_id: id, query: 'Backup Grüße 日本語 ' + id, lastUpdatedAt: Date.now()});
            await testStore.dispatch('updateRememberHistory', false);
            Array.from(document.querySelectorAll('.settingsWindow button')).find(button => button.textContent.trim() === 'Export backup').click();
            """, arguments: arguments, in: nil, contentWorld: .page)
            let controller = try XCTUnwrap(webView.window?.rootViewController)
            try await waitForNative { controller.presentedViewController != nil }
            let picker = try XCTUnwrap(controller.presentedViewController as? UIDocumentPickerViewController)
            let files = try XCTUnwrap(FileManager.default.enumerator(at: FileManager.default.temporaryDirectory, includingPropertiesForKeys: nil))
            let exported = try XCTUnwrap(files.compactMap { $0 as? URL }.first { $0.lastPathComponent.hasPrefix("opentubex-backup-") && $0.pathExtension == "zip" })
            let archive = try Data(contentsOf: exported)
            XCTAssertEqual(Array(archive.prefix(4)), [0x50, 0x4b, 0x03, 0x04])
            picker.delegate?.documentPickerWasCancelled?(picker)
            try await dismiss(picker)
            XCTAssertFalse(FileManager.default.fileExists(atPath: exported.path))
            _ = try await webView.callAsyncJavaScript("""
            await testStore.dispatch('removeProfile', id);
            await testStore.dispatch('removePlaylist', id);
            await testStore.dispatch('removeFromHistory', videoId);
            await testStore.dispatch('removeSearchHistoryEntry', id);
            await testStore.dispatch('updateRememberHistory', true);
            """, arguments: arguments, in: nil, contentWorld: .page)
            let removed = try await webView.callAsyncJavaScript("""
            return !testStore.getters.getProfileList.some(profile => profile._id === id)
                && !testStore.getters.getPlaylist(id)
                && !testStore.getters.getHistoryCacheById[videoId]
                && !testStore.getters.getSearchHistoryEntries.some(entry => entry.query === 'Backup Grüße 日本語 ' + id)
                && testStore.getters.getRememberHistory === true;
            """, arguments: arguments, in: nil, contentWorld: .page) as? Bool
            XCTAssertEqual(removed, true, "Fixtures must be absent before testing restoration")
            try await importFixture(archive, name: "native-backup.zip", action: "Import backup")
            try await wait("Array.from(document.querySelectorAll('.settingsSubpageContent button')).some(button => button.textContent.trim() === 'Import selected data')")
            _ = try await evaluate("Array.from(document.querySelectorAll('.settingsSubpageContent button')).find(button => button.textContent.trim() === 'Import selected data').click(); true")
            try await wait("Array.from(document.querySelectorAll('.toast')).some(toast => toast.textContent.includes('Backup imported successfully'))")
            let restored = try await webView.callAsyncJavaScript("""
            const profile = testStore.getters.getProfileList.find(profile => profile._id === id);
            return {profile: profile?.name, subscription: profile?.subscriptions[0]?.id,
                playlist: testStore.getters.getPlaylist(id)?.videos[0]?.videoId,
                progress: testStore.getters.getHistoryCacheById[videoId]?.watchProgress,
                search: testStore.getters.getSearchHistoryEntries.some(entry => entry.query === 'Backup Grüße 日本語 ' + id),
                rememberHistory: testStore.getters.getRememberHistory};
            """, arguments: arguments, in: nil, contentWorld: .page) as? [String: Any]
            XCTAssertEqual(restored?["profile"] as? String, "Backup Grüße 日本語")
            XCTAssertEqual(restored?["subscription"] as? String, "UCaaaaaaaaaaaaaaaaaaaaaa")
            XCTAssertEqual(restored?["playlist"] as? String, videoId)
            XCTAssertEqual(restored?["progress"] as? Double, 37.25)
            XCTAssertEqual(restored?["search"] as? Bool, true)
            XCTAssertEqual(restored?["rememberHistory"] as? Bool, false)
        } catch {
            await cleanup()
            throw error
        }
        await cleanup()
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

private final class BlockingCopyObserver: NSObject, FileManagerDelegate {
    let target: URL
    let reached: XCTestExpectation
    let release: DispatchSemaphore
    private let lock = NSLock()
    private var copiedOnMain = false
    var onMain: Bool { lock.lock(); defer { lock.unlock() }; return copiedOnMain }
    init(target: URL, reached: XCTestExpectation, release: DispatchSemaphore) {
        self.target = target; self.reached = reached; self.release = release
    }
    func fileManager(_ fileManager: FileManager, shouldCopyItemAt srcURL: URL, to dstURL: URL) -> Bool {
        if dstURL.deletingLastPathComponent().standardizedFileURL == target.standardizedFileURL {
            lock.lock(); copiedOnMain = Thread.isMainThread; lock.unlock()
            reached.fulfill()
            if !Thread.isMainThread { _ = release.wait(timeout: .now() + 10) }
        }
        return true
    }
}
