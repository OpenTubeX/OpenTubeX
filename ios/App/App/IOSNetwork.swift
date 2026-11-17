import UIKit
import Capacitor
import WebKit

// URLSession owns media transfers. Response bytes stream into WebKit's scheme
// handler instead of being copied through the Capacitor JSON bridge.
final class IOSNetwork: NSObject, URLSessionDataDelegate {
    static let shared = IOSNetwork()
    static func isMediaURL(_ url: URL) -> Bool {
        guard url.scheme == "https", let host = url.host?.lowercased(), url.user == nil, url.password == nil else { return false }
        return host == "googlevideo.com" || host.hasSuffix(".googlevideo.com")
    }
    private var prepared: [String: URLRequest] = [:]
    private var external: [String: URLRequest] = [:]
    private var externalOwners: [String: Set<String>] = [:]
    private var expiredExternal = Set<String>()
    private var transfers: [ObjectIdentifier: WKURLSchemeTask] = [:]
    private var tasks: [ObjectIdentifier: URLSessionDataTask] = [:]
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 120
        return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }()

    // A media response can remain active for the duration of a long video.
    // Keep the idle timeout, but use URLSession's default resource lifetime.
    private lazy var mediaSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }()

    func prepare(_ request: URLRequest) -> String {
        let id = UUID().uuidString
        prepared[id] = request
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            self?.prepared.removeValue(forKey: id)
        }
        return id
    }

    func prepareExternal(_ request: URLRequest) -> String {
        let id = UUID().uuidString
        external[id] = request
        DispatchQueue.main.asyncAfter(deadline: .now() + 7200) { [weak self] in
            self?.expireExternal(id)
        }
        return id
    }

    func expireExternal(_ id: String) {
        guard external[id] != nil else { return }
        expiredExternal.insert(id)
        removeExpiredExternal(id)
    }

    // A displayed source or casting control can outlive the cache's two-hour
    // expiry. Keep its original URL and headers until all owners release it.
    func retainMediaRequests(owner: String, urls: [URL]) {
        let previous = externalOwners[owner] ?? []
        let ids = Set(urls.compactMap { registeredMediaRequest($0) == nil ? nil : $0.lastPathComponent })
        if ids.isEmpty { externalOwners.removeValue(forKey: owner) }
        else { externalOwners[owner] = ids }
        for id in previous.subtracting(ids) { removeExpiredExternal(id) }
    }

    private func removeExpiredExternal(_ id: String) {
        if expiredExternal.contains(id) && !externalOwners.values.contains(where: { $0.contains(id) }) {
            external.removeValue(forKey: id)
            expiredExternal.remove(id)
        }
    }

    // Accessed on the main queue, like registration and the WebKit scheme handler.
    func registeredMediaRequest(_ url: URL) -> URLRequest? {
        let id = url.lastPathComponent
        guard url.scheme == "capacitor", url.host == "localhost", url.query == nil,
              url.path == "/_opentubex_media/\(id)" else { return nil }
        return external[id]
    }

    func abort(_ id: String) {
        prepared.removeValue(forKey: id)
        for task in Array(tasks.values) where task.taskDescription == id {
            if let target = transfers.removeValue(forKey: ObjectIdentifier(task)) {
                tasks.removeValue(forKey: ObjectIdentifier(target))
                target.didFailWithError(URLError(.cancelled))
            }
            task.cancel()
        }
    }

    func start(_ target: WKURLSchemeTask) {
        guard let id = target.request.url?.lastPathComponent,
              var request = prepared.removeValue(forKey: id) ?? external[id] else {
            target.didFailWithError(URLError(.resourceUnavailable))
            return
        }
        if external[id] != nil, let range = target.request.value(forHTTPHeaderField: "Range") {
            request.setValue(range, forHTTPHeaderField: "Range")
        }
        let task = (external[id] == nil ? session : mediaSession).dataTask(with: request)
        task.taskDescription = external[id] == nil ? id : "media:\(id)"
        transfers[ObjectIdentifier(task)] = target
        tasks[ObjectIdentifier(target)] = task
        task.resume()
    }

    func stop(_ target: WKURLSchemeTask) {
        guard let task = tasks.removeValue(forKey: ObjectIdentifier(target)) else { return }
        transfers.removeValue(forKey: ObjectIdentifier(task))
        task.cancel()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let target = transfers[ObjectIdentifier(dataTask)], let url = target.request.url,
              let http = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        var headers = [String: String]()
        for (key, value) in http.allHeaderFields { headers[String(describing: key)] = String(describing: value) }
        // SABR may be decompressed by URLSession. External media requests use
        // identity encoding so their original byte length and ranges survive.
        let removed = dataTask.taskDescription?.hasPrefix("media:") == true
            ? ["content-encoding", "transfer-encoding"]
            : ["content-encoding", "content-length", "transfer-encoding"]
        headers = headers.filter { !removed.contains($0.key.lowercased()) }
        headers["Cache-Control"] = "no-store"
        headers["X-OpenTubeX-Media-URL"] = response.url?.absoluteString
        if let result = HTTPURLResponse(url: url, statusCode: http.statusCode, httpVersion: "HTTP/1.1", headerFields: headers) {
            target.didReceive(result)
            completionHandler(.allow)
        } else { completionHandler(.cancel) }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        transfers[ObjectIdentifier(dataTask)]?.didReceive(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        let externalMedia = task.taskDescription?.hasPrefix("media:") == true
        let allowed = request.url.map { url in
            externalMedia
                ? url.scheme == "https" && url.user == nil && url.password == nil
                : Self.isMediaURL(url)
        } == true
        completionHandler(allowed ? request : nil)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let target = transfers.removeValue(forKey: ObjectIdentifier(task)) else { return }
        tasks.removeValue(forKey: ObjectIdentifier(target))
        if let error = error { target.didFailWithError(error) } else { target.didFinish() }
    }
}

