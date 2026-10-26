import Capacitor
import MediaPlayer

// URLSession decompresses responses, so enforce the artwork budget while data
// arrives instead of after a completion handler has buffered all of it.
private final class ArtworkRequest: NSObject, URLSessionDataDelegate {
    private var data = Data()
    private let complete: (Data) -> Void

    init(complete: @escaping (Data) -> Void) {
        self.complete = complete
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        if data.count + chunk.count > 2 * 1024 * 1024 { dataTask.cancel() } else { data.append(chunk) }
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
                    let request = ArtworkRequest { [weak self] data in
                        guard let image = UIImage(data: data) else { return }
                        DispatchQueue.main.async {
                            guard self?.artworkURL == artwork else { return }
                            center.nowPlayingInfo?[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                        }
                    }
                    self.artworkTask = URLSession(configuration: .default, delegate: request, delegateQueue: nil).dataTask(with: url)
                    self.artworkTask?.resume()
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
