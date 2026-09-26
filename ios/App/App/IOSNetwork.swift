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
    private var transfers: [Int: WKURLSchemeTask] = [:]
    private var tasks: [ObjectIdentifier: URLSessionDataTask] = [:]
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 120
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

    func abort(_ id: String) {
        prepared.removeValue(forKey: id)
        for task in Array(tasks.values) where task.taskDescription == id {
            if let target = transfers.removeValue(forKey: task.taskIdentifier) {
                tasks.removeValue(forKey: ObjectIdentifier(target))
                target.didFailWithError(URLError(.cancelled))
            }
            task.cancel()
        }
    }

    func start(_ target: WKURLSchemeTask) {
        guard let id = target.request.url?.lastPathComponent,
              let request = prepared.removeValue(forKey: id) else {
            target.didFailWithError(URLError(.resourceUnavailable))
            return
        }
        let task = session.dataTask(with: request)
        task.taskDescription = id
        transfers[task.taskIdentifier] = target
        tasks[ObjectIdentifier(target)] = task
        task.resume()
    }

    func stop(_ target: WKURLSchemeTask) {
        guard let task = tasks.removeValue(forKey: ObjectIdentifier(target)) else { return }
        transfers.removeValue(forKey: task.taskIdentifier)
        task.cancel()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let target = transfers[dataTask.taskIdentifier], let url = target.request.url,
              let http = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        var headers = [String: String]()
        for (key, value) in http.allHeaderFields { headers[String(describing: key)] = String(describing: value) }
        // URLSession has already decompressed the body.
        headers = headers.filter { !["content-encoding", "content-length", "transfer-encoding"].contains($0.key.lowercased()) }
        headers["Cache-Control"] = "no-store"
        headers["X-OpenTubeX-Media-URL"] = response.url?.absoluteString
        if let result = HTTPURLResponse(url: url, statusCode: http.statusCode, httpVersion: "HTTP/1.1", headerFields: headers) {
            target.didReceive(result)
            completionHandler(.allow)
        } else { completionHandler(.cancel) }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        transfers[dataTask.taskIdentifier]?.didReceive(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.map(Self.isMediaURL) == true ? request : nil)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let target = transfers.removeValue(forKey: task.taskIdentifier) else { return }
        tasks.removeValue(forKey: ObjectIdentifier(target))
        if let error = error { target.didFailWithError(error) } else { target.didFinish() }
    }
}

final class IOSAssetHandler: NSObject, WKURLSchemeHandler {
    private let assets: WKURLSchemeHandler
    init(assets: WKURLSchemeHandler) { self.assets = assets }
    private func isTransfer(_ task: WKURLSchemeTask) -> Bool {
        task.request.url?.path.hasPrefix("/_opentubex_sabr/") == true
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