final class IOSAssetHandler: NSObject, WKURLSchemeHandler {
    private let assets: WKURLSchemeHandler
    init(assets: WKURLSchemeHandler) { self.assets = assets }
    private func isTransfer(_ task: WKURLSchemeTask) -> Bool {
        task.request.url?.path.hasPrefix("/_opentubex_sabr/") == true ||
            task.request.url?.path.hasPrefix("/_opentubex_media/") == true
    }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        if isTransfer(task) { IOSNetwork.shared.start(task) } else { assets.webView(webView, start: task) }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        if isTransfer(task) { IOSNetwork.shared.stop(task) } else { assets.webView(webView, stop: task) }
    }
}

@objc(SabrHttpPlugin)
public class SabrHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SabrHttpPlugin"
    public let jsName = "SabrHttp"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
                                CAPPluginMethod(name: "abort", returnType: CAPPluginReturnPromise)]

    @objc func prepare(_ call: CAPPluginCall) {
        let method = call.getString("method") ?? "POST"
        guard let raw = call.getString("url"), let url = URL(string: raw), IOSNetwork.isMediaURL(url),
              ["POST", "GET", "HEAD"].contains(method) else {
            call.reject("Invalid SABR request")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if method == "POST" {
            guard let body = call.getString("body"), let data = Data(base64Encoded: body), data.count <= 1024 * 1024 else {
                call.reject("Invalid SABR request")
                return
            }
            request.httpBody = data
        }
        if let headers = call.getObject("headers") as? [String: String] {
            for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        }
        DispatchQueue.main.async { call.resolve(["requestId": IOSNetwork.shared.prepare(request)]) }
    }

    @objc func abort(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let id = call.getString("requestId") { IOSNetwork.shared.abort(id) }
            call.resolve()
        }
    }
}


