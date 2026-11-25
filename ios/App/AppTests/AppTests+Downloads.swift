import XCTest
import Capacitor
import AVFoundation
import WebKit
import MediaPlayer
import Network
import AVKit
@testable import App

extension AppTests {
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
        let observer = BlockingCopyObserver(target: folder.appendingPathComponent("Playlist/Subfolder"), reached: copied, release: release)
        let oldDelegate = FileManager.default.delegate
        FileManager.default.delegate = observer
        defer { release.signal(); FileManager.default.delegate = oldDelegate }
        _ = try await webView.callPageScript("await Capacitor.Plugins.YtDlp.configure({configuration:{enabled:true,folder,concurrency:1}})", arguments: ["folder": reference])
        let response = try await webView.callPageScript("return await Capacitor.Plugins.YtDlp.download({args:['--no-playlist','--output','Playlist/Subfolder/fixture.%(ext)s',url],payload:{mode:'video',externalUrl:url,title:'Export cancellation regression'}})", arguments: ["url": "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/fixture.mp4"]) as? [String: Any]
        let id = try XCTUnwrap(response?["id"] as? Int)
        await fulfillment(of: [copied], timeout: 15)
        XCTAssertFalse(observer.onMain, "A slow File Provider copy must not block the main thread")
        let cancelled = try await webView.callPageScript("return await Promise.race([Capacitor.Plugins.YtDlp.control({id,action}),new Promise(resolve=>setTimeout(()=>resolve({ok:false}),1000))])", arguments: ["id": id, "action": action]) as? [String: Any]
        XCTAssertEqual(cancelled?["ok"] as? Bool, true)
        release.signal()
        var status: String?
        for _ in 0..<60 {
            status = try await webView.callPageScript("return (await Capacitor.Plugins.YtDlp.list()).downloads.find(d=>d.id===id)?.status", arguments: ["id": id]) as? String
            if status == (action == "pause" ? "paused" : "cancelled") { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertEqual(status, action == "pause" ? "paused" : "cancelled")
        FileManager.default.delegate = oldDelegate
        if action == "pause" {
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path), ["keep.mp4"])
            let resumed = try await webView.callPageScript("return (await Capacitor.Plugins.YtDlp.control({id,action:'resume'})).ok", arguments: ["id": id]) as? Bool
            XCTAssertEqual(resumed, true)
            var destination: String?
            for _ in 0..<100 {
                destination = try await webView.callPageScript("return (await Capacitor.Plugins.YtDlp.list()).downloads.find(d=>d.id===id && d.status==='completed')?.destination ?? null", arguments: ["id": id]) as? String
                if destination != nil { break }
                try await Task.sleep(nanoseconds: 100_000_000)
            }
            XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: XCTUnwrap(destination))), media)
            _ = try await webView.callPageScript("return await Capacitor.Plugins.YtDlp.remove({id})", arguments: ["id": id])
            try FileManager.default.removeItem(at: folder.appendingPathComponent("Playlist"))
        }
        var removed = false
        for _ in 0..<60 {
            removed = try await webView.callPageScript("await Capacitor.Plugins.YtDlp.clear({ids:[id]}); return !(await Capacitor.Plugins.YtDlp.list()).downloads.some(d=>d.id===id)", arguments: ["id": id]) as? Bool == true
            if removed { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertTrue(removed, "Export cleanup must release the running job")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path), ["keep.mp4"])
        XCTAssertEqual(try Data(contentsOf: originalFile), Data("original".utf8))
    }

    func testCommandPalettePlaysNativeDownloadAndRechecksDeletedFile() async throws {
        try await openApplication()
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "mp4"))
        let bytes = try Data(contentsOf: fixture)
        let listener = try await loopbackServer { header, connection in
            let response = "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: \(bytes.count)\r\nConnection: close\r\n\r\n"
            connection.send(content: Data(response.utf8) + (header.hasPrefix("HEAD ") ? Data() : bytes),
                            completion: .contentProcessed { _ in connection.cancel() })
        }
        defer { listener.cancel() }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("palette-download-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let bookmark = try folder.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        let reference = try JSONSerialization.data(withJSONObject: ["name": folder.lastPathComponent, "bookmark": bookmark.base64EncodedString()])
        _ = try await webView.callPageScript("await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": ["enabled": true, "folder": String(decoding: reference, as: UTF8.self), "concurrency": 1]])
        let url = "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/fixture.mp4"
        let started = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.download({payload:{mode:'video',externalUrl:url,title:'Palette native fixture'},args:['--no-playlist',url]})",
            arguments: ["url": url]) as? [String: Any]
        let id = try XCTUnwrap(started?["id"] as? Int)
        addTeardownBlock { @MainActor [weak self] in
            _ = try? await self?.webView.callPageScript("await Capacitor.Plugins.YtDlp.remove({id}); testStore.commit('removeYtDlpDownload', id)",
                arguments: ["id": id])
        }
        var record: [String: Any] = [:]
        for _ in 0..<120 {
            record = try await webView.callPageScript("return (await Capacitor.Plugins.YtDlp.list()).downloads.find(record=>record.id===id)",
                arguments: ["id": id]) as? [String: Any] ?? [:]
            if ["completed", "failed"].contains(record["status"] as? String ?? "") { break }
            try await Task.sleep(for: .milliseconds(250))
        }
        XCTAssertEqual(record["status"] as? String, "completed", String(describing: record))
        let file = try XCTUnwrap((record["files"] as? [[String: Any]])?.first)
        let path = try XCTUnwrap(file["path"] as? String)
        _ = try await webView.callPageScript("""
            await testRouter.push('/subscriptions');
            window.iosPaletteSeed = record;
            record.files[0].title = 'Palette native fixture';
            testStore.commit('upsertYtDlpDownload', record);
            document.dispatchEvent(new KeyboardEvent('keydown', {key:'k',code:'KeyK',ctrlKey:true,bubbles:true}));
            """, arguments: ["record": record])
        try await wait("!!document.querySelector('.commandPalette input')")
        _ = try await evaluate("(() => { const input=document.querySelector('.commandPalette input'); input.value='palette native fixture'; input.dispatchEvent(new Event('input',{bubbles:true})); return true })()")
        try await wait("document.querySelectorAll('.commandPalette [role=option]').length > 0 && Array.from(document.querySelectorAll('.commandPalette [role=option]')).some(option=>option.querySelector('small')?.textContent.includes('Downloads'))")
        _ = try await evaluate("Array.from(document.querySelectorAll('.commandPalette [role=option]')).find(option=>option.querySelector('small')?.textContent.includes('Downloads')).click(); true")
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        var nativePlayer: AVPlayerViewController?
        for _ in 0..<60 {
            nativePlayer = controller.presentedViewController as? AVPlayerViewController
            if nativePlayer != nil { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        let player = try XCTUnwrap(nativePlayer)
        XCTAssertEqual((player.player?.currentItem?.asset as? AVURLAsset)?.url.path, path)
        let routeAfterPlayback = try await evaluate("testStore.getters.getPresentedTab.route.path") as? String
        XCTAssertEqual(routeAfterPlayback, "/subscriptions")
        player.player?.pause()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in player.dismiss(animated: false) { continuation.resume() } }
        try FileManager.default.removeItem(atPath: path)
        _ = try await evaluate("testStore.commit('upsertYtDlpDownload', iosPaletteSeed); document.dispatchEvent(new KeyboardEvent('keydown', {key:'k',code:'KeyK',ctrlKey:true,bubbles:true})); true")
        try await wait("!!document.querySelector('.commandPalette input')")
        _ = try await evaluate("(() => { const input=document.querySelector('.commandPalette input'); input.value='palette native fixture'; input.dispatchEvent(new Event('input',{bubbles:true})); return true })()")
        try await wait("Array.from(document.querySelectorAll('.commandPalette [role=option]')).some(option=>option.querySelector('small')?.textContent.includes('Downloads'))")
        _ = try await evaluate("Array.from(document.querySelectorAll('.commandPalette [role=option]')).find(option=>option.querySelector('small')?.textContent.includes('Downloads')).click(); true")
        try await wait("document.body.textContent.includes('The downloaded file could not be found.')")
        XCTAssertNil(controller.presentedViewController)
        let routeAfterDeletion = try await evaluate("testStore.getters.getPresentedTab.route.path") as? String
        let availableAfterDeletion = try await evaluate("testStore.getters.getYtDlpDownloads[iosPaletteSeed.id].files[0].available") as? Bool
        XCTAssertEqual(routeAfterDeletion, "/subscriptions")
        XCTAssertEqual(availableAfterDeletion, false)
    }

    func testYtDlpRuntimeLoadsBundledCertificates() async throws {
        try await openApplication()
        let available = try await webView.callPageScript("return (await Capacitor.Plugins.YtDlp.info()).ytDlp.available",
                                                             arguments: [:]) as? Bool
        XCTAssertEqual(available, true)
        let certificates = Bundle.main.bundleURL.appendingPathComponent("python-packages/certifi/cacert.pem")
        XCTAssertTrue(FileManager.default.fileExists(atPath: certificates.path))
        XCTAssertEqual(getenv("SSL_CERT_FILE").map { String(cString: $0) }, certificates.path)
    }

    func testYtDlpUpdateReportsBundledVersion() async throws {
        try await openApplication()
        let versions = try await webView.callPageScript("return [(await Capacitor.Plugins.YtDlp.info()).ytDlp.version, (await Capacitor.Plugins.YtDlp.update({binary:'yt-dlp'})).version]",
                                                            arguments: [:]) as? [String]
        XCTAssertEqual(versions?.count, 2)
        XCTAssertFalse(versions?.first?.isEmpty ?? true)
        XCTAssertEqual(versions?.first, versions?.last)
    }

    func testIOSDownloadTemplatesAndFFmpegConversion() async throws {
        try await openApplication()
        let enabled = try await evaluate("testStore.getters.getEnableDownloads") as? Bool ?? false
        addTeardownBlock { @MainActor [weak self] in
            _ = try? await self?.webView.callPageScript("await testStore.dispatch('updateEnableDownloads', enabled); await testStore.dispatch('hideSettingsWindow'); await testRouter.push('/subscriptions')",
                arguments: ["enabled": enabled])
        }
        let info = try await webView.callPageScript("return await Capacitor.Plugins.YtDlp.info()") as? [String: Any]
        XCTAssertEqual((info?["ffmpeg"] as? [String: Any])?["available"] as? Bool, true)
        XCTAssertEqual((info?["ffprobe"] as? [String: Any])?["available"] as? Bool, true)
        _ = try await evaluate("testStore.dispatch('updateEnableDownloads', true); testStore.dispatch('showSettingsWindow'); true")
        try await wait("!!document.querySelector('.settingsMenu button[data-section=download]')")
        _ = try await evaluate("document.querySelector('.settingsMenu button[data-section=download]').click(); true")
        try await wait("Array.from(document.querySelectorAll('.section[data-section=download] button')).some(button=>button.textContent.includes('Manage Download Templates'))")
        _ = try await evaluate("Array.from(document.querySelectorAll('.section[data-section=download] button')).find(button=>button.textContent.includes('Manage Download Templates')).click(); true")
        try await wait("!!document.querySelector('.templateManagerHeader select')")
        let options = try await evaluate("Array.from(document.querySelector('.templateManagerHeader select').options).map(option=>option.textContent).join(' ')") as? String
        XCTAssertTrue(options?.contains("MP3") == true)
        _ = try await evaluate("testRouter.push('/'); true")

        let media = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "m4a"))
        let bytes = try Data(contentsOf: media)
        let listener = try await loopbackServer { _, connection in
            let header = "HTTP/1.1 200 OK\r\nContent-Type: audio/mp4\r\nContent-Length: \(bytes.count)\r\nConnection: close\r\n\r\n"
            connection.send(content: Data(header.utf8) + bytes, completion: .contentProcessed { _ in connection.cancel() })
        }
        defer { listener.cancel() }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("ffmpeg-export-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let bookmark = try folder.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        let reference = try JSONSerialization.data(withJSONObject: ["name": folder.lastPathComponent, "bookmark": bookmark.base64EncodedString()])
        _ = try await webView.callPageScript("await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": ["enabled": true, "folder": String(decoding: reference, as: UTF8.self), "concurrency": 1]])
        let url = "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/fixture.m4a"
        let response = try await webView.callPageScript("return await Capacitor.Plugins.YtDlp.download({payload:{mode:'audio',externalUrl:url},args:['--no-playlist','--extract-audio','--audio-format','mp3','--embed-metadata','--output','Playlist/Converted with spaces.%(ext)s',url]})",
            arguments: ["url": url]) as? [String: Any]
        let id = try XCTUnwrap(response?["id"] as? Int, String(describing: response))
        var record: [String: Any] = [:]
        for _ in 0..<120 {
            record = try await webView.callPageScript("return (await Capacitor.Plugins.YtDlp.list()).downloads.find(download=>download.id===id)", arguments: ["id": id]) as? [String: Any] ?? [:]
            if ["completed", "failed"].contains(record["status"] as? String ?? "") { break }
            try await Task.sleep(for: .milliseconds(250))
        }
        XCTAssertEqual(record["status"] as? String, "completed", String(describing: record))
        let file = try XCTUnwrap((record["files"] as? [[String: Any]])?.first)
        XCTAssertEqual(file["relativePath"] as? String, "Playlist/Converted with spaces.mp3")
        let path = try XCTUnwrap(file["path"] as? String)
        let probe = try await Task.detached { try IOSFFmpeg.execute(["ffprobe", "-v", "quiet", "-show_streams", "-of", "json", path]) }.value
        XCTAssertEqual(probe["returncode"] as? Int, 0)
        XCTAssertTrue((probe["stdout"] as? String ?? "").contains("mp3"))
        _ = try await webView.callPageScript("return await Capacitor.Plugins.YtDlp.remove({id})", arguments: ["id": id])
    }

    func testDefaultAudioDownloadConvertsOpusForOfflinePlayback() async throws {
        try await openApplication()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("default-audio-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "m4a"))
        let opus = root.appendingPathComponent("source.opus")
        let encoded = try await Task.detached {
            try IOSFFmpeg.execute(["ffmpeg", "-v", "error", "-i", fixture.path, "-c:a", "libopus", opus.path])
        }.value
        XCTAssertEqual(encoded["returncode"] as? Int, 0, String(describing: encoded))
        let bytes = try Data(contentsOf: opus)
        let listener = try await loopbackServer { _, connection in
            let header = "HTTP/1.1 200 OK\r\nContent-Type: audio/ogg\r\nContent-Length: \(bytes.count)\r\nConnection: close\r\n\r\n"
            connection.send(content: Data(header.utf8) + bytes, completion: .contentProcessed { _ in connection.cancel() })
        }
        defer { listener.cancel() }
        let target = root.appendingPathComponent("exports")
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        let bookmark = try target.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        let reference = try JSONSerialization.data(withJSONObject: ["name": target.lastPathComponent, "bookmark": bookmark.base64EncodedString()])
        _ = try await webView.callPageScript("await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": ["enabled": true, "folder": String(decoding: reference, as: UTF8.self)]])
        let url = "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/source.opus"
        for (format, extensionName) in [("", "m4a"), ("opus", "opus")] {
            let response = try await webView.callPageScript("""
                const args = ['--no-playlist', '-x', '--output', 'Offline.%(ext)s'];
                if (format) args.push('--audio-format', format);
                args.push(url);
                return await Capacitor.Plugins.YtDlp.download({payload:{mode:'audio',externalUrl:url},args});
                """, arguments: ["url": url, "format": format]) as? [String: Any]
            let id = try XCTUnwrap(response?["id"] as? Int, String(describing: response))
            addTeardownBlock { @MainActor [weak self] in
                _ = try? await self?.webView.callPageScript("return await Capacitor.Plugins.YtDlp.remove({id})", arguments: ["id": id])
            }
            var record: [String: Any] = [:]
            for _ in 0..<120 {
                record = try await webView.callPageScript("return (await Capacitor.Plugins.YtDlp.list()).downloads.find(download=>download.id===id)", arguments: ["id": id]) as? [String: Any] ?? [:]
                if ["completed", "failed"].contains(record["status"] as? String ?? "") { break }
                try await Task.sleep(for: .milliseconds(250))
            }
            XCTAssertEqual(record["status"] as? String, "completed", String(describing: record))
            let file = try XCTUnwrap((record["files"] as? [[String: Any]])?.first)
            XCTAssertEqual(file["extension"] as? String, extensionName)
            if format.isEmpty {
                let asset = AVURLAsset(url: URL(fileURLWithPath: try XCTUnwrap(file["path"] as? String)))
                let playable = try await asset.load(.isPlayable)
                XCTAssertTrue(playable, "Default audio exports must be playable by AVFoundation")
            }
            _ = try await webView.callPageScript("return await Capacitor.Plugins.YtDlp.remove({id})", arguments: ["id": id])
        }
    }

    func testDownloadsSettingSurvivesCategorySwitch() async throws {
        try await openApplication()
        let saved = try await webView.callPageScript(
            "return testStore.state.settings.enableDownloads") as? Bool
        let original = try XCTUnwrap(saved)
        let cleanup = "await testStore.dispatch('updateEnableDownloads', original); await testStore.dispatch('hideSettingsWindow')"
        func selectSection(_ section: String) async throws {
            // The modal can rerender between separate readiness and click calls.
            try await wait("(() => { const button = document.querySelector('.settingsMenu button[data-section=\(section)]'); if (!button) return false; button.click(); return true; })()")
        }
        do {
            _ = try await webView.callPageScript(
                "await testStore.dispatch('updateEnableDownloads', false); await testStore.dispatch('showSettingsWindow')",
                arguments: [:])
            try await selectSection("download")
            let toggle = ".section[data-section=download] [data-setting-key=enableDownloads] input"
            try await wait("!!document.querySelector('\(toggle)')")
            let initiallyEnabled = try await evaluate("document.querySelector('\(toggle)').checked") as? Bool
            XCTAssertEqual(initiallyEnabled, false)
            _ = try await evaluate("document.querySelector('\(toggle)').click(); true")
            try await wait("document.querySelector('\(toggle)')?.checked === true")
            try await wait("testStore.getters.getEnableDownloads === true")
            try await selectSection("appearance")
            try await wait("!!document.querySelector('.section[data-section=appearance]')")
            try await selectSection("download")
            try await wait("!!document.querySelector('\(toggle)')")
            let retained = try await evaluate("document.querySelector('\(toggle)').checked") as? Bool
            XCTAssertEqual(retained, true)
        } catch {
            _ = try? await webView.callPageScript(cleanup, arguments: ["original": original])
            throw error
        }
        _ = try await webView.callPageScript(cleanup, arguments: ["original": original])
    }

    func testDownloadCancelUsesNeutralButtonText() async throws {
        try await openApplication()
        let saved = try await evaluate("({enabled: testStore.getters.getEnableDownloads, theme: testStore.getters.getBaseTheme})")
        let original = try XCTUnwrap(saved as? [String: Any])
        let cleanup = "await testStore.dispatch('hideSettingsWindow'); await testStore.dispatch('updateEnableDownloads', original.enabled); await testStore.dispatch('updateBaseTheme', original.theme)"
        do {
            _ = try await webView.callPageScript("await testStore.dispatch('updateEnableDownloads', true); await testStore.dispatch('showSettingsWindow', 'downloads')")
            try await wait("!!document.querySelector('.downloadHeaderActions .btn')")
            _ = try await evaluate("document.querySelector('.downloadHeaderActions .btn').click(); true")
            try await wait("document.querySelectorAll('.addDownloadPrompt .btn').length === 2")
            for theme in ["light", "dark"] {
                _ = try await webView.callPageScript("await testStore.dispatch('updateBaseTheme', theme)", arguments: ["theme": theme])
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
            _ = try? await webView.callPageScript(cleanup, arguments: ["original": original])
            throw error
        }
        _ = try await webView.callPageScript(cleanup, arguments: ["original": original])
    }

    func testYtDlpArgumentRestorationFailuresArePublishedAndPersisted() throws {
        let key = "iosYtDlpDownloads"
        let saved = UserDefaults.standard.data(forKey: key)
        defer { UserDefaults.standard.set(saved, forKey: key) }
        let records: [String: [String: Any]] = [
            "1": ["id": 1, "status": "queued"],
            "2": ["id": 2, "status": "paused"],
            "3": ["id": 3, "status": "completed"],
            "4": ["id": 4, "status": "cancelled"],
            "5": ["id": 5, "status": "queued", "args": ["existing"]],
            "6": ["id": 6, "status": "paused"],
        ]
        UserDefaults.standard.set(try JSONSerialization.data(withJSONObject: ["records": records, "nextId": 6]), forKey: key)
        let plugin = IOSYtDlpPlugin()
        plugin.eventListeners = NSMutableDictionary()
        plugin.load()
        var published: [[String: Any]] = []
        plugin.addEventListener("downloadStatus", listener: CAPPluginCall(callbackId: "fixture-listener", methodName: "addListener", options: [:], success: { result, _ in
            if let data = result?.data { published.append(data) }
        }, error: { _ in XCTFail("Status listener failed") }))
        let options = try XCTUnwrap(JSTypes.coerceDictionaryToJSObject([
            "configuration": ["enabled": false],
            "resumeArguments": ["6": ["restored"]],
            "failedResumeArguments": ["1": "invalid-video-id", "2": "unsupported-custom-argument", "3": "ignored", "4": "ignored", "5": "ignored", "99": "ignored"],
        ] as NSDictionary))
        plugin.configure(CAPPluginCall(callbackId: "fixture", methodName: "configure", options: options,
                                       success: { _, _ in }, error: { _ in XCTFail("Configuration failed") }))
        let persisted = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(UserDefaults.standard.data(forKey: key))) as? [String: Any])
        let updated = try XCTUnwrap(persisted["records"] as? [String: [String: Any]])
        XCTAssertEqual(updated["1"]?["status"] as? String, "failed")
        XCTAssertEqual(updated["1"]?["errorMessage"] as? String, "invalid-video-id")
        XCTAssertEqual(updated["2"]?["status"] as? String, "failed")
        XCTAssertEqual(updated["2"]?["errorMessage"] as? String, "unsupported-custom-argument")
        XCTAssertEqual(updated["3"]?["status"] as? String, "completed")
        XCTAssertEqual(updated["4"]?["status"] as? String, "cancelled")
        XCTAssertEqual(updated["5"]?["status"] as? String, "queued")
        XCTAssertEqual(updated["6"]?["args"] as? [String], ["restored"])
        XCTAssertEqual(Set(published.compactMap { $0["id"] as? Int }), [1, 2])
    }

    func testYtDlpExportsThroughPrivatePathAliases() throws {
        #if targetEnvironment(simulator)
        // Simulator app containers live under /Users, which has no /private alias.
        let privatePath = "/private/var/tmp"
        #else
        let temporary = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().path
        let privatePath = temporary.hasPrefix("/private/") ? temporary : "/private" + temporary
        #endif
        let root = URL(fileURLWithPath: privatePath).appendingPathComponent("private-export-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let staging = root.appendingPathComponent("staging")
        let target = root.appendingPathComponent("target")
        let names = ["first.mp4", "Playlist/second.mp4"]
        try FileManager.default.createDirectory(at: staging.appendingPathComponent("Playlist"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        for name in names { try Data(name.utf8).write(to: staging.appendingPathComponent(name)) }
        let result = try IOSYtDlpExporter.copy(names, from: staging, to: target, videoId: "fixture")
        XCTAssertEqual(result.files.compactMap { $0["relativePath"] as? String }, names)
        for (index, name) in names.enumerated() {
            XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: result.destinations[index])), Data(name.utf8))
        }
    }

    func testYtDlpExportRejectsSymlinksOutsideItsRoots() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("symlink-export-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let staging = root.appendingPathComponent("staging")
        let target = root.appendingPathComponent("target")
        let outside = root.appendingPathComponent("outside")
        for directory in [staging, target, outside] {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        try Data("private".utf8).write(to: outside.appendingPathComponent("secret.mp4"))
        try FileManager.default.createSymbolicLink(at: staging.appendingPathComponent("source"), withDestinationURL: outside)
        try FileManager.default.createSymbolicLink(at: target.appendingPathComponent("destination"), withDestinationURL: outside)
        try FileManager.default.createDirectory(at: staging.appendingPathComponent("destination"), withIntermediateDirectories: true)
        try Data("downloaded".utf8).write(to: staging.appendingPathComponent("destination/first.mp4"))
        for name in ["source/secret.mp4", "destination/first.mp4"] {
            XCTAssertThrowsError(try IOSYtDlpExporter.copy([name], from: staging, to: target, videoId: "fixture"))
        }
        XCTAssertEqual(try Data(contentsOf: outside.appendingPathComponent("secret.mp4")), Data("private".utf8))
        XCTAssertFalse(FileManager.default.fileExists(atPath: outside.appendingPathComponent("first.mp4").path))
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

    func testYtDlpExportRollsBackNewTemplateFoldersOnFailure() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("template-rollback-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let staging = root.appendingPathComponent("staging")
        let target = root.appendingPathComponent("target")
        let existing = target.appendingPathComponent("Existing")
        let name = "Existing/Playlist/Subfolder/first.mp4"
        try FileManager.default.createDirectory(at: staging.appendingPathComponent(name).deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: existing, withIntermediateDirectories: true)
        try Data("first".utf8).write(to: staging.appendingPathComponent(name))

        XCTAssertThrowsError(try IOSYtDlpExporter.copy([name, "Existing/Playlist/Subfolder/missing.mp4"], from: staging, to: target, videoId: "fixture"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: existing.appendingPathComponent("Playlist").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: existing.path))
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

    func testYtDlpExportsTemplateSubfoldersWithoutOverwritingFiles() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("template-export-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let staging = root.appendingPathComponent("staging")
        let target = root.appendingPathComponent("target")
        let name = "Playlist/Audio with spaces.mp3"
        let source = staging.appendingPathComponent(name)
        let existing = target.appendingPathComponent(name)
        try FileManager.default.createDirectory(at: source.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: existing.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("downloaded".utf8).write(to: source)
        try Data("existing".utf8).write(to: existing)
        let result = try IOSYtDlpExporter.copy([name], from: staging, to: target, videoId: "fixture")
        XCTAssertTrue(result.createdDirectories.isEmpty)
        XCTAssertEqual(result.files.first?["relativePath"] as? String, "Playlist/Audio with spaces (2).mp3")
        XCTAssertEqual(try Data(contentsOf: existing), Data("existing".utf8))
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: XCTUnwrap(result.destinations.first))), Data("downloaded".utf8))
    }

    func testYtDlpRollbackPreservesFilesAddedToTemplateFolders() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("rollback-preserve-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let staging = root.appendingPathComponent("staging")
        let target = root.appendingPathComponent("target")
        let name = "Playlist/fixture.mp4"
        try FileManager.default.createDirectory(at: staging.appendingPathComponent(name).deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        try Data("downloaded".utf8).write(to: staging.appendingPathComponent(name))
        let result = try IOSYtDlpExporter.copy([name], from: staging, to: target, videoId: "fixture")
        let externalFile = target.appendingPathComponent("Playlist/keep.txt")
        try Data("keep".utf8).write(to: externalFile)
        IOSYtDlpExporter.rollback(result.destinations, createdDirectories: result.createdDirectories)
        XCTAssertEqual(try Data(contentsOf: externalFile), Data("keep".utf8))
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.appendingPathComponent(name).path))
    }

    func testBundledFFmpegAndFFprobe() async throws {
        for tool in ["ffmpeg", "ffprobe"] {
            let result = try await Task.detached { try IOSFFmpeg.execute([tool, "-version"]) }.value
            XCTAssertEqual(result["returncode"] as? Int, 0)
            let output = (result["stdout"] as? String ?? "") + (result["stderr"] as? String ?? "")
            // The vendored-dependencies workflow updates FFmpegKit, so any release passes.
            XCTAssertTrue(output.hasPrefix("\(tool) version n"), output)
        }
        let media = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "mp4"))
        let result = try await Task.detached {
            try IOSFFmpeg.execute(["ffprobe", "-v", "quiet", "-show_streams", "-of", "json", media.path])
        }.value
        let data = try XCTUnwrap((result["stdout"] as? String)?.data(using: .utf8))
        let info = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertFalse((info["streams"] as? [[String: Any]] ?? []).isEmpty)
    }

    func testFFmpegMergeUsesSampleDurationForFragmentedTracks() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ffmpeg-duration-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let video = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fragmented-duration", withExtension: "mp4"))
        let audio = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "m4a"))
        let output = root.appendingPathComponent("merged.mp4")
        try Data("stale".utf8).write(to: output)
        let result = try await Task.detached {
            try IOSFFmpeg.execute(["ffmpeg", "-y", "-i", video.path, "-i", audio.path,
                                   "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest", output.path])
        }.value
        XCTAssertEqual(result["returncode"] as? Int, 0, result["stderr"] as? String ?? "")
        let asset = AVURLAsset(url: output)
        let duration = try await asset.load(.duration)
        XCTAssertEqual(duration.seconds, 2, accuracy: 0.1)
        let videoTracks = try await asset.loadTracks(withMediaType: .video)
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(videoTracks.count, 1)
        XCTAssertEqual(audioTracks.count, 1)
    }

    func testFFmpegAudioConversionAndCancellation() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ffmpeg-audio-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let audio = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "m4a"))
        let output = root.appendingPathComponent("converted with spaces.mp3")
        let result = try await Task.detached {
            try IOSFFmpeg.execute(["ffmpeg", "-y", "-i", audio.path, "-c:a", "libmp3lame", output.path])
        }.value
        XCTAssertEqual(result["returncode"] as? Int, 0, result["stderr"] as? String ?? "")
        XCTAssertTrue(FileManager.default.fileExists(atPath: output.path))
        let control = root.appendingPathComponent("control")
        let job = Task.detached {
            try IOSFFmpeg.execute(["ffmpeg", "-re", "-stream_loop", "-1", "-i", audio.path,
                                   "-f", "null", "-"], controlFile: control.path)
        }
        try await Task.sleep(for: .milliseconds(250))
        try Data().write(to: control)
        let cancelled = try await job.value
        XCTAssertEqual(cancelled["returncode"] as? Int, 255)
        let independent = try await Task.detached { try IOSFFmpeg.execute(["ffprobe", "-version"]) }.value
        XCTAssertEqual(independent["returncode"] as? Int, 0)
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
        _ = try await webView.callPageScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": ["enabled": true, "folder": String(decoding: reference, as: UTF8.self), "concurrency": 1]])
        let url = "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/blocked.mp4"
        var ids: [Int] = []
        for index in 1...3 {
            let started = try await webView.callPageScript(
                "return await Capacitor.Plugins.YtDlp.download({args: ['--no-playlist',url], payload: {mode: 'video', externalUrl: url, title: 'Queue fixture ' + index}})",
                arguments: ["url": url, "index": index]) as? [String: Any]
            ids.append(try XCTUnwrap(started?["id"] as? Int))
        }
        let moved = try await webView.callPageScript(
            "return (await Capacitor.Plugins.YtDlp.control({id, action: 'move', value: -1})).ok",
            arguments: ["id": ids[2]]) as? Bool
        XCTAssertEqual(moved, true)
        let listed = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.list()") as? [String: Any]
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
        let cancelledQueued = try await webView.callPageScript(
            "return (await Capacitor.Plugins.YtDlp.control({id, action: 'cancel'})).ok",
            arguments: ["id": ids[1]]) as? Bool
        XCTAssertEqual(cancelledQueued, true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: secondStage.path))
        let firstStage = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("yt-dlp-downloads/\(ids[0])", isDirectory: true)
        let firstProgress = firstStage.appendingPathComponent("progress.json")
        try Data(#"{"status":"downloading","percent":25,"speed":42,"eta":5}"#.utf8).write(to: firstProgress)
        _ = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.control({id, action: 'cancel'})",
            arguments: ["id": ids[0]])
        try await Task.sleep(nanoseconds: 850_000_000)
        let cancelledStatus = try await webView.callPageScript(
            "return (await Capacitor.Plugins.YtDlp.list()).downloads.find(record => record.id === id)?.status",
            arguments: ["id": ids[0]]) as? String
        XCTAssertEqual(cancelledStatus, "cancelled")
        connectionLock.lock()
        let openConnections = connections
        connectionLock.unlock()
        openConnections.forEach { $0.cancel() }
        listener.cancel()
        var thirdStatus = "queued"
        for _ in 0..<80 {
            thirdStatus = try await webView.callPageScript(
                "return (await Capacitor.Plugins.YtDlp.list()).downloads.find(record => record.id === id)?.status",
                arguments: ["id": ids[2]]) as? String ?? "missing"
            if thirdStatus != "queued" { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertNotEqual(thirdStatus, "queued")
        XCTAssertFalse(FileManager.default.fileExists(atPath: staleProgress.path))
        for id in ids {
            _ = try await webView.callPageScript(
                "return await Capacitor.Plugins.YtDlp.control({id, action: 'cancel'})",
                arguments: ["id": id])
        }
        for _ in 0..<80 {
            _ = try await webView.callPageScript(
                "return await Capacitor.Plugins.YtDlp.clear({ids})",
                arguments: ["ids": ids])
            let remaining = try await webView.callPageScript(
                "return (await Capacitor.Plugins.YtDlp.list()).downloads.filter(record => ids.includes(record.id)).length",
                arguments: ["ids": ids]) as? Int
            if remaining == 0 { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        let remaining = try await webView.callPageScript(
            "return (await Capacitor.Plugins.YtDlp.list()).downloads.filter(record => ids.includes(record.id)).length",
            arguments: ["ids": ids]) as? Int
        XCTAssertEqual(remaining, 0)
    }

    func testYtDlpRejectsUnsafeDownloadURL() async throws {
        try await openApplication()
        _ = try await webView.callPageScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration: {enabled: true}})",
            arguments: [:])
        for url in ["file:///etc/passwd", "ftp://example.org/video", "http://user:pass@example.org/video",
                    "https://example.org/" + String(repeating: "a", count: 8192)] {
            let result = try await webView.callPageScript(
                "return await Capacitor.Plugins.YtDlp.download({args: ['--no-playlist',url], payload: {mode: 'video', externalUrl: url}})",
                arguments: ["url": url]) as? [String: Any]
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

        let extracted = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.extract({args: [url]})",
            arguments: ["url": url]) as? [String: Any]
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
        _ = try await webView.callPageScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": configuration])
        let started = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.download({args: ['--no-playlist',url], payload: {mode: 'video', externalUrl: url, title: 'Fixture'}})",
            arguments: ["url": url]) as? [String: Any]
        let id = try XCTUnwrap(started?["id"] as? Int, String(describing: started))
        var record: [String: Any] = [:]
        for _ in 0..<120 {
            let listed = try await webView.callPageScript(
                "return await Capacitor.Plugins.YtDlp.list()") as? [String: Any]
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
        let opened = try await webView.callPageScript(
            "return (await Capacitor.Plugins.YtDlp.open({id})).ok",
            arguments: ["id": id]) as? Bool
        XCTAssertEqual(opened, true)
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        try await waitForNative { controller.presentedViewController is UIActivityViewController }
        if let activity = controller.presentedViewController { try await dismiss(activity) }
        let played = try await webView.callPageScript(
            "return (await Capacitor.Plugins.YtDlp.play({id})).ok",
            arguments: ["id": id]) as? Bool
        XCTAssertEqual(played, true)
        try await waitForNative { controller.presentedViewController is AVPlayerViewController }
        let player = try XCTUnwrap(controller.presentedViewController as? AVPlayerViewController)
        for _ in 0..<40 {
            if player.player?.currentTime().seconds ?? 0 > 0.1 { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertGreaterThan(player.player?.currentTime().seconds ?? 0, 0.1)
        try await dismiss(player)
        _ = try await webView.callPageScript("await testStore.dispatch('showSettingsWindow', 'downloads')")
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
        let missing = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.list()") as? [String: Any]
        let missingRecord = (missing?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id })
        XCTAssertEqual(missingRecord?["availability"] as? String, "missing")
        XCTAssertEqual((missingRecord?["files"] as? [[String: Any]])?.first?["available"] as? Bool, false)
        let missingPlayback = try await webView.callPageScript(
            "return (await Capacitor.Plugins.YtDlp.play({id})).ok",
            arguments: ["id": id]) as? Bool
        XCTAssertEqual(missingPlayback, false)
        let removed = try await webView.callPageScript(
            "return (await Capacitor.Plugins.YtDlp.remove({id})).ok",
            arguments: ["id": id]) as? Bool
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
        _ = try await webView.callPageScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": ["enabled": true, "folder": String(decoding: reference, as: UTF8.self), "concurrency": 1]])
        let payload: [String: Any] = ["mode": "video", "externalUrl": url, "title": "Slow fixture"]
        let started = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.download({payload, args: ['--no-playlist',payload.externalUrl]})",
            arguments: ["payload": payload]) as? [String: Any]
        let id = try XCTUnwrap(started?["id"] as? Int, String(describing: started))

        var record: [String: Any] = [:]
        for _ in 0..<120 {
            let listed = try await webView.callPageScript(
                "return await Capacitor.Plugins.YtDlp.list()") as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id }) ?? [:]
            if (record["percent"] as? Double ?? 0) > 0 { break }
            if ["completed", "failed"].contains(record["status"] as? String ?? "") { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "downloading", String(describing: record))
        XCTAssertGreaterThan(record["percent"] as? Double ?? 0, 0)
        let scene = try XCTUnwrap(webView.window?.windowScene)
        (scene.delegate as? SceneDelegate)?.sceneWillResignActive(scene)
        let cancelled = try await webView.callPageScript(
            "return (await Capacitor.Plugins.YtDlp.control({id, action: 'cancel'})).ok",
            arguments: ["id": id]) as? Bool
        XCTAssertEqual(cancelled, true)
        let staging = try XCTUnwrap(FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first)
            .appendingPathComponent("yt-dlp-downloads/\(id)")
        for _ in 0..<80 {
            if !FileManager.default.fileExists(atPath: staging.path) { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: staging.path))
        let retry = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.download({payload, args: ['--no-playlist',payload.externalUrl], retryDownloadId: id})",
            arguments: ["payload": payload, "id": id]) as? [String: Any]
        XCTAssertEqual(retry?["id"] as? Int, id, String(describing: retry))
        for _ in 0..<120 {
            let listed = try await webView.callPageScript(
                "return await Capacitor.Plugins.YtDlp.list()") as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id }) ?? [:]
            if ["completed", "failed"].contains(record["status"] as? String ?? "") { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "completed", String(describing: record))
        let destination = try XCTUnwrap(record["destination"] as? String)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: destination)).count, media.count)
        _ = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.remove({id})", arguments: ["id": id])

        let offlinePayload: [String: Any] = ["mode": "video", "externalUrl": "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/offline.mp4", "title": "Recovering fixture"]
        let failedStart = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.download({payload, args: ['--no-playlist',payload.externalUrl]})",
            arguments: ["payload": offlinePayload]) as? [String: Any]
        let failedId = try XCTUnwrap(failedStart?["id"] as? Int, String(describing: failedStart))
        for _ in 0..<80 {
            let listed = try await webView.callPageScript(
                "return await Capacitor.Plugins.YtDlp.list()") as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == failedId }) ?? [:]
            if record["status"] as? String == "failed" { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "failed", String(describing: record))
        XCTAssertFalse((record["errorMessage"] as? String ?? "").isEmpty)
        lock.lock(); offline = false; lock.unlock()
        let recovered = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.download({payload, args: ['--no-playlist',payload.externalUrl], retryDownloadId: id})",
            arguments: ["payload": offlinePayload, "id": failedId]) as? [String: Any]
        XCTAssertEqual(recovered?["id"] as? Int, failedId, String(describing: recovered))
        for _ in 0..<120 {
            let listed = try await webView.callPageScript(
                "return await Capacitor.Plugins.YtDlp.list()") as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == failedId }) ?? [:]
            if ["completed", "failed"].contains(record["status"] as? String ?? "") { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "completed", String(describing: record))
        _ = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.remove({id})", arguments: ["id": failedId])

        listener.cancel()
        let lostPayload: [String: Any] = ["mode": "video", "externalUrl": url.replacingOccurrences(of: "/slow.mp4", with: "/lost.mp4"),
                                          "title": "Disconnected fixture"]
        let lostStart = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.download({payload, args: ['--no-playlist',payload.externalUrl]})",
            arguments: ["payload": lostPayload]) as? [String: Any]
        let lostId = try XCTUnwrap(lostStart?["id"] as? Int)
        for _ in 0..<120 {
            let listed = try await webView.callPageScript(
                "return await Capacitor.Plugins.YtDlp.list()") as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == lostId }) ?? [:]
            if record["status"] as? String == "failed" { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "failed", String(describing: record))
        XCTAssertFalse((record["errorMessage"] as? String ?? "").isEmpty)
        _ = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.remove({id})", arguments: ["id": lostId])
    }

    func testYtDlpLiveExternalPlayback() async throws {
        try await openApplication()
        let mediaURL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
        _ = try await webView.callPageScript(
            "await testRouter.push({path: '/external-media', query: {url}})",
            arguments: ["url": mediaURL])
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
        let original = try await webView.callPageScript(
            "return testStore.getters.getVideoPlaybackEngine") as? String
        _ = try await webView.callPageScript("""
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
            """)
        _ = try await webView.callPageScript(
            "await testRouter.push('/subscriptions'); await testStore.dispatch('updateVideoPlaybackEngine', 'yt-dlp'); await testRouter.push('/watch/jNQXAC9IVRw')",
            arguments: [:])
        do {
            try await wait("(() => { const url = document.querySelector('video')?.currentSrc; return url?.startsWith('capacitor://localhost/_opentubex_media/') || url?.startsWith('blob:capacitor://localhost/'); })()", timeout: 90)
            try await wait("document.querySelector('video')?.readyState >= 2", timeout: 90)
            _ = try await evaluate("document.querySelector('video').play(); true")
            try await wait("document.querySelector('video').currentTime > 1", timeout: 30)
            let source = try await webView.callPageScript(
                "return document.querySelector('video').currentSrc") as? String
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
            _ = try? await webView.callPageScript(
                "Capacitor.nativePromise = window.__originalNativePromise; await testStore.dispatch('updateVideoPlaybackEngine', original)",
                arguments: ["original": original ?? "built-in"])
            throw error
        }
        _ = try await webView.callPageScript(
            "Capacitor.nativePromise = window.__originalNativePromise; await testStore.dispatch('updateVideoPlaybackEngine', original)",
            arguments: ["original": original ?? "built-in"])
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
        _ = try await webView.callPageScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": ["enabled": true, "folder": String(decoding: reference, as: UTF8.self), "concurrency": 1]])
        let url = "http://127.0.0.1:\(try XCTUnwrap(listener.port).rawValue)/slow.mp4"
        let started = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.download({args: ['--no-playlist',url], payload: {mode: 'video', externalUrl: url, title: 'Concurrent fixture'}})",
            arguments: ["url": url]) as? [String: Any]
        let id = try XCTUnwrap(started?["id"] as? Int)
        try await wait("!!document.querySelector('#app')")
        let mediaURL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
        _ = try await webView.callPageScript(
            "await testRouter.push({path: '/external-media', query: {url}})",
            arguments: ["url": mediaURL])
        try await wait("document.querySelector('video')?.readyState >= 2", timeout: 90)
        _ = try await evaluate("document.querySelector('video').play(); true")
        try await wait("document.querySelector('video').currentTime > 1", timeout: 30)
        let listed = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.list()") as? [String: Any]
        let record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id })
        XCTAssertEqual(record?["status"] as? String, "downloading", String(describing: record))
        XCTAssertGreaterThan(record?["percent"] as? Double ?? 0, 0)
        _ = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.control({id, action: 'cancel'})",
            arguments: ["id": id])
    }

    func testYtDlpLiveYouTubeDownload() async throws {
        try await openApplication()
        let videoId = "jNQXAC9IVRw"
        let mediaURL = "https://www.youtube.com/watch?v=\(videoId)"
        let extracted = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.extract({args: [url]})",
            arguments: ["url": mediaURL]) as? [String: Any]
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
        _ = try await webView.callPageScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": ["enabled": true, "folder": String(decoding: reference, as: UTF8.self), "concurrency": 1]])
        _ = try await webView.callPageScript(
            "window.iosProcessingEvents = []; window.iosProcessingListener = await Capacitor.Plugins.YtDlp.addListener('downloadStatus', record => { if (record.status === 'processing') iosProcessingEvents.push(record) })",
            arguments: [:])
        let started = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.download({args: ['--no-playlist','https://www.youtube.com/watch?v='+videoId], payload: {mode: 'video', videoId, title: 'Me at the zoo'}})",
            arguments: ["videoId": videoId]) as? [String: Any]
        let id = try XCTUnwrap(started?["id"] as? Int, String(describing: started))
        var record: [String: Any] = [:]
        for _ in 0..<360 {
            let listed = try await webView.callPageScript(
                "return await Capacitor.Plugins.YtDlp.list()") as? [String: Any]
            record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id }) ?? [:]
            if ["completed", "failed", "cancelled"].contains(record["status"] as? String ?? "") { break }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        XCTAssertEqual(record["status"] as? String, "completed", String(describing: record))
        let processing = try await webView.callPageScript(
            "return iosProcessingEvents.find(record => record.id === id)",
            arguments: ["id": id]) as? [String: Any]
        XCTAssertEqual(processing?["percent"] as? Double, 0)
        XCTAssertTrue(processing?["speed"] is NSNull)
        XCTAssertTrue(processing?["eta"] is NSNull)
        _ = try await webView.callPageScript("await iosProcessingListener.remove()")
        let destination = try XCTUnwrap(record["destination"] as? String)
        let size = try XCTUnwrap(FileManager.default.attributesOfItem(atPath: destination)[.size] as? Int)
        XCTAssertGreaterThan(size, 100_000)
        let mergedAsset = AVURLAsset(url: URL(fileURLWithPath: destination))
        let mergedVideoTracks = try await mergedAsset.loadTracks(withMediaType: .video)
        let mergedAudioTracks = try await mergedAsset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(mergedVideoTracks.count, 1)
        XCTAssertEqual(mergedAudioTracks.count, 1)
        let removed = try await webView.callPageScript(
            "return (await Capacitor.Plugins.YtDlp.remove({id})).ok",
            arguments: ["id": id]) as? Bool
        XCTAssertEqual(removed, true)

        let audioStart = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.download({args: ['--no-playlist','--extract-audio','https://www.youtube.com/watch?v='+videoId], payload: {mode: 'audio', videoId, title: 'Me at the zoo audio'}})",
            arguments: ["videoId": videoId]) as? [String: Any]
        let audioId = try XCTUnwrap(audioStart?["id"] as? Int)
        var audioRecord: [String: Any] = [:]
        for _ in 0..<240 {
            let listed = try await webView.callPageScript(
                "return await Capacitor.Plugins.YtDlp.list()") as? [String: Any]
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
        let played = try await webView.callPageScript(
            "return (await Capacitor.Plugins.YtDlp.play({id})).ok",
            arguments: ["id": audioId]) as? Bool
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
        _ = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.remove({id})",
            arguments: ["id": audioId])
    }

    func testYtDlpPersistenceSeed() async throws {
        try await openApplication()
        let folder = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
            .appendingPathComponent("yt-dlp-persistence", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let bookmark = try folder.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        let reference = try JSONSerialization.data(withJSONObject: ["name": folder.lastPathComponent,
                                                                     "bookmark": bookmark.base64EncodedString()])
        _ = try await webView.callPageScript(
            "await Capacitor.Plugins.YtDlp.configure({configuration})",
            arguments: ["configuration": ["enabled": true, "folder": String(decoding: reference, as: UTF8.self), "concurrency": 1]])
        let started = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.download({args: ['--no-playlist',url], payload: {mode: 'video', externalUrl: url, title: 'Persistence fixture'}})",
            arguments: ["url": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"]) as? [String: Any]
        let id = try XCTUnwrap(started?["id"] as? Int)
        var record: [String: Any] = [:]
        for _ in 0..<120 {
            let listed = try await webView.callPageScript(
                "return await Capacitor.Plugins.YtDlp.list()") as? [String: Any]
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
        let listed = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.list()") as? [String: Any]
        let record = (listed?["downloads"] as? [[String: Any]])?.first(where: { $0["id"] as? Int == id })
        XCTAssertEqual(record?["status"] as? String, "completed", String(describing: record))
        let destination = try XCTUnwrap(record?["destination"] as? String)
        let asset = AVURLAsset(url: URL(fileURLWithPath: destination))
        let videoTracks = try await asset.loadTracks(withMediaType: .video)
        XCTAssertEqual(videoTracks.count, 1)
        let played = try await webView.callPageScript(
            "return (await Capacitor.Plugins.YtDlp.play({id})).ok",
            arguments: ["id": id]) as? Bool
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
        _ = try await webView.callPageScript(
            "return await Capacitor.Plugins.YtDlp.remove({id})", arguments: ["id": id])
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination))
        UserDefaults.standard.removeObject(forKey: "iosYtDlpPersistenceTestId")
        try? FileManager.default.removeItem(at: URL(fileURLWithPath: destination).deletingLastPathComponent())
    }

    func testDownloadFolderPickerFieldTapAndDismissal() async throws {
        try await openApplication()
        let enabled = try await evaluate("testStore.getters.getEnableDownloads") as? Bool ?? false
        let previousFolder = try await evaluate("testStore.getters.getYtDlpDownloadFolderPath") as? String ?? ""
        addTeardownBlock { @MainActor [weak self] in
            _ = try? await self?.webView.callPageScript(
                "await testStore.dispatch('updateYtDlpDownloadFolderPath', folder); await testStore.dispatch('updateEnableDownloads', enabled); await testStore.dispatch('hideSettingsWindow')",
                arguments: ["folder": previousFolder, "enabled": enabled])
        }
        _ = try await webView.callPageScript(
            "await testStore.dispatch('updateYtDlpDownloadFolderPath', ''); await testStore.dispatch('updateEnableDownloads', true); await testStore.dispatch('showSettingsWindow')",
            arguments: [:])
        try await wait("!!document.querySelector('.settingsMenu button[data-section=download]')")
        _ = try await evaluate("document.querySelector('.settingsMenu button[data-section=download]').click(); true")
        try await wait("!!document.querySelector('.section[data-section=download] .ftPathPicker input')")

        // Tapping the read-only Download Folder field itself must open the native picker.
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        _ = try await evaluate("document.querySelector('.section[data-section=download] .ftPathPicker input').click(); true")
        try await waitForNative { controller.presentedViewController != nil }
        let firstPicker = try XCTUnwrap(controller.presentedViewController as? UIDocumentPickerViewController)
        let presentationController = try XCTUnwrap(firstPicker.presentationController)
        XCTAssertNotNil(presentationController.delegate)

        // Interactive sheet dismissal must clear the pending picker call so reopening works.
        try await dismiss(firstPicker)
        presentationController.delegate?.presentationControllerDidDismiss?(presentationController)

        _ = try await evaluate("document.querySelector('.section[data-section=download] .ftPathPicker input').click(); true")
        try await waitForNative { controller.presentedViewController != nil }
        let secondPicker = try XCTUnwrap(controller.presentedViewController as? UIDocumentPickerViewController)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("DownloadFolder-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        secondPicker.delegate?.documentPicker?(secondPicker, didPickDocumentsAt: [folder])
        try await dismiss(secondPicker)

        try await wait("document.querySelector('.section[data-section=download] .ftPathPicker input')?.value === '\(folder.lastPathComponent)'")
        let saved = try await evaluate("testStore.getters.getYtDlpDownloadFolderPath") as? String ?? ""
        XCTAssertTrue(saved.contains(folder.lastPathComponent))
    }
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
