import UIKit
import Capacitor
import AppShortcutsPlugin

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    private var bridge: CAPBridgeProtocol? { (window?.rootViewController as? OpenTubeXViewController)?.bridge }

    func sceneWillResignActive(_ scene: UIScene) {
        // Visibility events arrive after WebKit may have suspended inline video.
        bridge?.triggerJSEvent(eventName: "opentubex:prepare-background", target: "window")
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        // Control Center, alerts and the app switcher only resign activity. UIKit
        // calls this before WebKit learns about the background, and WebKit runs
        // this script before it suspends inline video, unlike the bridge's
        // deferred events.
        bridge?.webView?.evaluateJavaScript("window.dispatchEvent(new Event('opentubex:enter-background'))")
        // Switching to audio reloads the stream, which plays nothing for a moment.
        // iOS must not suspend the app before the audio starts.
        endAudioSwitchTask()
        let task = UIApplication.shared.beginBackgroundTask(withName: "Switch to audio") { [weak self] in
            self?.endAudioSwitchTask()
        }
        audioSwitchTask = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            if self?.audioSwitchTask == task { self?.endAudioSwitchTask() }
        }
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        endAudioSwitchTask()
        bridge?.webView?.evaluateJavaScript("window.dispatchEvent(new Event('opentubex:enter-foreground'))")
    }

    private var audioSwitchTask = UIBackgroundTaskIdentifier.invalid

    private func endAudioSwitchTask() {
        guard audioSwitchTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(audioSwitchTask)
        audioSwitchTask = .invalid
    }

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = OpenTubeXViewController()
        window?.makeKeyAndVisible()
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)

        if let shortcut = connectionOptions.shortcutItem { deliver(shortcut) }
    }

    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        deliver(shortcutItem)
        completionHandler(true)
    }

    private func deliver(_ shortcut: UIApplicationShortcutItem) {
        // Ensure the plugin exists before posting; it retains the event until
        // the renderer's startup listener consumes it.
        window?.rootViewController?.loadViewIfNeeded()
        NotificationCenter.default.post(name: NSNotification.Name(AppShortcutsPlugin.notificationName), object: nil,
                                        userInfo: [AppShortcutsPlugin.userInfoShortcutItemKey: shortcut])
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
