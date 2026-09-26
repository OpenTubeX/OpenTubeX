import Capacitor
import MediaPlayer

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
                    self.artworkTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
                        guard let data = data, data.count <= 2 * 1024 * 1024, let image = UIImage(data: data) else { return }
                        DispatchQueue.main.async {
                            guard self?.artworkURL == artwork else { return }
                            center.nowPlayingInfo?[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                        }
                    }
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
