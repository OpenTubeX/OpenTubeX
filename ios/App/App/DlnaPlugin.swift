import Capacitor
import Darwin
import Foundation
import Network
import UIKit

private let dlnaQueue = DispatchQueue(label: "org.opentubex.dlna")

private func ipv4Address(_ host: String, port: UInt16 = 0) throws -> sockaddr_in {
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = port.bigEndian
    guard inet_pton(AF_INET, host, &address.sin_addr) == 1 else { throw URLError(.badURL) }
    return address
}

private func addressString(_ address: in_addr) -> String {
    var address = address
    var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
    inet_ntop(AF_INET, &address, &buffer, socklen_t(buffer.count))
    return String(cString: buffer)
}

// UIKit grants bounded background time. Expiration stops the relay rather than
// leaving an unprotected listener and an unfinished assertion behind.
final class DlnaCastLifetime {
    private(set) var task = UIBackgroundTaskIdentifier.invalid
    private let begin: (String, @escaping () -> Void) -> UIBackgroundTaskIdentifier
    private let finish: (UIBackgroundTaskIdentifier) -> Void

    init(begin: @escaping (String, @escaping () -> Void) -> UIBackgroundTaskIdentifier = {
        UIApplication.shared.beginBackgroundTask(withName: $0, expirationHandler: $1)
    }, finish: @escaping (UIBackgroundTaskIdentifier) -> Void = { UIApplication.shared.endBackgroundTask($0) }) {
        self.begin = begin
        self.finish = finish
    }

    func acquire(expired: @escaping (@escaping () -> Void) -> Void) -> Bool {
        precondition(Thread.isMainThread)
        release()
        task = begin("OpenTubeX DLNA cast") { [weak self] in
            guard let self else { return }
            let previous = self.task
            expired { [weak self] in
                if self?.task == previous { self?.release() }
            }
        }
        return task != .invalid
    }

    func release() {
        precondition(Thread.isMainThread)
        guard task != .invalid else { return }
        let previous = task
        task = .invalid
        finish(previous)
    }
}

struct DlnaAuthorization {
    let url: URL
    let value: String
    private var path: String { url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }

    init?(_ options: JSObject?) {
        guard let raw = options?["url"] as? String, let url = URL(string: raw),
              ["http", "https"].contains(url.scheme), url.host != nil, url.user == nil, url.password == nil,
              let value = options?["value"] as? String, !value.isEmpty, value.utf8.count <= 4096,
              !value.contains("\r"), !value.contains("\n") else { return nil }
        self.url = url
        self.value = value
    }

    func contains(_ source: URL?) -> Bool {
        guard let source else { return false }
        let port = { (url: URL) in url.port ?? (url.scheme == "https" ? 443 : 80) }
        let prefix = path.isEmpty ? "" : "/" + path
        return source.scheme == url.scheme && source.host?.lowercased() == url.host?.lowercased() && port(source) == port(url) &&
            (source.path == prefix || source.path.hasPrefix(prefix + "/"))
    }

    func apply(_ request: URLRequest) -> URLRequest {
        var request = request
        request.setValue(contains(request.url) ? value : nil, forHTTPHeaderField: "Authorization")
        return request
    }
}

// Never redirect local control requests or send application cookies to a TV.
private final class DlnaRequest: NSObject, URLSessionDataDelegate {
    private var data = Data()
    private var status = 0
    private var session: URLSession?
    private let complete: (Result<(Int, String), Error>) -> Void

