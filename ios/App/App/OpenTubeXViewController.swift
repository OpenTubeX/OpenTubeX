import AVFoundation
import Capacitor
import GameController
import WebKit

class OpenTubeXViewController: CAPBridgeViewController {
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let defaults = super.webViewConfiguration(for: instanceConfiguration)
        let configuration = IOSWebViewConfiguration()
        configuration.websiteDataStore = defaults.websiteDataStore
        configuration.preferences = defaults.preferences
        configuration.defaultWebpagePreferences = defaults.defaultWebpagePreferences
        configuration.applicationNameForUserAgent = defaults.applicationNameForUserAgent
        configuration.allowsInlineMediaPlayback = defaults.allowsInlineMediaPlayback
        configuration.allowsAirPlayForMediaPlayback = defaults.allowsAirPlayForMediaPlayback
        configuration.suppressesIncrementalRendering = defaults.suppressesIncrementalRendering
        configuration.mediaTypesRequiringUserActionForPlayback = defaults.mediaTypesRequiringUserActionForPlayback
        configuration.limitsNavigationsToAppBoundDomains = defaults.limitsNavigationsToAppBoundDomains
        configuration.allowsPictureInPictureMediaPlayback = true
        return configuration
    }

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let view = super.webView(with: frame, configuration: configuration)
        if #available(iOS 16.4, *) {
            #if DEBUG
            view.isInspectable = true
            #endif
        }
        return view
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PoTokenPlugin())
        bridge?.registerPluginInstance(SabrHttpPlugin())
        bridge?.registerPluginInstance(IOSHttpPlugin())
        bridge?.registerPluginInstance(IOSStoragePlugin())
        bridge?.registerPluginInstance(IOSMediaSessionPlugin())
        bridge?.registerPluginInstance(ScreenshotPlugin())
        bridge?.registerPluginInstance(IOSUiPlugin())
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, options: [.allowAirPlay])
        } catch { NSLog("Could not configure playback audio session: %@", error.localizedDescription) }
    }


}

@objc(IOSUiPlugin)
public class IOSUiPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IOSUiPlugin"
    public let jsName = "IOSUi"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getHardwareKeyboardState", returnType: CAPPluginReturnPromise)
    ]

    public override func load() {
        for name in [NSNotification.Name.GCKeyboardDidConnect, NSNotification.Name.GCKeyboardDidDisconnect] {
            NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged), name: name, object: nil)
        }
    }

    @objc func getHardwareKeyboardState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["attached": GCKeyboard.coalesced != nil]) }
    }

    @objc private func keyboardChanged() {
        DispatchQueue.main.async {
            self.bridge?.triggerJSEvent(eventName: "opentubex:hardware-keyboard", target: "window",
                                       data: "{\"attached\":\(GCKeyboard.coalesced != nil)}")
        }
    }

    deinit { NotificationCenter.default.removeObserver(self) }
}

private final class IOSWebViewConfiguration: WKWebViewConfiguration {
    // WebKit rejects replacing even a custom scheme handler after registration.
    // Decorate Capacitor's initial registration instead, preserving its assets.
    override func setURLSchemeHandler(_ handler: WKURLSchemeHandler?, forURLScheme scheme: String) {
        if scheme == "capacitor", let handler = handler {
            super.setURLSchemeHandler(IOSAssetHandler(assets: handler), forURLScheme: scheme)
        } else {
            super.setURLSchemeHandler(handler, forURLScheme: scheme)
        }
    }
}