// Small API requests need native cancellation too. Keep Capacitor's request and
// response semantics, but retain each task until it finishes or is cancelled.
@objc(IOSHttpPlugin)
public class IOSHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IOSHttpPlugin"
    public let jsName = "IOSHttp"
    public let pluginMethods: [CAPPluginMethod] = ["request", "abort"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }
    private var tasks: [String: URLSessionDataTask] = [:]

    @objc func request(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let id = call.getString("requestId"), !id.isEmpty, self.tasks[id] == nil,
                  let raw = call.getString("url"), let url = URL(string: raw),
                  ["https", "http"].contains(url.scheme), url.host != nil else {
                call.reject("Invalid API request")
                return
            }
            let request = CapacitorUrlRequest(url, method: call.getString("method") ?? "GET")
            request.setRequestHeaders(call.getObject("headers") ?? [:])
            request.setTimeout((call.getDouble("connectTimeout") ?? 30_000) / 1000)
            do {
                if let data = call.getString("data") { try request.setRequestBody(data) }
            } catch {
                call.reject(error.localizedDescription)
                return
            }
            // Each request owns its session so completion never invalidates
            // other concurrent API requests. Keep them stateless like desktop:
            // once YouTube recognizes a visitor it serves preroll ads, which
            // SABR enforces as long backoffs. Without a cache, every response
            // also proves to the renderer that the network is reachable.
            let configuration = URLSessionConfiguration.ephemeral
            configuration.urlCache = nil
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            let session = URLSession(configuration: configuration,
                                     delegate: call.getBool("disableRedirects") == true ? request : nil,
                                     delegateQueue: nil)
            let task = session.dataTask(with: request.getUrlRequest()) { [weak self] data, response, error in
                session.finishTasksAndInvalidate()
                DispatchQueue.main.async {
                    self?.tasks.removeValue(forKey: id)
                    if let error {
                        // Prefix connection failures like fetch does, so JavaScript
                        // waits to reconnect whatever the device language.
                        let message = error.localizedDescription
                        call.reject(isConnectionFailure(error) ? "Failed to fetch: \(message)" : message,
                                    (error as NSError).domain, error)
                    } else if let response = response as? HTTPURLResponse {
                        call.resolve(HttpRequestHandler.buildResponse(data, response,
                            responseType: ResponseType(string: call.getString("responseType"))))
                    } else {
                        call.reject("Missing HTTP response")
                    }
                }
            }
            self.tasks[id] = task
            task.resume()
        }
    }

    @objc func abort(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let id = call.getString("requestId") { self.tasks[id]?.cancel() }
            call.resolve()
        }
    }

    deinit {
        for task in tasks.values { task.cancel() }
    }
}

private let connectionFailures: Set<URLError.Code> = [
    .timedOut, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .networkConnectionLost,
    .notConnectedToInternet, .internationalRoamingOff, .callIsActive, .dataNotAllowed,
]

/// Whether a request failed to reach its server, so retrying after reconnecting can succeed.
/// URLSession localizes its descriptions, so native bridges classify errors by code.
func isConnectionFailure(_ error: Error) -> Bool {
    guard let code = (error as? URLError)?.code else { return false }
    return connectionFailures.contains(code)
}

/// Loads Rumble pages for the renderer. Rumble's Cloudflare front answers
/// requests without its cookie with a redirect to the same page, so the cookies
/// stay here, apart from the app's other requests, which keep none.
final class RumblePages: NSObject, URLSessionTaskDelegate {
    static let shared = RumblePages()
    private static let maxRedirects = 10
    private static let maxPageBytes = 10_000_000
    // For the page with all its redirects
    private static let timeout: TimeInterval = 30
    // The user agent of the app's other requests
    private static let appUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    private var session: URLSession!
    // Only Rumble's pages use them, so names are enough
    private var cookies: [String: HTTPCookie] = [:]
    // The browser's once the user passed Cloudflare's check there, as Cloudflare ties its cookie to it
    private var userAgent = RumblePages.appUserAgent
    private let lock = NSLock()

    init(configuration: URLSessionConfiguration = .ephemeral) {
        super.init()
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        // The request timeout only limits the time between bytes
        configuration.timeoutIntervalForResource = Self.timeout
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }

    static func isRumblePage(_ url: URL?) -> Bool {
        guard let url, url.scheme == "https", url.user == nil, url.password == nil, url.port == nil,
              let host = url.host?.lowercased() else { return false }
        return host == "rumble.com" || host.hasSuffix(".rumble.com")
    }

    /// Takes the cookies of a browser where the user passed Cloudflare's check.
    func acceptBrowserSession(cookies received: [HTTPCookie], userAgent: String) {
        let rumble = received.filter { cookie in
            let domain = cookie.domain.lowercased()
            return domain == "rumble.com" || domain.hasSuffix(".rumble.com")
        }
        lock.withLock {
            for cookie in rumble { cookies[cookie.name] = cookie }
            self.userAgent = userAgent
        }
    }

