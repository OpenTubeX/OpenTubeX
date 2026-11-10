import Capacitor
import WebKit

@objc(PoTokenPlugin)
public class PoTokenPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PoTokenPlugin"
    public let jsName = "PoToken"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise)]
    /// BotGuard returns a longer token when it doesn't trust the attestation.
    static let maxAttestedPoTokenLength = 120

    /// Requests run one at a time on the main queue.
    private var queue: [() -> Void] = []
    private var running = false

    /// The view holding the current BotGuard attestation. A full BotGuard run
    /// takes a second or more, while minting from an attestation takes
    /// milliseconds, so later videos mint from it until it expires.
    private var attestation: BotGuardView?
    private var attestationExpiresAt = Date.distantPast
    private var expireAttestation: DispatchWorkItem?

    static func isAttested(_ token: String) -> Bool {
        token.utf8.count <= maxAttestedPoTokenLength
    }

    /// When to discard a new attestation, or nil if it can't mint later tokens:
    /// every token from an untrusted attestation is pending attestation too.
    static func attestationExpiry(token: String, startedAt: Date, validForSecs: Double, now: Date) -> Date? {
        let expiresAt = startedAt.addingTimeInterval(validForSecs)
        return isAttested(token) && expiresAt > now ? expiresAt : nil
    }

    @objc func generate(_ call: CAPPluginCall) {
        guard let videoId = call.getString("videoId"),
              let context = call.getString("sessionContext"),
              let attestationData = call.getString("initialAttestationData"),
              let config = call.getString("ytConfig") else {
            call.reject("Missing PO token parameters")
            return
        }
        DispatchQueue.main.async {
            self.enqueue {
                if self.attestation != nil, Date() >= self.attestationExpiresAt { self.discardAttestation() }
                guard let view = self.attestation else {
                    self.attest(call, videoId, context, attestationData, config)
                    return
                }
                view.mint(videoId) { token, _, error in
                    guard let token = token else {
                        NSLog("Failed to mint a PO token from the current attestation, attesting again: %@", error ?? "")
                        self.discardAttestation()
                        self.attest(call, videoId, context, attestationData, config)
                        return
                    }
                    if !Self.isAttested(token) { self.discardAttestation() }
                    self.resolve(call, token)
                }
            }
        }
    }

    private func attest(_ call: CAPPluginCall, _ videoId: String, _ context: String, _ attestationData: String, _ config: String) {
        let view: BotGuardView
        do {
            view = try BotGuardView(videoId: videoId, context: context, attestationData: attestationData, config: config)
        } catch {
            call.reject("Failed to prepare PO token generation: \(error.localizedDescription)")
            complete()
            return
        }
        // The attestation's lifetime starts during this run, so count it from before
        let startedAt = Date()
        view.attest { token, validForSecs, error in
            guard let token = token else {
                view.close()
                call.reject(error ?? "PO token generation failed")
                self.complete()
                return
            }
            let now = Date()
            if let expiresAt = Self.attestationExpiry(token: token, startedAt: startedAt, validForSecs: validForSecs, now: now) {
                self.attestation = view
                self.attestationExpiresAt = expiresAt
                // Release the view once it expires, even if no other video needs a token
                let expire = DispatchWorkItem { [weak self, weak view] in
                    self?.enqueue {
                        guard let self = self else { return }
                        if let view = view, self.attestation === view { self.discardAttestation() }
                        self.complete()
                    }
                }
                self.expireAttestation = expire
                DispatchQueue.main.asyncAfter(deadline: .now() + expiresAt.timeIntervalSince(now), execute: expire)
            } else {
                view.close()
            }
            self.resolve(call, token)
        }
    }

    private func resolve(_ call: CAPPluginCall, _ token: String) {
        call.resolve(["token": token])
        complete()
    }

    private func discardAttestation() {
        expireAttestation?.cancel()
        expireAttestation = nil
        attestation?.close()
        attestation = nil
    }

    private func enqueue(_ task: @escaping () -> Void) {
        queue.append(task)
        startNext()
    }

    private func complete() {
        running = false
        startNext()
    }

    private func startNext() {
        guard !running, !queue.isEmpty else { return }
        running = true
        queue.removeFirst()()
    }
}

