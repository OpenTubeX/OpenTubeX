import Capacitor
import MediaPlayer

// Artwork URLs can come from any site, so they must not reach the user's
// network or the device itself. URLSession has no DNS hook, so each hop is
// resolved first. If DNS answers differently when URLSession connects, HTTPS
// still validates the certificate against the host, so a local server cannot
// complete the handshake and never receives the request.
func isPublicArtworkURL(_ url: URL) -> Bool {
    guard url.scheme == "https", url.user == nil, url.password == nil,
          let host = url.host?.trimmingCharacters(in: CharacterSet(charactersIn: "[]")), !host.isEmpty else { return false }
    var hints = addrinfo()
    hints.ai_socktype = SOCK_STREAM
    var result: UnsafeMutablePointer<addrinfo>?
    guard getaddrinfo(host, "443", &hints, &result) == 0, let first = result else { return false }
    defer { freeaddrinfo(first) }
    return sequence(first: first) { $0.pointee.ai_next }.allSatisfy { isPublicAddress($0.pointee) }
}

private func isPublicAddress(_ entry: addrinfo) -> Bool {
    guard let address = entry.ai_addr else { return false }
    if entry.ai_family == AF_INET {
        let ipv4 = address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr }
        return isPublicIPv4(withUnsafeBytes(of: ipv4) { Array($0) })
    }
    guard entry.ai_family == AF_INET6 else { return false }
    let ipv6 = address.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { $0.pointee.sin6_addr }
    let bytes = withUnsafeBytes(of: ipv6) { Array($0) }
    // IPv4-mapped and NAT64 addresses reach the embedded IPv4 address.
    if bytes[0..<12].elementsEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff]) ||
        bytes[0..<12].elementsEqual([0, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0]) {
        return isPublicIPv4(Array(bytes[12...]))
    }
    // Unspecified, loopback, IPv4-compatible, local-use NAT64, unique local, link-local, site-local, multicast.
    return !bytes[0..<12].allSatisfy { $0 == 0 } && !bytes[0..<6].elementsEqual([0, 0x64, 0xff, 0x9b, 0, 1]) &&
        bytes[0] & 0xfe != 0xfc && bytes[0] != 0xff &&
        !(bytes[0] == 0xfe && bytes[1] & 0x80 != 0)
}

private func isPublicIPv4(_ bytes: [UInt8]) -> Bool {
    let (first, second) = (bytes[0], bytes[1])
    // This network, private, CGNAT, loopback, link-local, multicast, reserved, broadcast.
    return first != 0 && first != 10 && first != 127 && first < 224 &&
        !(first == 100 && second & 0xc0 == 64) && !(first == 169 && second == 254) &&
        !(first == 172 && second & 0xf0 == 16) && !(first == 192 && second == 168)
}

// URLSession decompresses responses, so enforce the artwork budget while data
// arrives instead of after a completion handler has buffered all of it.
private final class ArtworkRequest: NSObject, URLSessionDataDelegate {
    private var data = Data()
    private var redirects = 0
    private let complete: (Data) -> Void

    init(complete: @escaping (Data) -> Void) {
        self.complete = complete
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        if data.count + chunk.count > 2 * 1024 * 1024 { dataTask.cancel() } else { data.append(chunk) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        redirects += 1
        // Runs on the session's own delegate queue, so resolving here blocks only this artwork.
        completionHandler(redirects <= 5 && request.url.map(isPublicArtworkURL) == true ? request : nil)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if error == nil { complete(data) }
        // The session retains this delegate until it is invalidated.
        session.finishTasksAndInvalidate()
    }
}

@objc(IOSMediaSessionPlugin)
public class IOSMediaSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IOSMediaSessionPlugin"
    public let jsName = "IOSMediaSession"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
                                CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)]
    private var handlers: [(command: MPRemoteCommand, token: Any, action: String)] = []
    private var artworkURL: String?
    private var artworkTask: URLSessionDataTask?

    public override func load() {
        let commands = MPRemoteCommandCenter.shared()
        let actions: [(MPRemoteCommand, String)] = [
            (commands.playCommand, "play"), (commands.pauseCommand, "pause"),
            (commands.stopCommand, "stop"), (commands.nextTrackCommand, "nexttrack"),
            (commands.previousTrackCommand, "previoustrack"),
            (commands.skipForwardCommand, "seekforward"), (commands.skipBackwardCommand, "seekbackward"),
            (commands.changePlaybackPositionCommand, "seekto")
        ]
        for (command, action) in actions {
            let handler = command.addTarget { [weak self] event in
                var details: [String: Any] = ["action": action]
                if let event = event as? MPChangePlaybackPositionCommandEvent { details["seekTime"] = event.positionTime }
                if let event = event as? MPSkipIntervalCommandEvent { details["seekOffset"] = event.interval }
                self?.notifyListeners("action", data: details)
                return .success
            }
            handlers.append((command, handler, action))
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard let state = call.getObject("state") else { call.reject("Missing media state"); return }
        DispatchQueue.main.async {
            let center = MPNowPlayingInfoCenter.default()
            var info: [String: Any] = [
                MPMediaItemPropertyTitle: state["title"] as? String ?? "",
                MPMediaItemPropertyArtist: state["artist"] as? String ?? "",
                MPMediaItemPropertyPlaybackDuration: state["duration"] as? Double ?? 0,
                MPNowPlayingInfoPropertyElapsedPlaybackTime: state["position"] as? Double ?? 0,
                MPNowPlayingInfoPropertyPlaybackRate: state["playbackState"] as? String == "playing" ? state["playbackRate"] as? Double ?? 1 : 0
            ]
            if let artwork = center.nowPlayingInfo?[MPMediaItemPropertyArtwork] { info[MPMediaItemPropertyArtwork] = artwork }
            center.nowPlayingInfo = info
            let actions = state["actions"] as? [String] ?? []
            for handler in self.handlers { handler.command.isEnabled = actions.contains(handler.action) }
            let artwork = state["artwork"] as? String ?? ""
            if artwork != self.artworkURL {
                self.artworkTask?.cancel()
                self.artworkURL = artwork
                center.nowPlayingInfo?.removeValue(forKey: MPMediaItemPropertyArtwork)
                if let url = URL(string: artwork), url.scheme == "https" {
                    // DNS can block, and an obsolete lookup must not delay newer artwork.
                    DispatchQueue.global(qos: .utility).async {
                        guard isPublicArtworkURL(url) else { return }
                        DispatchQueue.main.async { [weak self] in
                            guard let self, self.artworkURL == artwork else { return }
                            let request = ArtworkRequest { [weak self] data in
                                guard let image = UIImage(data: data) else { return }
                                DispatchQueue.main.async {
                                    guard self?.artworkURL == artwork else { return }
                                    center.nowPlayingInfo?[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                                }
                            }
                            self.artworkTask?.cancel()
                            self.artworkTask = URLSession(configuration: .default, delegate: request, delegateQueue: nil).dataTask(with: url)
                            self.artworkTask?.resume()
                        }
                    }
                }
            }
            // WebKit owns playback's audio session. Activating the app's session
            // here interrupts WebKit and pauses the video on every state update.
            call.resolve()
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.artworkTask?.cancel()
            self.artworkURL = nil
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            for handler in self.handlers { handler.command.isEnabled = false }
            call.resolve()
        }
    }

    deinit {
        artworkTask?.cancel()
        for handler in handlers { handler.command.removeTarget(handler.token) }
    }
}