    func fetch(_ raw: String?) async throws -> (status: Int, text: String, challenge: Bool) {
        var url = raw.flatMap(URL.init(string:))
        let deadline = Date().addingTimeInterval(Self.timeout)
        var redirects = 0
        while true {
            guard let target = url, Self.isRumblePage(target) else { throw Self.error("Not a Rumble page") }
            let remaining = deadline.timeIntervalSinceNow
            if remaining <= 0 { throw Self.error("Timed out loading the Rumble page") }
            var request = URLRequest(url: target, timeoutInterval: remaining)
            // Cookies and user agent of the same browser
            let (agent, current) = lock.withLock { (userAgent, cookies.values.filter { ($0.expiresDate ?? .distantFuture) > Date() }) }
            request.setValue(agent, forHTTPHeaderField: "User-Agent")
            request.setValue("text/html", forHTTPHeaderField: "Accept")
            for (name, value) in HTTPCookie.requestHeaderFields(with: current) { request.setValue(value, forHTTPHeaderField: name) }
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw Self.error("Missing HTTP response") }
            let received = HTTPCookie.cookies(withResponseHeaderFields: response.allHeaderFields as? [String: String] ?? [:], for: target)
            lock.withLock { for cookie in received { cookies[cookie.name] = cookie } }
            if (300..<400).contains(response.statusCode), let location = response.value(forHTTPHeaderField: "Location") {
                if redirects == Self.maxRedirects { throw Self.error("Too many redirects") }
                redirects += 1
                url = URL(string: location, relativeTo: target)?.absoluteURL
                continue
            }
            if data.count > Self.maxPageBytes { throw Self.error("Rumble page is too large") }
            // Cloudflare wants a browser to pass its check first
            let challenge = response.value(forHTTPHeaderField: "cf-mitigated")?.lowercased() == "challenge"
            return (response.statusCode, String(decoding: data, as: UTF8.self), challenge)
        }
    }

    // Redirects return here to be checked and to keep their cookies
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    private static func error(_ message: String) -> NSError {
        NSError(domain: "RumblePages", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

/// Shows a Rumble page in a browser of its own, without the app's bridge, so
/// the user can pass Cloudflare's check. Once the page itself loads, its cookies
/// and user agent load Rumble's pages for the app: Cloudflare ties its cookie to
/// them, and only accepts it after its check loaded the page again. The browser
/// may only show Rumble pages.
final class RumbleChallengeController: UIViewController, WKNavigationDelegate, UIAdaptivePresentationControllerDelegate {
    private let url: URL
    private var onClose: (() -> Void)?
    private var webView: WKWebView?
    /// Whether the page that loads is Rumble's own, rather than Cloudflare's check, which answers with 403
    private var loadsPage = false

    init(url: URL, onClose: @escaping () -> Void) {
        self.url = url
        self.onClose = onClose
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "rumble.com"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(close))
        let configuration = WKWebViewConfiguration()
        // Apart from the app's other browsers, and gone once the user passed
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        view.addSubview(webView)
        self.webView = webView
        webView.load(URLRequest(url: url))
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        navigationController?.presentationController?.delegate = self
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // No new windows, and no other sites, apart from frames such as the check's
        guard let frame = navigationAction.targetFrame else { return decisionHandler(.cancel) }
        decisionHandler(!frame.isMainFrame || RumblePages.isRumblePage(navigationAction.request.url) ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame {
            let status = (navigationResponse.response as? HTTPURLResponse)?.statusCode ?? 0
            loadsPage = (200..<400).contains(status) && RumblePages.isRumblePage(navigationResponse.response.url)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard loadsPage else { return }
        loadsPage = false
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
            webView.evaluateJavaScript("navigator.userAgent") { [weak self] userAgent, _ in
                if let userAgent = userAgent as? String {
                    RumblePages.shared.acceptBrowserSession(cookies: cookies, userAgent: userAgent)
                }
                self?.close()
            }
        }
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { finish() }

    @objc private func close() {
        dismiss(animated: true) { [weak self] in self?.finish() }
    }

    private func finish() {
        webView?.stopLoading()
        onClose?()
        onClose = nil
    }
}
