import XCTest
import Capacitor
import AVFoundation
import WebKit
import MediaPlayer
import Network
import AVKit
@testable import App

extension AppTests {
    func testDlnaPrivateAuthorizationStaysInScopeAcrossRedirects() async throws {
        var port: UInt16 = 0
        let upstream = try await loopbackServer { header, connection in
            let request = header.components(separatedBy: " ")[1]
            if request == "/private/start" {
                XCTAssertTrue(header.contains("Authorization: Basic fixture"))
                let next = "http://127.0.0.1:\(port)/private/final"
                connection.send(content: Data("HTTP/1.1 302 Found\r\nLocation: \(next)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { _ in connection.cancel() })
            } else if request == "/private/final" {
                XCTAssertTrue(header.contains("Authorization: Basic fixture"))
                let next = "http://127.0.0.1:\(port)/outside"
                connection.send(content: Data("HTTP/1.1 302 Found\r\nLocation: \(next)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { _ in connection.cancel() })
            } else {
                XCTAssertEqual(request, "/outside")
                XCTAssertFalse(header.lowercased().contains("authorization:"))
                connection.send(content: Data("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nmedia".utf8), completion: .contentProcessed { _ in connection.cancel() })
            }
        }
        defer { upstream.cancel() }
        port = try XCTUnwrap(upstream.port).rawValue
        let authorization = try XCTUnwrap(DlnaAuthorization(["url": "http://127.0.0.1:\(port)/private", "value": "Basic fixture"]))
        XCTAssertFalse(authorization.contains(URL(string: "http://127.0.0.1:\(port)/private-other")))
        XCTAssertFalse(authorization.contains(URL(string: "http://127.0.0.1:\(port + 1)/private")))
        let ready = expectation(description: "Private relay ready")
        let relay = try DlnaMediaServer(media: URLRequest(url: URL(string: "http://127.0.0.1:\(port)/private/start")!), authorization: authorization, address: "127.0.0.1", localAddress: "127.0.0.1") { _ in ready.fulfill() }
        defer { relay.close() }
        await fulfillment(of: [ready], timeout: 10)
        let url = try XCTUnwrap(URL(string: relay.mediaUrl))
        let (data, response) = try await URLSession.shared.data(from: url)
        XCTAssertEqual(data, Data("media".utf8))
        XCTAssertNil((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Authorization"))
        relay.expire()
        try await waitForNative { relay.muxFailed }
        do { _ = try await URLSession.shared.data(from: url); XCTFail("Expired cast relay still serves media") }
        catch { /* Expiration closes the listener before suspension. */ }
    }

    func testDlnaCastLifetimeReleasesOnStopExpirationAndDeniedAssertion() throws {
        var expiration: (() -> Void)?
        var ended = [UIBackgroundTaskIdentifier]()
        var denied = false
        let lifetime = DlnaCastLifetime(begin: { _, handler in
            expiration = handler
            return denied ? .invalid : UIBackgroundTaskIdentifier(rawValue: 123)
        }, finish: { ended.append($0) })
        var expired = 0
        XCTAssertTrue(lifetime.acquire { complete in expired += 1; complete() })
        XCTAssertNotEqual(lifetime.task, .invalid)
        lifetime.release()
        lifetime.release()
        XCTAssertEqual(ended.count, 1)
        XCTAssertEqual(expired, 0)
        XCTAssertTrue(lifetime.acquire { complete in expired += 1; complete() })
        expiration?()
        XCTAssertEqual(lifetime.task, .invalid)
        XCTAssertEqual(ended.count, 2)
        XCTAssertEqual(expired, 1)
        denied = true
        XCTAssertFalse(lifetime.acquire { complete in expired += 1; complete() })
        lifetime.release()
        XCTAssertEqual(ended.count, 2)
    }

    func testDlnaRegisteredRequestsSurviveExpiryUntilTheirLastOwnerReleases() throws {
        let network = IOSNetwork()
        var original = URLRequest(url: URL(string: "https://media.example/video.mp4")!)
        original.setValue("retained", forHTTPHeaderField: "X-Media-Token")
        let id = network.prepareExternal(original)
        let url = URL(string: "capacitor://localhost/_opentubex_media/\(id)")!
        let page = UUID().uuidString
        let control = UUID().uuidString
        network.retainMediaRequests(owner: page, urls: [url])
        network.retainMediaRequests(owner: control, urls: [url])
        network.expireExternal(id)
        XCTAssertEqual(network.registeredMediaRequest(url), original)
        network.retainMediaRequests(owner: page, urls: [])
        XCTAssertEqual(network.registeredMediaRequest(url)?.value(forHTTPHeaderField: "X-Media-Token"), "retained")
        let nextID = network.prepareExternal(URLRequest(url: URL(string: "https://media.example/next.mp4")!))
        let nextURL = URL(string: "capacitor://localhost/_opentubex_media/\(nextID)")!
        network.retainMediaRequests(owner: control, urls: [nextURL])
        XCTAssertNil(network.registeredMediaRequest(url), "Replacing a source releases its expired registration")
        network.expireExternal(nextID)
        XCTAssertNotNil(network.registeredMediaRequest(nextURL))
        network.retainMediaRequests(owner: control, urls: [])
        XCTAssertNil(network.registeredMediaRequest(nextURL))
        let unused = network.prepareExternal(original)
        network.expireExternal(unused)
        XCTAssertNil(network.registeredMediaRequest(URL(string: "capacitor://localhost/_opentubex_media/\(unused)")!), "Unowned registrations retain normal expiry")
    }

    func testDlnaRelayStreamsRangesAndHeadAndStops() async throws {
        let upstream = try await loopbackServer { header, connection in
            XCTAssertTrue(header.contains("User-Agent: OpenTubeX DLNA test"), header)
            let ranged = header.contains("Range: bytes=2-5")
            let response = ranged
                ? "HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 2-5/10\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\ncdef"
                : "HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n" + (header.hasPrefix("HEAD ") ? "" : "abcdefghij")
            connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
        }
        defer { upstream.cancel() }
        let media = try XCTUnwrap(URL(string: "http://127.0.0.1:\(try XCTUnwrap(upstream.port).rawValue)/video.mp4"))
        var registered = URLRequest(url: media)
        registered.setValue("OpenTubeX DLNA test", forHTTPHeaderField: "User-Agent")
        let id = IOSNetwork.shared.prepareExternal(registered)
        let nativeUrl = try XCTUnwrap(URL(string: "capacitor://localhost/_opentubex_media/\(id)"))
        let mediaRequest = try XCTUnwrap(IOSNetwork.shared.registeredMediaRequest(nativeUrl))
        XCTAssertNil(IOSNetwork.shared.registeredMediaRequest(URL(string: "capacitor://localhost/private")!))
        let ready = expectation(description: "DLNA relay ready")
        var startupError: Error?
        let relay = try DlnaMediaServer(media: mediaRequest, address: "127.0.0.1", localAddress: "127.0.0.1") { result in
            if case .failure(let error) = result { startupError = error }
            ready.fulfill()
        }
        defer { relay.close() }
        await fulfillment(of: [ready], timeout: 10)
        XCTAssertNil(startupError)
        let url = try XCTUnwrap(URL(string: relay.mediaUrl))
        var request = URLRequest(url: url)
        request.setValue("bytes=2-5", forHTTPHeaderField: "Range")
        let (bytes, result) = try await URLSession.shared.data(for: request)
        let response = try XCTUnwrap(result as? HTTPURLResponse)
        XCTAssertEqual(response.statusCode, 206)
        XCTAssertEqual(response.value(forHTTPHeaderField: "Content-Range"), "bytes 2-5/10")
        XCTAssertEqual(bytes, Data("cdef".utf8))
        request.httpMethod = "HEAD"
        request.setValue(nil, forHTTPHeaderField: "Range")
        let (headBytes, headResult) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((headResult as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual((headResult as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Length"), "10")
        XCTAssertTrue(headBytes.isEmpty)
        let wrong = try XCTUnwrap(URL(string: relay.mediaUrl.replacingOccurrences(of: relay.castId, with: "wrong-token")))
        let (_, denied) = try await URLSession.shared.data(from: wrong)
        XCTAssertEqual((denied as? HTTPURLResponse)?.statusCode, 404)
        relay.close()
        try await Task.sleep(nanoseconds: 100_000_000)
        do {
            _ = try await URLSession.shared.data(from: url)
            XCTFail("Stopped relay still listening")
        } catch { /* Closing the listener must reject subsequent requests. */ }
    }

    private func verifyMergedTracks(_ data: Data, height: Int) async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("dlna-merged-\(UUID().uuidString).mp4")
        try data.write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let asset = AVURLAsset(url: file)
        let videos = try await asset.loadTracks(withMediaType: .video)
        let audios = try await asset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(videos.count, 1)
        XCTAssertEqual(audios.count, 1)
        let reader = try AVAssetReader(asset: asset)
        let decodedAudio = AVAssetReaderTrackOutput(track: try XCTUnwrap(audios.first), outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM])
        reader.add(decodedAudio)
        XCTAssertTrue(reader.startReading())
        XCTAssertNotNil(decodedAudio.copyNextSampleBuffer(), "Merged AAC decodes to PCM")
        reader.cancelReading()
        let dimensions = try await XCTUnwrap(videos.first).load(.naturalSize)
        XCTAssertEqual(Int(dimensions.height), height)
        let generator = AVAssetImageGenerator(asset: asset)
        let frame = try await generator.image(at: .zero)
        XCTAssertGreaterThan(frame.image.width, 0)
    }

    func testDlnaMergesSeparateTracks() async throws {
        try await verifyDlnaMergedFixture(videoResource: "fixture")
    }

    func testDlnaMergedWriteTimeoutReportsFailure() async throws {
        let failed = expectation(description: "Stalled merged transfer requests recovery")
        let sent = expectation(description: "Write deadline expires")
        let listener = try makeLoopbackListener()
        var peer: NWConnection?
        let accepted = expectation(description: "Nonreading TV connected")
        listener.newConnectionHandler = { connection in
            peer = connection
            connection.start(queue: .main)
            accepted.fulfill()
        }
        try await startLoopbackListener(listener)
        defer { peer?.cancel(); listener.cancel() }
        let connection = NWConnection(host: "127.0.0.1", port: try XCTUnwrap(listener.port), using: .tcp)
        let request = URLRequest(url: URL(string: "http://127.0.0.1/video")!)
        let transfer = DlnaTransfer(connection, media: request, audio: request, startSeconds: 0, path: "/video", failure: { failed.fulfill() }, complete: {})
        defer { transfer.close() }
        await fulfillment(of: [accepted], timeout: 5)
        DispatchQueue.global().async {
            XCTAssertFalse(transfer.send(Data(repeating: 0, count: 16 * 1024 * 1024), timeout: .milliseconds(100)))
            sent.fulfill()
        }
        await fulfillment(of: [sent, failed], timeout: 3)
    }

    func testDlnaCancelledMuxDoesNotOpenUpstreamRequests() async throws {
        let unexpected = expectation(description: "Cancelled mux must not fetch tracks")
        unexpected.isInverted = true
        let source = try await loopbackServer { _, connection in
            unexpected.fulfill()
            connection.cancel()
        }
        defer { source.cancel() }
        let request = URLRequest(url: URL(string: "http://127.0.0.1:\(try XCTUnwrap(source.port).rawValue)/video")!)
        let muxer = DlnaMuxer()
        muxer.cancel()
        try await Task.detached {
            XCTAssertThrowsError(try muxer.stream(video: request, audio: request, startSeconds: 1) { _ in true }) {
                XCTAssertEqual(($0 as? URLError)?.code, .cancelled)
            }
        }.value
        await fulfillment(of: [unexpected], timeout: 0.5)
    }

    func testDlnaMergedDurationUsesFragmentSamples() async throws {
        try await verifyDlnaMergedFixture(videoResource: "fragmented-duration", duration: 2)
    }

    func testDlnaStartWithoutSegmentIndexReportsFailure() async throws {
        try await verifyDlnaMergedFixture(videoResource: "fragmented-duration", startSeconds: 1)
    }

    private func verifyDlnaMergedFixture(videoResource: String, duration: Double? = nil, startSeconds: Double = 0) async throws {
        let video = try Data(contentsOf: XCTUnwrap(Bundle(for: Self.self).url(forResource: videoResource, withExtension: "mp4")))
        let encoded = try Data(contentsOf: XCTUnwrap(Bundle(for: Self.self).url(forResource: "post-live-audio.m4a", withExtension: "b64")))
        let audio = try XCTUnwrap(Data(base64Encoded: encoded, options: .ignoreUnknownCharacters))
        let source = try await loopbackServer { header, connection in
            let bytes = header.hasPrefix("GET /audio ") ? audio : video
            connection.send(content: Data("HTTP/1.1 200 OK\r\nContent-Length: \(bytes.count)\r\nConnection: close\r\n\r\n".utf8) + bytes,
                            completion: .contentProcessed { _ in connection.cancel() })
        }
        defer { source.cancel() }
        let base = "http://127.0.0.1:\(try XCTUnwrap(source.port).rawValue)"
        let ready = expectation(description: "Merged relay ready")
        let relay = try DlnaMediaServer(media: URLRequest(url: URL(string: base + "/video")!),
                                       audio: URLRequest(url: URL(string: base + "/audio")!), startSeconds: startSeconds, address: "127.0.0.1", localAddress: "127.0.0.1") { _ in ready.fulfill() }
        defer { relay.close() }
        await fulfillment(of: [ready], timeout: 10)
        let url = try XCTUnwrap(URL(string: relay.mediaUrl))
        var range = URLRequest(url: url)
        range.setValue("bytes=100-", forHTTPHeaderField: "Range")
        let (_, rejected) = try await URLSession.shared.data(for: range)
        XCTAssertEqual((rejected as? HTTPURLResponse)?.statusCode, 416)
        let (data, response) = try await URLSession.shared.data(from: url)
        if startSeconds > 0 {
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 502)
            XCTAssertTrue(relay.muxFailed, "An unindexed nonzero start requests complete-source recovery")
            return
        }
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Accept-Ranges"), "none")
        try await verifyMergedTracks(data, height: 1080)
        if let duration {
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("dlna-duration-\(UUID().uuidString).mp4")
            try data.write(to: file)
            defer { try? FileManager.default.removeItem(at: file) }
            let measured = try await AVURLAsset(url: file).load(.duration)
            XCTAssertEqual(measured.seconds, duration, accuracy: 0.05)
        }
        print("DLNA merged fixture: native streaming H.264 + AAC, decoded 1080p frame")
    }

    func testDlnaRejectsTruncatedFullBox() async throws {
        func box(_ type: String, _ body: Data = Data()) -> Data {
            let size = UInt32(body.count + 8)
            return Data([UInt8(truncatingIfNeeded: size >> 24), UInt8(truncatingIfNeeded: size >> 16),
                         UInt8(truncatingIfNeeded: size >> 8), UInt8(truncatingIfNeeded: size)]) + Data(type.utf8) + body
        }
        // The container sizes are valid, but mdhd is missing its version and fields.
        let malformed = box("ftyp") + box("moov", box("trak", box("mdia", box("mdhd"))))
        let plain = try Data(contentsOf: XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture", withExtension: "m4a")))
        let source = try await loopbackServer { header, connection in
            let body = header.contains("/plain ") ? plain : malformed
            connection.send(content: Data("HTTP/1.1 200 OK\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8) + body,
                            completion: .contentProcessed { _ in connection.cancel() })
        }
        defer { source.cancel() }
        let request = URLRequest(url: URL(string: "http://127.0.0.1:\(try XCTUnwrap(source.port).rawValue)/video")!)
        let rejected = try await Task.detached { () -> Bool in
            do {
                try DlnaMuxer().stream(video: request, audio: request, startSeconds: 0) { _ in true }
                return false
            } catch {
                return (error as? URLError)?.code == .cannotDecodeContentData
            }
        }.value
        XCTAssertTrue(rejected, "Malformed MP4 fails cleanly without trapping")
        for path in ["video", "plain"] {
            let media = URLRequest(url: URL(string: "http://127.0.0.1:\(try XCTUnwrap(source.port).rawValue)/\(path)")!)
            let ready = expectation(description: "Invalid source relay ready")
            let relay = try DlnaMediaServer(media: media, audio: media, address: "127.0.0.1", localAddress: "127.0.0.1") { _ in ready.fulfill() }
            defer { relay.close() }
            await fulfillment(of: [ready], timeout: 10)
            let (_, response) = try await URLSession.shared.data(from: URL(string: relay.mediaUrl)!)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 502)
            XCTAssertTrue(relay.muxFailed, "Unsupported tracks report failure for complete-source recovery")
        }
    }

    func testDlnaMergesLiveYouTubeTracks() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["OTX_DLNA_YOUTUBE_TEST"] == "1", "Opt-in live YouTube test")
        let (json, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18773/sources")!)
        let sources = try XCTUnwrap(JSONSerialization.jsonObject(with: json) as? [String: Any])
        func request(_ key: String) throws -> URLRequest {
            var request = URLRequest(url: URL(string: try XCTUnwrap(sources[key] as? String))!)
            for (name, value) in sources["headers"] as? [String: String] ?? [:] { request.setValue(value, forHTTPHeaderField: name) }
            return request
        }
        let ready = expectation(description: "Live merged relay ready")
        let start = ProcessInfo.processInfo.systemUptime
        let relay = try DlnaMediaServer(media: request("videoUrl"), audio: request("audioUrl"),
                                       startSeconds: 100, address: "127.0.0.1", localAddress: "127.0.0.1") { _ in ready.fulfill() }
        defer { relay.close() }
        await fulfillment(of: [ready], timeout: 10)
        let (bytes, response) = try await URLSession.shared.bytes(from: URL(string: relay.mediaUrl)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let firstBytesMs = Int((ProcessInfo.processInfo.systemUptime - start) * 1000)
        let data = try await Task.detached(priority: .userInitiated) {
            var data = Data()
            for try await byte in bytes {
                data.append(byte)
                if data.count >= 2 * 1024 * 1024 { break }
            }
            return data
        }.value
        relay.close()
        try await verifyMergedTracks(data, height: 1080)
        print("DLNA live YouTube: 1080p60 + AAC, start at 100s, first bytes in \(firstBytesMs)ms, decoded frame from \(data.count) bytes")
    }

    func testDlnaDiscoveryAndControlThroughTheNativeBridge() async throws {
        try await verifyDlnaCastMenu(merged: false)
    }

    func testDlnaMergedTracksThroughTheCastMenu() async throws {
        try await verifyDlnaCastMenu(merged: true)
    }

    func testDlnaCastFixtureWaitsForPreviousPlayerTeardown() async throws {
        try await verifyDlnaCastMenu(merged: false, delayedTeardown: true)
    }

    func testDlnaPrivateInstanceAndFallbackThroughTheCastMenu() async throws {
        try await verifyDlnaCastMenu(merged: true, privateInstance: true)
    }

    func testDlnaNativeMuxStartupFailureUsesCompleteSourceThroughTheCastMenu() async throws {
        try await verifyDlnaCastMenu(merged: true, startupFailure: true)
    }

    func testDlnaRecoveryUsesTheIndexedKeyframeBaseThroughTheCastMenu() async throws {
        try await verifyDlnaCastMenu(merged: true, keyframeRecovery: true)
    }

    // Give the short fixture a segment beginning at 60s without needing live media.
    private func indexedDlnaTrack(_ source: Data) throws -> Data {
        var bytes = source
        func write(_ value: UInt64, to data: inout Data, at offset: Int, count: Int = 4) {
            for index in 0..<count { data[offset + index] = UInt8(truncatingIfNeeded: value >> ((count - index - 1) * 8)) }
        }
        let mdhd = try XCTUnwrap(bytes.range(of: Data("mdhd".utf8))).lowerBound
        let scaleOffset = mdhd + (bytes[mdhd + 4] == 0 ? 16 : 24)
        let scale = bytes[scaleOffset..<(scaleOffset + 4)].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        let tfdt = try XCTUnwrap(bytes.range(of: Data("tfdt".utf8))).lowerBound
        let timeWidth = bytes[tfdt + 4] == 0 ? 4 : 8
        write(60 * scale, to: &bytes, at: tfdt + 8, count: timeWidth)
        let fragment = try XCTUnwrap(bytes.range(of: Data("moof".utf8))).lowerBound - 4
        let end = try XCTUnwrap(bytes.range(of: Data("mfra".utf8))).lowerBound - 4
        bytes = bytes.subdata(in: 0..<end)
        var index = Data(repeating: 0, count: 44)
        write(44, to: &index, at: 0)
        index.replaceSubrange(4..<8, with: Data("sidx".utf8))
        write(1, to: &index, at: 12)
        write(1, to: &index, at: 16)
        write(60, to: &index, at: 20)
        write(1, to: &index, at: 30, count: 2)
        write(UInt64(bytes.count - fragment), to: &index, at: 32)
        write(2, to: &index, at: 36)
        write(0x90000000, to: &index, at: 40)
        bytes.insert(contentsOf: index, at: fragment)
        return bytes
    }

    private func verifyDlnaCastMenu(merged: Bool, privateInstance: Bool = false, startupFailure: Bool = false, keyframeRecovery: Bool = false, delayedTeardown: Bool = false) async throws {
        try await openApplication()
        let media = try Data(contentsOf: XCTUnwrap(Bundle(for: AppTests.self).url(forResource: "fixture", withExtension: "mp4")))
        let encodedAudio = try Data(contentsOf: XCTUnwrap(Bundle(for: Self.self).url(forResource: "post-live-audio.m4a", withExtension: "b64")))
        let audio = try XCTUnwrap(Data(base64Encoded: encodedAudio, options: .ignoreUnknownCharacters))
        let indexedVideo = keyframeRecovery ? try indexedDlnaTrack(media) : Data()
        let indexedAudio = keyframeRecovery ? try indexedDlnaTrack(audio) : audio
        let mdat = keyframeRecovery ? try XCTUnwrap(indexedVideo.range(of: Data("mdat".utf8))).lowerBound : 0
        let failedVideo = keyframeRecovery ? Data(indexedVideo.prefix(mdat + 5)) : Data()
        let lock = NSLock()
        var actions: [String] = []
        var castUri: URL?
        var receivedVideo: Data?
        var seekTarget: String?
        let transferred = expectation(description: "Local renderer receives MP4 from the iOS relay")
        let fixture = try await loopbackServer { header, connection in
            let description = "<root><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>iOS test TV</friendlyName><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/control</controlURL></service></serviceList></device></root>"
            func reply(_ body: Data, status: String = "200 OK", extra: String = "") {
                let response = "HTTP/1.1 \(status)\r\nContent-Length: \(body.count)\r\nAccess-Control-Allow-Origin: *\r\n\(extra)Connection: close\r\n\r\n"
                connection.send(content: Data(response.utf8) + (header.hasPrefix("HEAD ") ? Data() : body), completion: .contentProcessed { _ in connection.cancel() })
            }
            let isMedia = header.contains(" /real.mp4 ") || header.contains(" /audio.m4a ")
            if privateInstance && isMedia && !header.lowercased().contains("authorization: basic zml4dhvyztpzZWNyZXQ=".lowercased()) {
                reply(Data(), status: "401 Unauthorized")
                return
            }
            if !isMedia { XCTAssertFalse(header.lowercased().contains("authorization:"), "Receiver control must never receive instance credentials") }
            if header.contains(" /real.mp4 ") {
                let ranged = header.lowercased().contains("range: bytes=0-")
                reply(media, status: ranged ? "206 Partial Content" : "200 OK",
                      extra: "Content-Type: video/mp4\r\nAccept-Ranges: bytes\r\n" + (ranged ? "Content-Range: bytes 0-\(media.count - 1)/\(media.count)\r\n" : ""))
            } else if header.contains(" /indexed.mp4 ") || (keyframeRecovery && header.contains(" /audio.m4a ")) {
                // Fail after indexed startup and output headers, before video samples.
                let bytes = header.contains(" /indexed.mp4 ") ? failedVideo : indexedAudio
                let offset = header.lowercased().components(separatedBy: "range: bytes=").dropFirst().first?.components(separatedBy: "-").first.flatMap(Int.init)
                if let offset {
                    let total = bytes.count
                    reply(bytes.subdata(in: offset..<total), status: "206 Partial Content",
                          extra: "Content-Range: bytes \(offset)-\(total - 1)/\(total)\r\n")
                } else { reply(bytes) }
            } else if header.contains(" /audio.m4a ") {
                reply(privateInstance ? Data([0]) : audio, extra: "Content-Type: audio/mp4\r\n")
            } else if header.hasPrefix("POST ") {
                let action = header.components(separatedBy: "\r\n").first(where: { $0.lowercased().hasPrefix("soapaction:") })?
                    .components(separatedBy: "#").last?.replacingOccurrences(of: "\"", with: "").trimmingCharacters(in: .whitespaces) ?? ""
                lock.lock()
                actions.append(action)
                if action == "Seek" { seekTarget = header.components(separatedBy: "<Target>").dropFirst().first?.components(separatedBy: "</Target>").first }
                if action == "SetAVTransportURI", let uri = header.components(separatedBy: "<CurrentURI>").dropFirst().first?.components(separatedBy: "</CurrentURI>").first {
                    castUri = URL(string: uri.replacingOccurrences(of: "&amp;", with: "&"))
                }
                let uri = castUri
                let firstMergedPlay = keyframeRecovery && actions.filter { $0 == "Play" }.count == 1
                lock.unlock()
                if action == "Play", let uri {
                    var request = URLRequest(url: uri)
                    request.setValue("bytes=0-", forHTTPHeaderField: "Range")
                    URLSession.shared.dataTask(with: request) { data, response, error in
                        XCTAssertNil(error)
                        if firstMergedPlay {
                            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
                            reply(Data("<ok/>".utf8))
                            return
                        }
                        if privateInstance && (response as? HTTPURLResponse)?.statusCode == 502 {
                            reply(Data("<ok/>".utf8))
                            return
                        }
                        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, merged && !privateInstance && !startupFailure && !keyframeRecovery ? 200 : 206)
                        lock.lock(); receivedVideo = data; lock.unlock()
                        transferred.fulfill()
                        reply(Data("<ok/>".utf8))
                    }.resume()
                } else if action == "GetPositionInfo", keyframeRecovery {
                    reply(Data("<response><RelTime>00:00:10</RelTime></response>".utf8))
                } else { reply(Data("<ok/>".utf8)) }
            } else { reply(Data(description.utf8)) }
        }
        defer { fixture.cancel() }
        let port = try XCTUnwrap(fixture.port).rawValue
        let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        XCTAssertGreaterThanOrEqual(fd, 0)
        defer { Darwin.close(fd) }
        var reuse: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
        var local = sockaddr_in()
        local.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        local.sin_family = sa_family_t(AF_INET)
        local.sin_port = UInt16(1900).bigEndian
        let bound = withUnsafePointer(to: &local) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        XCTAssertEqual(bound, 0)
        var membership = ip_mreq()
        inet_pton(AF_INET, "239.255.255.250", &membership.imr_multiaddr)
        XCTAssertEqual(setsockopt(fd, IPPROTO_IP, IP_ADD_MEMBERSHIP, &membership, socklen_t(MemoryLayout<ip_mreq>.size)), 0)
        var timeout = timeval(tv_sec: 10, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        let responded = expectation(description: "SSDP fixture responds")
        // Use iOS's registered source URL, as yt-dlp does, and the real casting UI.
        var localRequest = URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/real.mp4")))
        if privateInstance { localRequest.setValue("Basic Zml4dHVyZTpzZWNyZXQ=", forHTTPHeaderField: "Authorization") }
        let id = IOSNetwork.shared.prepareExternal(localRequest)
        _ = try await evaluate("window.originalCastProtocols = [...testStore.getters.getCastProtocols]; true")
        let originalInstance = try await evaluate("testStore.getters.getCurrentInvidiousInstance") as? String ?? ""
        _ = try await evaluate("""
        window.findWatch = vnode => {
            if (vnode?.component?.type?.name === 'Watch') return vnode.component.proxy;
            const inner = vnode?.component?.subTree && findWatch(vnode.component.subTree);
            if (inner) return inner;
            for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
                const found = findWatch(child); if (found) return found;
            }
        }; window.dlnaOriginalNativePromise = window.Capacitor.nativePromise;
                window.Capacitor.nativePromise = function(plugin, method, options) {
                    if (plugin === 'Dlna' && method === 'hasFailed') {
                        return dlnaOriginalNativePromise.call(this, plugin, method, options).then(status => {
                            if (status.failed) window.dlnaFailedBase = status.baseSeconds;
                            return status;
                        });
                    }
                    if (plugin === 'Dlna' && method === 'startMediaServer') {
                        (window.dlnaStartAttempts ??= []).push(options);
                        if (window.dlnaStartupFailure && options.audioUrl) return Promise.reject(new Error('Fixture native mux startup failure'));
                    }
                    if (plugin === 'YtDlp' && method === 'extract' && options.args?.some(arg => arg.includes('DlnaTest001'))) {
                        return Promise.resolve({stdout: JSON.stringify({id:'DlnaTest001', formats:window.dlnaExtractionFormats ?? [], is_live:false})});
                    }
                    return dlnaOriginalNativePromise.call(this, plugin, method, options);
                };
                true;
        """)
        let audioId = IOSNetwork.shared.prepareExternal(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/audio.m4a")!))
        let videoId = keyframeRecovery ? IOSNetwork.shared.prepareExternal(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/indexed.mp4")!)) : id
        _ = try await webView.callPageScript("""
        window.dlnaMergedUi = merged;
        window.dlnaStartupFailure = startupFailure;
        window.dlnaKeyframeRecovery = keyframeRecovery;
        window.dlnaFailedBase = null;
        window.dlnaStartAttempts = [];
        window.dlnaExtractionFormats = merged ? [
            {url:videoSource, format_id:'299', protocol:'http', ext:'mp4', vcodec:'avc1.640028', acodec:'none', height:1080},
            {url:audioSource, format_id:'140', protocol:'http', ext:'m4a', vcodec:'none', acodec:'mp4a.40.2'}
        ] : [];
        await testRouter.push('/watch/DlnaTest001');
        """, arguments: ["merged": merged, "startupFailure": startupFailure, "keyframeRecovery": keyframeRecovery, "videoSource": "capacitor://localhost/_opentubex_media/\(videoId)", "audioSource": "capacitor://localhost/_opentubex_media/\(audioId)"])
        // Navigation preserves cached Watch state. Discard the fixture source
        // too, so neither the cached page nor its cast control retains it.
        let cleanup = "document.querySelector('video')?.pause(); if (dlnaKeyframeRecovery && window.dlnaOriginalCurrentTime) watchFixture.$refs.player.getCurrentTime=dlnaOriginalCurrentTime; watchFixture.legacyFormats=[]; testStore.commit('setCurrentInvidiousInstance', originalInstance); await testRouter.push('/subscriptions'); await testStore.dispatch('updateCastProtocols', originalCastProtocols); window.Capacitor.nativePromise=dlnaOriginalNativePromise"
        do {
            // Cancelling metadata during teardown can retain a destroyed player.
            let preparationReady = "(() => { const watch = findWatch(document.querySelector('#app').__vue_app__._container._vnode); return watch?.videoId === 'DlnaTest001' && watch.preparingVideoLoadGeneration === null && !watch.playerTeardownInProgress; })()"
            try await wait(preparationReady)
            let prepareSource = """
            window.watchFixture = findWatch(document.querySelector('#app').__vue_app__._container._vnode);
            await watchFixture.$nextTick();
            watchFixture.videoLoadGeneration++;
            Object.assign(watchFixture, {isLoading:false, ytDlpStreamsPending:false, errorMessage:null,
                isUpcoming:false, videoTitle:'Local DLNA MP4', videoLengthSeconds:2, activeFormat:'legacy',
                legacyFormats:[{itag:18,url,mimeType:'video/mp4',height:dlnaMergedUi?360:1080,qualityLabel:'1080p'}]});
            await testStore.dispatch('updateCastProtocols', originalCastProtocols.filter(protocol => protocol !== 'dlna'));
            """
            let sourceArguments = ["url": "capacitor://localhost/_opentubex_media/\(id)"]
            if delayedTeardown {
                _ = try await webView.callPageScript(prepareSource, arguments: sourceArguments)
                try await wait("!!document.querySelector('video') && watchFixture.$refs.player?.hasLoaded")
                _ = try await webView.callPageScript("""
                const previousPlayer = watchFixture.$refs.player;
                const destroy = previousPlayer.destroyPlayer;
                previousPlayer.destroyPlayer = async (...args) => {
                    const state = await destroy(...args);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return state;
                };
                void watchFixture.reloadView();
                """)
                try await wait("watchFixture.playerTeardownInProgress")
                try await wait(preparationReady)
            }
            _ = try await webView.callPageScript(prepareSource, arguments: sourceArguments)
            try await wait("!!document.querySelector('video') && watchFixture.$refs.player?.hasLoaded")
            if keyframeRecovery {
                _ = try await evaluate("window.dlnaOriginalCurrentTime=watchFixture.$refs.player.getCurrentTime; watchFixture.$refs.player.getCurrentTime=()=>65;true")
            }
            // Execute the same expiry callback as the two-hour timer while the
            // Watch page owns this source, before the cast control is enabled.
            IOSNetwork.shared.expireExternal(id)
            let retained = try XCTUnwrap(IOSNetwork.shared.registeredMediaRequest(URL(string: "capacitor://localhost/_opentubex_media/\(id)")!), "A visible Watch source must survive registration expiry")
            XCTAssertEqual(retained.url?.absoluteString, "http://127.0.0.1:\(port)/real.mp4")
            if privateInstance {
                // The credentials are their own setting, which only the instance they belong to receives
                _ = try await webView.callPageScript("""
                testStore.commit('setInvidiousInstanceCredentials', {instance, username: 'fixture', password: 'secret'});
                testStore.commit('setCurrentInvidiousInstance', instance);
                watchFixture.legacyFormats=watchFixture.legacyFormats.map(format=>({...format,url:videoSource}));
                window.dlnaExtractionFormats=dlnaExtractionFormats.map(format=>({...format,url:format.acodec==='none'?videoSource:audioSource}));
                """, arguments: ["instance": "http://127.0.0.1:\(port)", "videoSource": "http://127.0.0.1:\(port)/real.mp4", "audioSource": "http://127.0.0.1:\(port)/audio.m4a"])
            }
            _ = try await webView.callPageScript("await testStore.dispatch('updateCastProtocols', [...new Set([...originalCastProtocols, 'dlna'])])")
            try await wait("!!document.querySelector('.dlnaCastControl button')")
            // Begin waiting only once the player is ready; CI startup can exceed the UDP timeout.
            DispatchQueue.global().async {
                var buffer = [UInt8](repeating: 0, count: 8192)
                var remote = sockaddr_in()
                var length = socklen_t(MemoryLayout<sockaddr_in>.size)
                let count = withUnsafeMutablePointer(to: &remote) { pointer in
                    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { recvfrom(fd, &buffer, buffer.count, 0, $0, &length) }
                }
                if count > 0 {
                    var ip = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                    inet_ntop(AF_INET, &remote.sin_addr, &ip, socklen_t(ip.count))
                    let response = Data("HTTP/1.1 200 OK\r\nLOCATION: http://\(String(cString: ip)):\(port)/otx-ios-dlna-test.xml\r\n\r\n".utf8)
                    response.withUnsafeBytes { bytes in
                        withUnsafePointer(to: &remote) { pointer in
                            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                                _ = sendto(fd, bytes.baseAddress, bytes.count, 0, $0, length)
                            }
                        }
                    }
                }
                responded.fulfill()
            }
            _ = try await webView.callPageScript("document.querySelector('video').loop=true; await document.querySelector('video').play(); document.querySelector('.dlnaCastControl button').click()")
            try await wait("!!document.querySelector('.mobileLinkActions button[aria-label=\"iOS test TV\"]:not(:disabled)')")
            _ = try await evaluate("document.querySelector('video').currentTime=dlnaMergedUi?0:0.5;document.querySelector('.mobileLinkActions button[aria-label=\"iOS test TV\"]:not(:disabled)').click();true")
            try await wait("document.querySelector('.dlnaCastControl button')?.getAttribute('aria-pressed')==='true'")
            await fulfillment(of: [responded, transferred], timeout: 12)
            if !merged || privateInstance || startupFailure || keyframeRecovery { XCTAssertEqual(receivedVideo, media) }
            if keyframeRecovery {
                try await waitForNative {
                    lock.lock(); defer { lock.unlock() }
                    return seekTarget != nil
                }
                let base = try await evaluate("window.dlnaFailedBase") as? Double
                XCTAssertEqual(base, 60)
                XCTAssertEqual(seekTarget, "00:01:10", "Renderer time is relative to the 60s keyframe, not the 65s request")
                XCTAssertEqual(actions, ["SetAVTransportURI", "Play", "GetPositionInfo", "Stop", "SetAVTransportURI", "Play", "Seek"])
            }
            if startupFailure {
                let attempts = try await evaluate("dlnaStartAttempts.length") as? Int
                let retriedCompleteSource = try await evaluate("!!dlnaStartAttempts[0].audioUrl && !dlnaStartAttempts[1].audioUrl") as? Bool
                XCTAssertEqual(attempts, 2)
                XCTAssertEqual(retriedCompleteSource, true)
            }
            if !keyframeRecovery {
                if privateInstance { XCTAssertEqual(actions, ["SetAVTransportURI", "Play", "GetPositionInfo", "Stop", "SetAVTransportURI", "Play"]) }
                else { XCTAssertEqual(actions, merged ? ["SetAVTransportURI", "Play"] : ["SetAVTransportURI", "Play", "Seek"]) }
            }
            let paused = try await evaluate("document.querySelector('video').paused") as? Bool
            XCTAssertEqual(paused, true)
            try await waitForNative { UIApplication.shared.isIdleTimerDisabled }
            let controller = try XCTUnwrap(webView.window?.rootViewController as? OpenTubeXViewController)
            let nativeCast = try XCTUnwrap(controller.bridge?.plugin(withName: "Dlna") as? DlnaPlugin)
            XCTAssertNotEqual(nativeCast.castLifetime.task, .invalid, "A paused local video must leave a native cast background assertion")
            IOSNetwork.shared.expireExternal(audioId)
            if merged && !privateInstance {
                XCTAssertNotNil(IOSNetwork.shared.registeredMediaRequest(URL(string: "capacitor://localhost/_opentubex_media/\(audioId)")!), "Merged sources remain registered for the casting control lifetime")
            }
            let received = FileManager.default.temporaryDirectory.appendingPathComponent("dlna-received-\(UUID().uuidString).mp4")
            defer { try? FileManager.default.removeItem(at: received) }
            try XCTUnwrap(receivedVideo).write(to: received)
            if merged && !privateInstance && !startupFailure && !keyframeRecovery { try await verifyMergedTracks(try XCTUnwrap(receivedVideo), height: 1080) }
            let asset = AVURLAsset(url: received)
            let duration = try await asset.load(.duration)
            XCTAssertEqual(duration.seconds, 2, accuracy: 0.05)
            let generator = AVAssetImageGenerator(asset: asset)
            let (image, _) = try await generator.image(at: .zero)
            XCTAssertGreaterThan(image.width, 0)
            _ = try await evaluate("document.querySelector('.dlnaCastControl button').click();true")
            try await wait("!!document.querySelector('.mobileLinkActions button[aria-label=\"Stop casting\"]:not(:disabled)')")
            _ = try await evaluate("document.querySelector('.mobileLinkActions button[aria-label=\"Stop casting\"]:not(:disabled)').click();true")
            try await wait("document.querySelector('.dlnaCastControl button')?.getAttribute('aria-pressed')==='false' && !document.querySelector('video').paused")
            XCTAssertEqual(actions.last, "Stop")
            XCTAssertEqual(nativeCast.castLifetime.task, .invalid, "Stop releases the cast background assertion")
            do {
                _ = try await URLSession.shared.data(from: XCTUnwrap(castUri))
                XCTFail("Cast relay still listening after Stop casting")
            } catch { /* Stop must close the native media server. */ }
            _ = try await evaluate("document.querySelector('video').pause();true")
            try await waitForNative { !UIApplication.shared.isIdleTimerDisabled }
            print("DLNA UI \(merged ? "streaming merge" : "complete MP4"): discovered renderer, Play/Stop, decoded frame, resumed local playback, closed relay")
        } catch {
            _ = try? await webView.callPageScript(cleanup, arguments: ["originalInstance": originalInstance])
            throw error
        }
        _ = try await webView.callPageScript(cleanup, arguments: ["originalInstance": originalInstance])
        try await waitForNative {
            IOSNetwork.shared.registeredMediaRequest(URL(string: "capacitor://localhost/_opentubex_media/\(id)")!) == nil &&
                IOSNetwork.shared.registeredMediaRequest(URL(string: "capacitor://localhost/_opentubex_media/\(audioId)")!) == nil
        }
    }

    func testDlnaPluginAndOptInSettingAreAvailable() async throws {
        try await openApplication()
        let available = try await evaluate("Capacitor.isPluginAvailable('Dlna')") as? Bool
        XCTAssertEqual(available, true)
        _ = try await webView.callPageScript("testStore.commit('setSettingsWindowSection', 'player'); await testStore.dispatch('showSettingsWindow')")
        try await wait("!!document.querySelector('.settingsWindow [data-setting-key=\"castProtocols\"]')")
        _ = try await webView.callPageScript("const original = [...testStore.getters.getCastProtocols]; await testStore.dispatch('updateCastProtocols', original.includes('dlna') ? [] : ['dlna']); await testStore.dispatch('updateCastProtocols', original); await testStore.dispatch('hideSettingsWindow')")
    }
}
