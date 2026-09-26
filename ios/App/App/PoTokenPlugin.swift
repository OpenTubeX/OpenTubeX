import Capacitor
import WebKit

@objc(PoTokenPlugin)
public class PoTokenPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PoTokenPlugin"
    public let jsName = "PoToken"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise)]
    private var jobs: [UUID: TokenJob] = [:]

    @objc func generate(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let id = UUID()
            let job = TokenJob(call: call) { [weak self] in self?.jobs.removeValue(forKey: id) }
            self.jobs[id] = job
            job.start()
        }
    }
}

private final class TokenJob: NSObject, WKScriptMessageHandler, URLSessionTaskDelegate {
    private let call: CAPPluginCall
    private let completion: () -> Void
    private var webView: WKWebView?
    private var finished = false
    private lazy var session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: .main)

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

    init(call: CAPPluginCall, completion: @escaping () -> Void) {
        self.call = call
        self.completion = completion
    }

    func start() {
        do {
            guard let path = Bundle.main.url(forResource: "botGuardScript", withExtension: "js", subdirectory: "public"),
                  let videoId = call.getString("videoId"),
                  let context = call.getString("sessionContext"),
                  let attestation = call.getString("initialAttestationData"),
                  let config = call.getString("ytConfig") else { throw URLError(.badURL) }
            let arguments: [Any] = [videoId,
                try JSONSerialization.jsonObject(with: Data(context.utf8)),
                try JSONSerialization.jsonObject(with: Data(attestation.utf8)),
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
                if (result.error) pending.reject(new Error(result.error));
                else pending.resolve(new Response(result.body, { status: result.status }));
            };
            window.fetch = (url, options = {}) => new Promise((resolve, reject) => {
                const id = ++sequence; requests.set(id, { resolve, reject });
                window.webkit.messageHandlers.request.postMessage({ id, url: String(url), method: options.method || 'GET', headers: { 'User-Agent': navigator.userAgent, ...options.headers }, body: options.body || '' });
            });
            """
            let execution = prelude + script + ";\(source[range])(...\(encoded)).then(token => window.webkit.messageHandlers.token.postMessage({token})).catch(error => window.webkit.messageHandlers.token.postMessage({error:String(error)}));"
            configuration.userContentController.addUserScript(WKUserScript(source: execution, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
            let view = WKWebView(frame: .zero, configuration: configuration)
            webView = view
            // The challenge expects the YouTube origin; all fetches pass the
            // native allowlist and this document has no Capacitor bridge.
            view.loadHTMLString("<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'\"></head><body></body></html>", baseURL: URL(string: "https://www.youtube.com/"))
            DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in self?.finish(error: "PO token generation timed out") }
        } catch { finish(error: "Failed to prepare PO token generation: \(error.localizedDescription)") }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard !finished, let body = message.body as? [String: Any] else { return }
        if message.name == "token" {
            finish(token: body["token"] as? String, error: body["error"] as? String)
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
                if let error = error { self?.respond(id, ["error": error.localizedDescription]) }
                else { self?.respond(id, ["status": (response as? HTTPURLResponse)?.statusCode ?? 502, "body": String(decoding: data ?? Data(), as: UTF8.self)]) }
            }
        }.resume()
    }

    private func respond(_ id: Int, _ response: [String: Any]) {
        guard !finished, let data = try? JSONSerialization.data(withJSONObject: response) else { return }
        webView?.evaluateJavaScript("window.__respond(\(id),\(String(decoding: data, as: UTF8.self)))", completionHandler: nil)
    }

    private func finish(token: String? = nil, error: String? = nil) {
        guard !finished else { return }
        finished = true
        if let token = token, !token.isEmpty { call.resolve(["token": token]) }
        else { call.reject(error ?? "PO token generation failed") }
        session.invalidateAndCancel()
        webView?.stopLoading()
        webView?.configuration.userContentController.removeAllScriptMessageHandlers()
        webView = nil
        completion()
    }
}