/// A hidden WebView running YouTube's BotGuard program. Its fetches go through
/// the native allowlist, and the document has no Capacitor bridge.
private final class BotGuardView: NSObject, WKScriptMessageHandler, URLSessionTaskDelegate {
    typealias Completion = (_ token: String?, _ validForSecs: Double, _ error: String?) -> Void

    // bgutils-js can leave its callback-backed snapshot pending forever.
    private static let timeout: TimeInterval = 30
    private var webView: WKWebView?
    private let navigationGuard = PoTokenNavigationGuard()
    private lazy var session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: .main)
    private var pending: Completion?
    private var pendingTimeout: DispatchWorkItem?

    private func allows(_ url: URL, method: String) -> Bool {
        guard url.scheme == "https", url.user == nil, url.password == nil else { return false }
        return (method == "GET" && url.host == "www.google.com" && url.path.hasPrefix("/js/")) ||
            (method == "POST" && url.host == "www.youtube.com" && ["/youtubei/v1/att/get", "/api/jnn/v1/GenerateIT"].contains(url.path))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url, allows(url, method: request.httpMethod ?? "GET") else { completionHandler(nil); return }
        completionHandler(request)
    }

    init(videoId: String, context: String, attestationData: String, config: String) throws {
        super.init()
        guard let path = Bundle.main.url(forResource: "botGuardScript", withExtension: "js", subdirectory: "public") else {
            throw URLError(.badURL)
        }
        let arguments: [Any] = [videoId,
            try JSONSerialization.jsonObject(with: Data(context.utf8)),
            try JSONSerialization.jsonObject(with: Data(attestationData.utf8)),
            try JSONSerialization.jsonObject(with: Data(config.utf8))]
        let encoded = String(decoding: try JSONSerialization.data(withJSONObject: arguments), as: UTF8.self)
        let source = try String(contentsOf: path, encoding: .utf8)
        let pattern = try NSRegularExpression(pattern: "export\\{(\\w+) as default\\};")
        guard let match = pattern.firstMatch(in: source, range: NSRange(source.startIndex..., in: source)),
              let range = Range(match.range(at: 1), in: source) else { throw URLError(.cannotDecodeContentData) }
        let script = pattern.stringByReplacingMatches(in: source, range: NSRange(source.startIndex..., in: source), withTemplate: "")
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(self, name: "token")
        configuration.userContentController.add(self, name: "request")
        let prelude = """
        const requests = new Map(); let sequence = 0;
        window.__respond = (id, result) => {
            const pending = requests.get(id); if (!pending) return; requests.delete(id);
            if (result.error) pending.reject(result.network ? new TypeError('Failed to fetch: ' + result.error) : new Error(result.error));
            else pending.resolve(new Response(result.body, { status: result.status }));
        };
        window.fetch = (url, options = {}) => new Promise((resolve, reject) => {
            const id = ++sequence; requests.set(id, { resolve, reject });
            window.webkit.messageHandlers.request.postMessage({ id, url: String(url), method: options.method || 'GET', headers: { 'User-Agent': navigator.userAgent, ...options.headers }, body: options.body || '' });
        });
        """
        let execution = prelude + script + ";\(source[range])(...\(encoded)).then(token => window.webkit.messageHandlers.token.postMessage({token, validForSecs: window.ftPoTokenValidForSecs || 0})).catch(error => window.webkit.messageHandlers.token.postMessage({error:String(error)}));"
        configuration.userContentController.addUserScript(WKUserScript(source: execution, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = navigationGuard
        webView = view
    }

    /// Runs BotGuard and mints the first token.
    func attest(completion: @escaping Completion) {
        expect(completion, timeout: "PO token generation timed out")
        // The challenge expects the YouTube origin
        webView?.loadHTMLString("<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'\"></head><body></body></html>", baseURL: URL(string: "https://www.youtube.com/"))
    }

    /// Mints a token from the attestation of an earlier `attest` run.
    func mint(_ videoId: String, completion: @escaping Completion) {
        expect(completion, timeout: "PO token minting timed out")
        guard let id = try? JSONSerialization.data(withJSONObject: [videoId]) else {
            settle(error: "Failed to encode the video ID")
            return
        }
        let script = "void window.ftMintPoToken(...\(String(decoding: id, as: UTF8.self))).then(token => window.webkit.messageHandlers.token.postMessage({token})).catch(error => window.webkit.messageHandlers.token.postMessage({error:String(error)}))"
        webView?.evaluateJavaScript(script) { [weak self] _, error in
            if let error = error { self?.settle(error: error.localizedDescription) }
        }
    }

    /// JavaScript matches these deadline messages to tell a stuck BotGuard program from an outage.
    private func expect(_ completion: @escaping Completion, timeout message: String) {
        pending = completion
        let timeout = DispatchWorkItem { [weak self] in self?.settle(error: message) }
        pendingTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.timeout, execute: timeout)
    }

    private func settle(token: String? = nil, validForSecs: Double = 0, error: String? = nil) {
        guard let completion = pending else { return }
        pending = nil
        pendingTimeout?.cancel()
        pendingTimeout = nil
        if let token = token, !token.isEmpty { completion(token, validForSecs, nil) }
        else { completion(nil, 0, error ?? "BotGuard returned no PO token") }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard webView != nil, let body = message.body as? [String: Any] else { return }
        if message.name == "token" {
            settle(token: body["token"] as? String, validForSecs: body["validForSecs"] as? Double ?? 0, error: body["error"] as? String)
            return
        }
        guard let id = body["id"] as? Int, let raw = body["url"] as? String,
              let url = URL(string: raw), url.scheme == "https", let method = body["method"] as? String else { return }
        guard allows(url, method: method) else { respond(id, ["error": "Blocked token request"]); return }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.httpMethod = method
        if method == "POST" { request.httpBody = (body["body"] as? String)?.data(using: .utf8) }
        for (name, value) in body["headers"] as? [String: String] ?? [:] { request.setValue(value, forHTTPHeaderField: name) }
        if url.host == "www.google.com" {
            request.setValue("https://www.google.com/", forHTTPHeaderField: "Referer")
            request.setValue("https://www.google.com", forHTTPHeaderField: "Origin")
            request.setValue("script", forHTTPHeaderField: "Sec-Fetch-Dest")
            request.setValue("cross-site", forHTTPHeaderField: "Sec-Fetch-Site")
            request.setValue("*", forHTTPHeaderField: "Accept-Language")
        } else {
            request.setValue("https://www.youtube.com/", forHTTPHeaderField: "Referer")
            request.setValue("https://www.youtube.com", forHTTPHeaderField: "Origin")
            request.setValue("same-origin", forHTTPHeaderField: "Sec-Fetch-Site")
            request.setValue("same-origin", forHTTPHeaderField: "Sec-Fetch-Mode")
            request.setValue("false", forHTTPHeaderField: "X-Youtube-Bootstrap-Logged-In")
        }
        session.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                // The description is localized, so mark connection failures for JavaScript by their code.
                if let error = error { self?.respond(id, ["error": error.localizedDescription, "network": isConnectionFailure(error)]) }
                else { self?.respond(id, ["status": (response as? HTTPURLResponse)?.statusCode ?? 502, "body": String(decoding: data ?? Data(), as: UTF8.self)]) }
            }
        }.resume()
    }

    private func respond(_ id: Int, _ response: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: response) else { return }
        webView?.evaluateJavaScript("window.__respond(\(id),\(String(decoding: data, as: UTF8.self)))", completionHandler: nil)
    }

    /// Releases the view. The session and script handlers retain this object until then.
    func close() {
        pending = nil
        pendingTimeout?.cancel()
        pendingTimeout = nil
        session.invalidateAndCancel()
        webView?.stopLoading()
        webView?.configuration.userContentController.removeAllScriptMessageHandlers()
        webView = nil
    }
}
// BotGuard uses the YouTube origin, but its network requests go through the
// native allowlist above. A document redirect must never hand a watch URL to
// the installed YouTube app or replace the isolated challenge document.
class PoTokenNavigationGuard: NSObject, WKNavigationDelegate {
    private var initialDocumentAllowed = false

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
            return
        }
        let url = navigationAction.request.url
        // loadHTMLString uses its base URL for the initial document action.
        // Allow that one action, then reject every top-level redirect.
        if !initialDocumentAllowed, url?.scheme == "https", url?.host == "www.youtube.com",
           url?.path == "/", url?.query == nil {
            initialDocumentAllowed = true
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
    }
}