    init(_ request: URLRequest, complete: @escaping (Result<(Int, String), Error>) -> Void) {
        self.complete = complete
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 8
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        session?.dataTask(with: request).resume()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        status = (response as? HTTPURLResponse)?.statusCode ?? 0
        completionHandler(response.expectedContentLength > 256_000 ? .cancel : .allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        if data.count + chunk.count > 256_000 { dataTask.cancel() } else { data.append(chunk) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { complete(.failure(error)) }
        else { complete(.success((status, String(decoding: data, as: UTF8.self)))) }
        session.invalidateAndCancel()
        self.session = nil
    }
}

// URLSession and Network stream each response with backpressure. Video bytes
// never enter the Capacitor bridge or accumulate as a complete response.
final class DlnaTransfer: NSObject, URLSessionDataDelegate {
    private let connection: NWConnection
    private let media: URLRequest
    private let audio: URLRequest?
    private let authorization: DlnaAuthorization?
    private let startSeconds: Double
    private let muxer = DlnaMuxer()
    private var started = false
    private let path: String
    private let complete: () -> Void
    private let failure: () -> Void
    private var header = Data()
    private var head = false
    private var task: URLSessionDataTask?
    private var session: URLSession?
    private var finished = false
    private var sentHeaders = false

    init(_ connection: NWConnection, media: URLRequest, audio: URLRequest?, startSeconds: Double, path: String, authorization: DlnaAuthorization? = nil, failure: @escaping () -> Void, complete: @escaping () -> Void) {
        self.connection = connection
        self.media = media
        self.authorization = authorization
        self.audio = audio
        self.startSeconds = startSeconds
        self.path = path
        self.complete = complete
        self.failure = failure
        super.init()
        connection.stateUpdateHandler = { [weak self] status in
            if case .failed = status { self?.close() }
            if case .cancelled = status { self?.close() }
        }
        connection.start(queue: dlnaQueue)
        receive()
        dlnaQueue.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self, !self.started else { return }
            self.close()
        }
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, ended, error in
            guard let self else { return }
            if let data { self.header.append(data) }
            guard self.header.count <= 8192, error == nil else { self.close(); return }
            if self.header.range(of: Data("\r\n\r\n".utf8)) != nil { self.startRequest() }
            else if ended { self.close() }
            else { self.receive() }
        }
    }

    private func startRequest() {
        let lines = String(decoding: header, as: UTF8.self).components(separatedBy: "\r\n")
        let first = (lines.first ?? "").components(separatedBy: " ")
        guard first.count == 3, ["GET", "HEAD"].contains(first[0]), first[1] == path else {
            connection.send(content: Data("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8),
                            completion: .contentProcessed { [weak self] _ in self?.close() })
            return
        }
        started = true
        head = first[0] == "HEAD"
        if let audio {
            let range = lines.first(where: { $0.lowercased().hasPrefix("range:") }).map { String($0.dropFirst(6)).trimmingCharacters(in: .whitespaces) }
            if let range, range != "bytes=0-" {
                connection.send(content: Data("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\nAccept-Ranges: none\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { [weak self] _ in self?.close() })
                return
            }
            if head {
                connection.send(content: Data("HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nAccept-Ranges: none\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { [weak self] _ in self?.close() })
                return
            }
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try self.muxer.stream(video: self.media, audio: audio, startSeconds: self.startSeconds, authorization: self.authorization) { data in
                        let sent = self.send(data)
                        self.sentHeaders = self.sentHeaders || sent
                        return sent
                    }
                } catch {
                    if (error as? URLError)?.code != .cancelled { self.failure() }
                    if !self.sentHeaders { _ = self.send(Data("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8)) }
                }
                self.close()
            }
            return
        }
        var request = media
        if let authorization, authorization.contains(media.url) { request = authorization.apply(media) }
        request.httpMethod = first[0]
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        if request.value(forHTTPHeaderField: "User-Agent") == nil {
            request.setValue("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", forHTTPHeaderField: "User-Agent")
        }
        for line in lines.dropFirst() where line.lowercased().hasPrefix("range:") {
            request.setValue(String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces), forHTTPHeaderField: "Range")
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 30
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
        task = session?.dataTask(with: request)
        task?.resume()
    }

    func send(_ data: Data, timeout: DispatchTimeInterval = .seconds(30)) -> Bool {
        let done = DispatchSemaphore(value: 0)
        var succeeded = false
        connection.send(content: data, completion: .contentProcessed { error in
            succeeded = error == nil
            done.signal()
        })
        if done.wait(timeout: .now() + timeout) == .timedOut {
            dlnaQueue.async {
                if !self.finished && self.audio != nil { self.failure() }
            }
            return false
        }
        return succeeded
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse else { completionHandler(.cancel); return }
        var headers = "HTTP/1.1 \(http.statusCode) \(HTTPURLResponse.localizedString(forStatusCode: http.statusCode))\r\nContent-Type: video/mp4\r\ntransferMode.dlna.org: Streaming\r\nConnection: close\r\n"
        for name in ["Content-Length", "Content-Range", "Accept-Ranges"] {
            if let value = http.value(forHTTPHeaderField: name) { headers += "\(name): \(value)\r\n" }
        }
        sentHeaders = send(Data((headers + "\r\n").utf8))
        completionHandler(sentHeaders ? .allow : .cancel)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if !head && !send(data) { dataTask.cancel() }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url, ["http", "https"].contains(url.scheme), url.user == nil, url.password == nil else {
            completionHandler(nil)
            return
        }
        var next = request
        if response.url?.scheme != url.scheme || response.url?.host != url.host || response.url?.port != url.port {
            for name in ["Authorization", "Cookie", "Host", "Proxy-Authorization", "Origin", "Referer"] {
                next.setValue(nil, forHTTPHeaderField: name)
            }
        }
        if let authorization, authorization.contains(media.url) { next = authorization.apply(next) }
        completionHandler(next)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if !sentHeaders {
            _ = send(Data("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8))
        }
        close()
    }

    func close() {
        dlnaQueue.async {
            guard !self.finished else { return }
            self.finished = true
            self.connection.cancel()
            self.muxer.cancel()
            self.task?.cancel()
            self.session?.invalidateAndCancel()
            self.session = nil
            self.complete()
        }
    }
}

final class DlnaMediaServer {
    let castId = UUID().uuidString
    private let listener: NWListener
    private var transfers: [UUID: DlnaTransfer] = [:]
    private(set) var mediaUrl = ""
    private(set) var muxFailed = false

    func expire(_ complete: (() -> Void)? = nil) {
        dlnaQueue.async { self.muxFailed = true; self.close(complete) }
    }

    init(media: URLRequest, audio: URLRequest? = nil, startSeconds: Double = 0, authorization: DlnaAuthorization? = nil, address: String, localAddress: String, failure: (() -> Void)? = nil, ready: @escaping (Result<Void, Error>) -> Void) throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host(localAddress), port: .any)
        listener = try NWListener(using: parameters)
        var pending = true
        listener.stateUpdateHandler = { [weak self] status in
            guard pending, let self else { return }
            if case .ready = status, let port = self.listener.port {
                self.mediaUrl = "http://\(localAddress):\(port.rawValue)/\(self.castId)/video.mp4"
                pending = false
                ready(.success(()))
            } else if case .failed(let error) = status {
                pending = false
                ready(.failure(error))
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self, self.transfers.count < (audio == nil ? 4 : 2),
                  case .hostPort(let host, _) = connection.endpoint,
                  host == NWEndpoint.Host(address) else { connection.cancel(); return }
            let id = UUID()
            self.transfers[id] = DlnaTransfer(connection, media: media, audio: audio, startSeconds: startSeconds, path: "/\(self.castId)/video.mp4", authorization: authorization, failure: { [weak self] in
                dlnaQueue.async { self?.muxFailed = true; failure?() }
            }) { [weak self] in
                self?.transfers.removeValue(forKey: id)
            }
        }
        listener.start(queue: dlnaQueue)
        dlnaQueue.asyncAfter(deadline: .now() + 5) { [weak self] in
            if pending {
                pending = false
                self?.close()
                ready(.failure(URLError(.timedOut)))
            }
        }
    }

    func close(_ complete: (() -> Void)? = nil) {
        dlnaQueue.async {
            self.listener.cancel()
            for transfer in self.transfers.values { transfer.close() }
            self.transfers.removeAll()
            complete?()
        }
    }
    deinit { listener.cancel() }
}

@objc(DlnaPlugin)
public class DlnaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DlnaPlugin"
    public let jsName = "Dlna"
    public let pluginMethods: [CAPPluginMethod] = ["discover", "request", "startMediaServer", "stopMediaServer", "hasFailed", "retainMediaRequests"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }
    private var addresses = Set<String>()
    private var relay: DlnaMediaServer?
    private var mediaOwners = Set<String>()
    let castLifetime = DlnaCastLifetime()

    @objc func retainMediaRequests(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let owner = call.getString("owner"), UUID(uuidString: owner) != nil,
                  let raw = call.getArray("urls") as? [String], raw.count <= 200 else {
                call.reject("Invalid DLNA media registration")
                return
            }
            IOSNetwork.shared.retainMediaRequests(owner: owner, urls: raw.compactMap { URL(string: $0) })
            if raw.isEmpty { self.mediaOwners.remove(owner) }
            else { self.mediaOwners.insert(owner) }
            call.resolve()
        }
    }

    @objc func discover(_ call: CAPPluginCall) {
        // Blocking UDP reads run separately from the relay's Network callbacks.
        DispatchQueue.global(qos: .userInitiated).async {
            let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
            guard fd >= 0 else { call.reject("Unable to open DLNA discovery socket"); return }
            defer { Darwin.close(fd) }
            do {
                var target = try ipv4Address("239.255.255.250", port: 1900)
                var timeout = timeval(tv_sec: 0, tv_usec: 250_000)
                setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
                let message = Data("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n".utf8)
                let sent = message.withUnsafeBytes { bytes in
                    withUnsafePointer(to: &target) { pointer in
                        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                            sendto(fd, bytes.baseAddress, bytes.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                        }
                    }
                }
                guard sent >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
                var responses = [[String: String]]()
                let deadline = Date().addingTimeInterval(2.5)
                while Date() < deadline && responses.count < 64 {
                    var buffer = [UInt8](repeating: 0, count: 8192)
                    var remote = sockaddr_in()
                    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
                    let count = withUnsafeMutablePointer(to: &remote) { pointer in
                        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                            recvfrom(fd, &buffer, buffer.count, 0, $0, &length)
                        }
                    }
                    if count < 0 {
                        if errno == EAGAIN || errno == EWOULDBLOCK { continue }
                        throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
                    }
                    responses.append(["address": addressString(remote.sin_addr),
                                      "message": String(decoding: buffer.prefix(count), as: UTF8.self)])
                }
                dlnaQueue.async {
                    self.addresses.formUnion(responses.compactMap { $0["address"] })
                    call.resolve(["responses": responses])
                }
            } catch { call.reject("Unable to discover DLNA devices. Allow local network access and refresh.", nil, error) }
        }
    }

    @objc func request(_ call: CAPPluginCall) {
        dlnaQueue.async {
            let method = call.getString("method") ?? "GET"
            let body = call.getString("body") ?? ""
            guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "http",
                  let host = url.host, self.addresses.contains(host), url.user == nil, url.password == nil,
                  ["GET", "POST"].contains(method), body.utf8.count <= 256_000 else {
                call.reject("Invalid DLNA request")
                return
            }
            var request = URLRequest(url: url)
            request.httpMethod = method
            if method == "POST" { request.httpBody = Data(body.utf8) }
            let headers = call.getObject("headers") ?? [:]
            for name in ["Content-Type", "SOAPACTION"] {
                if let value = headers[name] as? String { request.setValue(value, forHTTPHeaderField: name) }
            }
            _ = DlnaRequest(request) { result in
                switch result {
                case .success(let (status, body)): call.resolve(["status": status, "body": body])
                case .failure(let error): call.reject("DLNA request failed", nil, error)
                }
            }
        }
    }

    @objc func startMediaServer(_ call: CAPPluginCall) {
        // Resolve iOS's registered media requests before leaving their owning queue.
        DispatchQueue.main.async {
            guard let raw = call.getString("mediaUrl"), let url = URL(string: raw) else {
                call.reject("Invalid DLNA media")
                return
            }
            let media = IOSNetwork.shared.registeredMediaRequest(url) ?? URLRequest(url: url)
            var audio: URLRequest?
            if let rawAudio = call.getString("audioUrl") {
                guard let url = URL(string: rawAudio) else { call.reject("Invalid DLNA audio"); return }
                audio = IOSNetwork.shared.registeredMediaRequest(url) ?? URLRequest(url: url)
                guard let url = audio?.url, ["http", "https"].contains(url.scheme), url.host != nil,
                      url.user == nil, url.password == nil else { call.reject("Invalid DLNA audio"); return }
            }
            let authorization = DlnaAuthorization(call.getObject("authorization"))
            if call.getObject("authorization") != nil && authorization == nil { call.reject("Invalid DLNA authorization"); return }
            dlnaQueue.async { self.startRelay(call, media: media, audio: audio, authorization: authorization) }
        }
    }

    private func startRelay(_ call: CAPPluginCall, media: URLRequest, audio: URLRequest?, authorization: DlnaAuthorization?) {
        guard self.relay == nil, let url = media.url,
              ["http", "https"].contains(url.scheme), url.host != nil, url.user == nil, url.password == nil,
              let address = call.getString("address"), self.addresses.contains(address) else {
            call.reject("Invalid DLNA media or cast already active")
            return
        }
        do {
            let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
            guard fd >= 0 else { throw URLError(.cannotConnectToHost) }
            defer { Darwin.close(fd) }
            var target = try ipv4Address(address, port: 1900)
            let connected = withUnsafePointer(to: &target) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
            guard connected == 0 else { throw URLError(.cannotConnectToHost) }
            var local = sockaddr_in()
            var length = socklen_t(MemoryLayout<sockaddr_in>.size)
            let found = withUnsafeMutablePointer(to: &local) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &length) }
            }
            guard found == 0 else { throw URLError(.cannotConnectToHost) }
            self.relay = try DlnaMediaServer(media: media, audio: audio, startSeconds: max(0, call.getDouble("startSeconds") ?? 0), authorization: authorization, address: address, localAddress: addressString(local.sin_addr), failure: { [weak self] in
                DispatchQueue.main.async { self?.castLifetime.release() }
            }) { [weak self] result in
                guard let self else { call.reject("DLNA plugin closed"); return }
                switch result {
                case .success:
                    guard let relay = self.relay else { call.reject("DLNA relay closed"); return }
                    DispatchQueue.main.async {
                        guard self.castLifetime.acquire(expired: { complete in
                            relay.expire { DispatchQueue.main.async(execute: complete) }
                        }) else {
                            dlnaQueue.async {
                                if self.relay === relay { self.relay = nil }
                                relay.close { call.reject("Unable to protect DLNA cast lifetime") }
                            }
                            return
                        }
                        call.resolve(["castId": relay.castId, "mediaUrl": relay.mediaUrl])
                    }
                case .failure(let error):
                    self.relay?.close()
                    self.relay = nil
                    call.reject("Unable to start DLNA media relay", nil, error)
                }
            }
        } catch { call.reject("Unable to start DLNA media relay", nil, error) }
    }

    deinit {
        let owners = mediaOwners
        let lifetime = castLifetime
        DispatchQueue.main.async {
            lifetime.release()
            for owner in owners { IOSNetwork.shared.retainMediaRequests(owner: owner, urls: []) }
        }
        let server = relay
        dlnaQueue.async { server?.close() }
    }

    @objc func hasFailed(_ call: CAPPluginCall) {
        dlnaQueue.async {
            call.resolve(["failed": self.relay?.castId == call.getString("castId") && self.relay?.muxFailed == true])
        }
    }

    @objc func stopMediaServer(_ call: CAPPluginCall) {
        dlnaQueue.async {
            if self.relay?.castId == call.getString("castId") {
                self.relay?.close {
                    DispatchQueue.main.async { self.castLifetime.release(); call.resolve() }
                }
                self.relay = nil
            } else { call.resolve() }
        }
    }
}
