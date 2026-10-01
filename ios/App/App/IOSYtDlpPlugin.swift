import Capacitor
import ffmpegkit
import AVFoundation
import AVKit
import Foundation
import UIKit

@_silgen_name("Py_Initialize") private func pyInitialize()
@_silgen_name("PyEval_SaveThread") private func pySaveThread() -> UnsafeMutableRawPointer?
@_silgen_name("PyGILState_Ensure") private func pyEnsureGIL() -> Int32
@_silgen_name("PyGILState_Release") private func pyReleaseGIL(_ state: Int32)
@_silgen_name("PyRun_SimpleStringFlags") private func pyRun(_ code: UnsafePointer<CChar>, _ flags: UnsafeMutableRawPointer?) -> Int32

private enum IOSYtDlpRuntime {
    private static let initialization = NSLock()
    private static var ready = false
    private static let workers = DispatchQueue(label: "org.opentubex.ytdlp", qos: .userInitiated, attributes: .concurrent)

    static func run(_ request: [String: Any], completion: @escaping (Result<[String: Any], Error>) -> Void) {
        workers.async {
            do { completion(.success(try execute(request))) }
            catch { completion(.failure(error)) }
        }
    }

    private static func execute(_ request: [String: Any]) throws -> [String: Any] {
        try initialize()
        let temporary = FileManager.default.temporaryDirectory
        let id = UUID().uuidString
        let input = temporary.appendingPathComponent("ytdlp-\(id).request.json")
        let output = temporary.appendingPathComponent("ytdlp-\(id).response.json")
        defer { try? FileManager.default.removeItem(at: input); try? FileManager.default.removeItem(at: output) }
        try JSONSerialization.data(withJSONObject: request).write(to: input, options: .atomic)
        let gil = pyEnsureGIL()
        let code = "import opentubex_ios_ytdlp; opentubex_ios_ytdlp.handle(\(String(reflecting: input.path)), \(String(reflecting: output.path)))"
        let status = code.withCString { pyRun($0, nil) }
        pyReleaseGIL(gil)
        guard status == 0, FileManager.default.fileExists(atPath: output.path) else {
            throw NSError(domain: "IOSYtDlp", code: 1, userInfo: [NSLocalizedDescriptionKey: "The bundled yt-dlp runtime failed"])
        }
        let value = try JSONSerialization.jsonObject(with: Data(contentsOf: output))
        guard let result = value as? [String: Any] else {
            throw NSError(domain: "IOSYtDlp", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid yt-dlp response"])
        }
        if let error = result["error"] as? String {
            throw NSError(domain: "IOSYtDlp", code: 3, userInfo: [NSLocalizedDescriptionKey: error])
        }
        return result
    }

    private static func initialize() throws {
        initialization.lock()
        defer { initialization.unlock() }
        if ready { return }
        let root = Bundle.main.bundleURL.appendingPathComponent("python")
        let library = root.appendingPathComponent("lib")
        guard let version = try FileManager.default.contentsOfDirectory(atPath: library.path)
            .first(where: { $0.hasPrefix("python3.") }) else {
            throw NSError(domain: "IOSYtDlp", code: 4, userInfo: [NSLocalizedDescriptionKey: "Bundled Python is missing"])
        }
        let standard = library.appendingPathComponent(version)
        let packages = Bundle.main.bundleURL.appendingPathComponent("python-packages")
        let certificates = packages.appendingPathComponent("certifi/cacert.pem")
        guard FileManager.default.fileExists(atPath: certificates.path) else {
            throw NSError(domain: "IOSYtDlp", code: 5,
                          userInfo: [NSLocalizedDescriptionKey: "Bundled certificates are missing"])
        }
        setenv("PYTHONHOME", root.path, 1)
        setenv("PYTHONPATH", [packages.path, standard.path,
                              standard.appendingPathComponent("lib-dynload").path].joined(separator: ":"), 1)
        setenv("SSL_CERT_FILE", certificates.path, 1)
        setenv("XDG_CACHE_HOME", FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].path, 1)
        pyInitialize()
        FFmpegKitConfig.setLogRedirectionStrategy(.neverPrintLogs)
        FFmpegKitConfig.setSessionHistorySize(64)
        let callback: @convention(c) (UnsafePointer<CChar>, UnsafePointer<CChar>) -> Int32 = iosFFmpegExecute
        let address = unsafeBitCast(callback, to: UInt.self)
        let code = "import opentubex_ios_ffmpeg; opentubex_ios_ffmpeg.install(\(address))"
        guard code.withCString({ pyRun($0, nil) }) == 0 else {
            _ = pySaveThread()
            throw NSError(domain: "IOSYtDlp", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Bundled FFmpeg bridge failed to initialize"])
        }
        _ = pySaveThread()
        ready = true
    }
}

// FFmpegKit runs commands on its own workers. Waiting here releases Python's GIL
// through ctypes, and cancellation targets only this download's native session.
enum IOSFFmpeg {
    static func execute(_ args: [String], controlFile: String = "", timeout: Double? = nil) throws -> [String: Any] {
        guard let tool = args.first, ["ffmpeg", "ffprobe"].contains(tool) else {
            throw NSError(domain: "IOSYtDlp", code: 8)
        }
        if !controlFile.isEmpty && FileManager.default.fileExists(atPath: controlFile) {
            return ["returncode": 255, "stdout": "", "stderr": "Download interrupted"]
        }
        let completed = DispatchSemaphore(value: 0)
        let arguments = Array(args.dropFirst())
        let session: AbstractSession
        if tool == "ffprobe" {
            session = FFprobeKit.execute(withArgumentsAsync: arguments, withCompleteCallback: { _ in completed.signal() })
        } else {
            session = FFmpegKit.execute(withArgumentsAsync: arguments, withCompleteCallback: { _ in completed.signal() })
        }
        let deadline = timeout.map { Date().addingTimeInterval($0) }
        var timedOut = false
        while completed.wait(timeout: .now() + 0.1) == .timedOut {
            timedOut = deadline.map { Date() >= $0 } ?? false
            if timedOut || (!controlFile.isEmpty && FileManager.default.fileExists(atPath: controlFile)) {
                session.cancel()
            }
        }
        var stdout = ""
        var stderr = ""
        for case let log as Log in session.getAllLogs() ?? [] {
            // FFmpegKit routes the tools' printf output through this special level;
            // diagnostic av_log messages retain their normal severity levels.
            if log.getLevel() == -16 { stdout += log.getMessage() ?? "" }
            else { stderr += log.getMessage() ?? "" }
        }
        return ["returncode": Int(session.getReturnCode()?.getValue() ?? 1),
                "stdout": stdout, "stderr": stderr, "timedOut": timedOut]
    }
}

@_cdecl("opentubex_ios_ffmpeg_execute")
private func iosFFmpegExecute(_ input: UnsafePointer<CChar>, _ output: UnsafePointer<CChar>) -> Int32 {
    do {
        let request = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: String(cString: input))))
        guard let value = request as? [String: Any], let args = value["args"] as? [String] else { return 1 }
        let result = try IOSFFmpeg.execute(args, controlFile: value["controlFile"] as? String ?? "",
                                          timeout: value["timeout"] as? Double)
        try JSONSerialization.data(withJSONObject: result).write(to: URL(fileURLWithPath: String(cString: output)), options: .atomic)
        return 0
    } catch { return 1 }
}

enum IOSYtDlpExporter {
    static func copy(_ names: [String], from staging: URL, to target: URL, videoId: String) throws
        -> (destinations: [String], files: [[String: Any]], sizeBytes: Int64) {
        var destinations: [String] = []
        var files: [[String: Any]] = []
        var size: Int64 = 0
        do {
            for name in names {
                let source = staging.appendingPathComponent(name).standardizedFileURL.resolvingSymlinksInPath()
                var destination = target.appendingPathComponent(name).standardizedFileURL.resolvingSymlinksInPath()
                let sourceRoot = staging.standardizedFileURL.resolvingSymlinksInPath().path + "/"
                let targetRoot = target.standardizedFileURL.resolvingSymlinksInPath().path + "/"
                guard !name.isEmpty, !name.hasPrefix("/"), !name.split(separator: "/").contains(".."),
                      source.path.hasPrefix(sourceRoot), destination.path.hasPrefix(targetRoot) else {
                    throw NSError(domain: "IOSYtDlp", code: 8,
                                  userInfo: [NSLocalizedDescriptionKey: "Invalid downloaded file name"])
                }
                try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                var duplicate = 2
                while FileManager.default.fileExists(atPath: destination.path) {
                    let suffix = source.pathExtension.isEmpty ? "" : ".\(source.pathExtension)"
                    destination = destination.deletingLastPathComponent().appendingPathComponent("\(source.deletingPathExtension().lastPathComponent) (\(duplicate))\(suffix)")
                    duplicate += 1
                }
                try FileManager.default.copyItem(at: source, to: destination)
                size += Int64((try? source.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
                destinations.append(destination.path)
                files.append(["path": destination.path, "relativePath": String(destination.path.dropFirst(targetRoot.count)), "videoId": videoId,
                              "extension": destination.pathExtension, "available": true])
            }
        } catch {
            for path in destinations { try? FileManager.default.removeItem(atPath: path) }
            throw error
        }
        return (destinations, files, size)
    }
}

private final class IOSScopedPlayerController: AVPlayerViewController {
    var releaseFile: (() -> Void)?

    private func finishPlayback() {
        player?.pause()
        releaseFile?()
        releaseFile = nil
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil { finishPlayback() }
    }

    deinit { releaseFile?() }
}

@objc(IOSYtDlpPlugin)
public final class IOSYtDlpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IOSYtDlpPlugin"
    public let jsName = "YtDlp"
    public let pluginMethods: [CAPPluginMethod] = [
        "info", "extract", "registerMedia", "download", "list", "configure", "control", "queue", "clear", "remove", "open", "play", "cache", "checkUpdate", "update"
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    private let exports = DispatchQueue(label: "org.opentubex.ytdlp.export", qos: .userInitiated)
    private var records: [Int: [String: Any]] = [:]
    private var nextId = 0
    private var running: Set<Int> = []
    private var configuration: [String: Any] = [:]
    private var timer: Timer?
    private let storageKey = "iosYtDlpDownloads"

    private func onMain(_ operation: @escaping () -> Void) -> Bool {
        if Thread.isMainThread { return false }
        DispatchQueue.main.async(execute: operation)
        return true
    }

    public override func load() {
        if onMain({ self.load() }) { return }
        if let data = UserDefaults.standard.data(forKey: storageKey),
           let saved = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let raw = saved["records"] as? [String: [String: Any]] {
            records = Dictionary(uniqueKeysWithValues: raw.compactMap { key, value in
                guard let id = Int(key) else { return nil }
                var record = value
                if ["preparing", "downloading", "processing", "pausing"].contains(record["status"] as? String ?? "") {
                    record["status"] = "paused"
                }
                if let reference = record["folder"] as? String,
                   let target = try? directory(reference),
                   let saved = record["destinations"] as? [String], !saved.isEmpty {
                    let savedFiles = record["files"] as? [[String: Any]] ?? []
                    let destinations = saved.enumerated().map { index, path in
                        let relative = index < savedFiles.count ? savedFiles[index]["relativePath"] as? String : nil
                        return target.appendingPathComponent(relative ?? URL(fileURLWithPath: path).lastPathComponent).path
                    }
                    record["destinations"] = destinations
                    record["destination"] = destinations.last
                    if var files = record["files"] as? [[String: Any]] {
                        for index in files.indices where index < destinations.count { files[index]["path"] = destinations[index] }
                        record["files"] = files
                    }
                }
                return (id, record)
            })
            nextId = saved["nextId"] as? Int ?? records.keys.max() ?? 0
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.refreshProgress() }
    }

    deinit { timer?.invalidate() }

    private func persist() {
        let value: [String: Any] = ["nextId": nextId,
                                    "records": Dictionary(uniqueKeysWithValues: records.map { (String($0.key), $0.value) })]
        if let data = try? JSONSerialization.data(withJSONObject: value) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    private func publish(_ id: Int) {
        guard let record = records[id] else { return }
        persist()
        notifyListeners("downloadStatus", data: record)
    }

    private func directory(_ reference: String) throws -> URL {
        guard let data = reference.data(using: .utf8),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: String],
              let encoded = object["bookmark"], let bytes = Data(base64Encoded: encoded) else {
            throw NSError(domain: "IOSYtDlp", code: 5, userInfo: [NSLocalizedDescriptionKey: "Choose a download folder in Files"])
        }
        var stale = false
        return try URL(resolvingBookmarkData: bytes, options: [], bookmarkDataIsStale: &stale)
    }

    private func folder(for id: Int) -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("yt-dlp-downloads", isDirectory: true)
            .appendingPathComponent(String(id), isDirectory: true)
    }

    private func controlFile(for id: Int) -> URL { folder(for: id).appendingPathComponent("control") }
    private func progressFile(for id: Int) -> URL { folder(for: id).appendingPathComponent("progress.json") }

    @objc func info(_ call: CAPPluginCall) {
        IOSYtDlpRuntime.run(["operation": "version"]) { result in
            DispatchQueue.main.async {
                let version: String?
                switch result {
                case .success(let info): version = info["version"] as? String
                case .failure: version = nil
                }
                let binary: [String: Any] = ["source": "managed", "available": version != nil,
                                              "path": "", "version": (version as Any?) ?? NSNull(), "supportedBrowsers": []]
                let tools = (try? result.get()["tools"]) as? [String: [String: Any]] ?? [:]
                let unavailable: [String: Any] = ["source": "managed", "available": false, "path": "", "version": NSNull()]
                call.resolve(["ytDlp": binary, "ffmpeg": tools["ffmpeg"] ?? unavailable, "ffprobe": tools["ffprobe"] ?? unavailable])
            }
        }
    }

    @objc func extract(_ call: CAPPluginCall) {
        guard let args = call.getArray("args") as? [String], let urlString = args.last,
              let url = URL(string: urlString), ["http", "https"].contains(url.scheme ?? ""),
              url.user == nil, url.password == nil, urlString.count <= 8192 else {
            call.reject("Invalid media URL")
            return
        }
        let cookies = call.getString("cookies") ?? ""
        IOSYtDlpRuntime.run(["operation": "extract", "args": args, "cookies": cookies]) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let value): call.resolve(value)
                case .failure(let error): call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc func registerMedia(_ call: CAPPluginCall) {
        if onMain({ self.registerMedia(call) }) { return }
        guard let formats = call.getArray("formats") as? [[String: Any]], formats.count <= 200 else {
            call.reject("Invalid media formats")
            return
        }
        var urls: [String] = []
        for format in formats {
            guard let raw = format["url"] as? String, raw.count <= 8192,
                  let url = URL(string: raw), url.scheme == "https", url.user == nil, url.password == nil else {
                call.reject("Invalid media URL")
                return
            }
            var request = URLRequest(url: url)
            request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
            if let headers = format["http_headers"] as? [String: String] {
                for (name, value) in headers where !["host", "cookie", "range"].contains(name.lowercased()) && name.count < 100 && value.count < 4096 {
                    request.setValue(value, forHTTPHeaderField: name)
                }
            }
            let id = IOSNetwork.shared.prepareExternal(request)
            urls.append("capacitor://localhost/_opentubex_media/\(id)")
        }
        call.resolve(["urls": urls])
    }

    @objc func configure(_ call: CAPPluginCall) {
        if onMain({ self.configure(call) }) { return }
        configuration = call.getObject("configuration") as? [String: Any] ?? [:]
        if let restored = call.getObject("resumeArguments") as? [String: [String]] {
            for (key, args) in restored {
                if let id = Int(key), records[id] != nil, records[id]?["args"] == nil {
                    records[id]?["args"] = args
                }
            }
            persist()
        }
        call.resolve()
        startNext()
    }

    @objc func download(_ call: CAPPluginCall) {
        if onMain({ self.download(call) }) { return }
        guard let payload = call.getObject("payload") as? [String: Any],
              let mode = payload["mode"] as? String, ["video", "audio", "subtitles", "custom"].contains(mode),
              let args = call.getArray("args") as? [String] else {
            call.resolve(["error": "downloads-disabled"])
            return
        }
        if let raw = payload["externalUrl"] {
            guard let external = raw as? String, external.count <= 8192,
                  let url = URL(string: external), ["http", "https"].contains(url.scheme ?? ""),
                  url.host != nil, url.user == nil, url.password == nil else {
                call.resolve(["error": "INVALID_MEDIA_URL"])
                return
            }
        }
        guard configuration["enabled"] as? Bool == true else {
            call.resolve(["error": "downloads-disabled"])
            return
        }
        let reference = configuration["folder"] as? String ?? ""
        do { _ = try directory(reference) }
        catch { call.resolve(["error": "download-folder-required"]); return }
        let id = call.getInt("retryDownloadId") ?? { nextId += 1; return nextId }()
        if running.contains(id) { call.resolve(["error": "download-active"]); return }
        var record: [String: Any] = [
            "id": id, "status": "queued", "percent": 0, "started": false,
            "retryPayload": payload, "args": args, "mode": mode, "title": payload["title"] ?? "",
            "thumbnail": payload["thumbnail"] ?? "", "videoId": payload["videoId"] ?? "",
            "playlistId": payload["playlistId"] ?? "", "playlistKey": payload["playlistKey"] ?? "",
            "template": payload["template"] ?? "", "folder": reference,
            "destinations": [], "files": [], "queuePosition": id
        ]
        record["errorMessage"] = NSNull()
        records[id] = record
        publish(id)
        call.resolve(["id": id])
        startNext()
    }

    private func startNext() {
        let limit = min(10, max(1, configuration["concurrency"] as? Int ?? 1))
        guard running.count < limit,
              let id = queueIDs(with: ["queued"]).first(where: { !running.contains($0) && records[$0]?["args"] != nil }),
              let payload = records[id]?["retryPayload"] as? [String: Any],
              let args = records[id]?["args"] as? [String] else { return }
        running.insert(id)
        let staging = folder(for: id)
        try? FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: controlFile(for: id))
        try? FileManager.default.removeItem(at: progressFile(for: id))
        records[id]?["status"] = "preparing"
        records[id]?["percent"] = 0
        records[id]?["speed"] = NSNull()
        records[id]?["eta"] = NSNull()
        records[id]?["started"] = true
        publish(id)
        IOSYtDlpRuntime.run(["operation": "download", "payload": payload, "args": args,
                             "cookies": configuration["useCookies"] as? Bool == true ? configuration["cookies"] ?? "" : "",
                             "bandwidth": configuration["bandwidth"] ?? "",
                             "concurrency": limit,
                             "staging": staging.path, "progressFile": progressFile(for: id).path,
                             "controlFile": controlFile(for: id).path]) { [weak self] result in
            switch result {
            case .success(let value):
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    if ["pausing", "cancelled"].contains(self.records[id]?["status"] as? String ?? "") {
                        self.finish(id, result: .success(value))
                        return
                    }
                    try? FileManager.default.removeItem(at: self.progressFile(for: id))
                    self.records[id]?["status"] = "processing"
                    self.records[id]?["percent"] = 0
                    self.records[id]?["speed"] = NSNull()
                    self.records[id]?["eta"] = NSNull()
                    self.publish(id)
                    self.finish(id, result: .success(value))
                }
            case .failure:
                DispatchQueue.main.async { self?.finish(id, result: result) }
            }
        }
        startNext()
    }

    private func queuePosition(_ id: Int) -> Int {
        records[id]?["queuePosition"] as? Int ?? id
    }

    private func queueIDs(with statuses: Set<String>) -> [Int] {
        records.keys.filter { statuses.contains(records[$0]?["status"] as? String ?? "") }
            .sorted { queuePosition($0) < queuePosition($1) ||
                (queuePosition($0) == queuePosition($1) && $0 < $1) }
    }

    private func refreshProgress() {
        for id in running {
            if ["pausing", "paused", "cancelled"].contains(records[id]?["status"] as? String ?? "") { continue }
            guard let data = try? Data(contentsOf: progressFile(for: id)),
                  let progress = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            let previous = records[id]?["percent"] as? Double ?? 0
            let percent = progress["percent"] as? Double ?? 0
            if abs(percent - previous) < 0.1 && records[id]?["status"] as? String == "downloading" { continue }
            records[id]?["status"] = progress["status"] ?? "downloading"
            records[id]?["percent"] = percent
            records[id]?["speed"] = progress["speed"] ?? NSNull()
            records[id]?["eta"] = progress["eta"] ?? NSNull()
            publish(id)
        }
    }

    private func finish(_ id: Int, result: Result<[String: Any], Error>) {
        let staging = folder(for: id)
        let reference = records[id]?["folder"] as? String ?? ""
        let videoId = records[id]?["videoId"] as? String ?? ""
        let interrupted = ["pausing", "cancelled"].contains(records[id]?["status"] as? String ?? "")
        // Serialize exports so concurrent downloads cannot select the same name.
        // Keep the job running until rollback and staging cleanup have finished.
        exports.async {
            var failure: Error?
            var completed = false
            if !interrupted {
                do {
                    let value = try result.get()
                    let names = value["files"] as? [String] ?? []
                    if names.isEmpty { throw NSError(domain: "IOSYtDlp", code: 6, userInfo: [NSLocalizedDescriptionKey: "No file was downloaded"]) }
                    let target = try self.directory(reference)
                    guard target.startAccessingSecurityScopedResource() else {
                        throw NSError(domain: "IOSYtDlp", code: 7, userInfo: [NSLocalizedDescriptionKey: "The download folder is unavailable"])
                    }
                    defer { target.stopAccessingSecurityScopedResource() }
                    let exported = try IOSYtDlpExporter.copy(names, from: staging, to: target, videoId: videoId)
                    DispatchQueue.main.sync {
                        guard self.records[id]?["status"] as? String == "processing" else { return }
                        self.records[id]?["destination"] = exported.destinations.last
                        self.records[id]?["destinations"] = exported.destinations
                        self.records[id]?["files"] = exported.files
                        self.records[id]?["sizeBytes"] = exported.sizeBytes
                        self.records[id]?["percent"] = 100
                        self.records[id]?["status"] = "completed"
                        completed = true
                    }
                    if !completed {
                        for path in exported.destinations { try? FileManager.default.removeItem(atPath: path) }
                    }
                } catch { failure = error }
            }
            let cancelled = DispatchQueue.main.sync {
                let status = self.records[id]?["status"] as? String
                if status == "cancelled" { return true }
                if status != "pausing", let error = failure {
                    self.records[id]?["status"] = "failed"
                    let native = error as NSError
                    if native.domain == "IOSYtDlp" && native.code == 7 {
                        self.records[id]?["errorMessage"] = "DOWNLOAD_EXPORT_FAILED"
                    } else if native.domain == "IOSYtDlp" && [1, 2, 4, 6, 8, 9, 10, 11, 12].contains(native.code) {
                        self.records[id]?["errorMessage"] = "IOS_DOWNLOAD_FAILED"
                    } else {
                        self.records[id]?["errorMessage"] = error.localizedDescription
                    }
                }
                return false
            }
            if completed || cancelled { try? FileManager.default.removeItem(at: staging) }
            DispatchQueue.main.async {
                if self.records[id]?["status"] as? String == "pausing" {
                    self.records[id]?["status"] = "paused"
                }
                self.running.remove(id)
                self.publish(id)
                self.startNext()
            }
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        if onMain({ self.list(call) }) { return }
        for id in records.keys where records[id]?["status"] as? String == "completed" {
            guard var files = records[id]?["files"] as? [[String: Any]] else { continue }
            let target = try? directory(records[id]?["folder"] as? String ?? "")
            let accessible = target?.startAccessingSecurityScopedResource() == true
            defer { if accessible { target?.stopAccessingSecurityScopedResource() } }
            var available = 0
            for index in files.indices {
                let path = files[index]["path"] as? String ?? ""
                let exists = accessible && FileManager.default.fileExists(atPath: path)
                files[index]["available"] = exists
                if exists { available += 1 }
            }
            records[id]?["files"] = files
            records[id]?["destinationCount"] = files.count
            records[id]?["availableDestinationCount"] = available
            records[id]?["availability"] = available == files.count ? "available" : available == 0 ? "missing" : "partial"
        }
        call.resolve(["downloads": records.keys.sorted().compactMap { records[$0] }])
    }

    private func control(_ id: Int, _ action: String, _ value: Int = 0) -> Bool {
        guard records[id] != nil else { return false }
        let status = records[id]?["status"] as? String ?? ""
        switch action {
        case "pause", "cancel":
            guard ["queued", "preparing", "downloading", "processing"].contains(status) else { return false }
            let active = running.contains(id)
            if active { try? Data().write(to: controlFile(for: id)) }
            records[id]?["status"] = action == "pause" && active ? "pausing" : action == "pause" ? "paused" : "cancelled"
            if action == "cancel" && !active { try? FileManager.default.removeItem(at: folder(for: id)) }
        case "resume":
            guard status == "paused" else { return false }
            records[id]?["status"] = "queued"
        case "move":
            guard ["queued", "paused"].contains(status), value == -1 || value == 1 else { return false }
            let peers = queueIDs(with: ["queued", "paused"])
            guard let index = peers.firstIndex(of: id), peers.indices.contains(index + value) else { return false }
            let other = peers[index + value]
            let position = queuePosition(id)
            let otherPosition = queuePosition(other)
            records[id]?["queuePosition"] = otherPosition
            records[other]?["queuePosition"] = position
            publish(other)
        default: return false
        }
        publish(id)
        startNext()
        return true
    }

    @objc func control(_ call: CAPPluginCall) {
        if onMain({ self.control(call) }) { return }
        call.resolve(["ok": control(call.getInt("id") ?? -1, call.getString("action") ?? "", call.getInt("value") ?? 0)])
    }

    @objc func queue(_ call: CAPPluginCall) {
        if onMain({ self.queue(call) }) { return }
        let action = call.getString("action") ?? ""
        for id in records.keys.sorted() {
            let status = records[id]?["status"] as? String ?? ""
            if action == "pause-all" && ["queued", "preparing", "downloading", "processing"].contains(status) { _ = control(id, "pause") }
            if action == "resume-all" && status == "paused" { _ = control(id, "resume") }
            if action == "retry-all" && status == "failed" { records[id]?["status"] = "queued"; publish(id) }
        }
        startNext()
        call.resolve(["ok": true])
    }

    @objc func clear(_ call: CAPPluginCall) {
        if onMain({ self.clear(call) }) { return }
        let ids = call.getArray("ids") as? [Int] ?? []
        let removed = ids.filter { !running.contains($0) }
        for id in removed {
            records.removeValue(forKey: id)
            try? FileManager.default.removeItem(at: folder(for: id))
        }
        persist()
        notifyListeners("downloadsRemoved", data: ["ids": removed])
        call.resolve(["ok": true])
    }

    @objc func remove(_ call: CAPPluginCall) {
        if onMain({ self.remove(call) }) { return }
        let id = call.getInt("id") ?? -1
        guard let record = records[id], !running.contains(id) else { call.resolve(["ok": false]); return }
        do {
            let target = try directory(record["folder"] as? String ?? "")
            guard target.startAccessingSecurityScopedResource() else { throw URLError(.noPermissionsToReadFile) }
            defer { target.stopAccessingSecurityScopedResource() }
            for path in record["destinations"] as? [String] ?? [] where FileManager.default.fileExists(atPath: path) {
                try FileManager.default.removeItem(atPath: path)
            }
            records.removeValue(forKey: id)
            try? FileManager.default.removeItem(at: folder(for: id))
            persist()
            notifyListeners("downloadsRemoved", data: ["ids": [id]])
            call.resolve(["ok": true])
        } catch { call.resolve(["ok": false]) }
    }

    @objc func open(_ call: CAPPluginCall) {
        if onMain({ self.open(call) }) { return }
        let id = call.getInt("id") ?? -1
        guard let record = records[id], let path = record["destination"] as? String,
              let controller = bridge?.viewController else {
            call.resolve(["ok": false]); return
        }
        guard let target = try? directory(record["folder"] as? String ?? ""),
              target.startAccessingSecurityScopedResource() else {
            call.resolve(["ok": false]); return
        }
        guard FileManager.default.fileExists(atPath: path) else {
            target.stopAccessingSecurityScopedResource()
            call.resolve(["ok": false]); return
        }
        let activity = UIActivityViewController(activityItems: [URL(fileURLWithPath: path)], applicationActivities: nil)
        activity.completionWithItemsHandler = { _, _, _, _ in target.stopAccessingSecurityScopedResource() }
        activity.popoverPresentationController?.sourceView = controller.view
        controller.present(activity, animated: true)
        call.resolve(["ok": true])
    }

    @objc func play(_ call: CAPPluginCall) {
        if onMain({ self.play(call) }) { return }
        let id = call.getInt("id") ?? -1
        let requestedPath = call.getString("path") ?? ""
        guard let record = records[id], record["status"] as? String == "completed",
              let files = record["files"] as? [[String: Any]],
              let file = files.first(where: { entry in
                  guard let path = entry["path"] as? String else { return false }
                  return (requestedPath.isEmpty || requestedPath == path) &&
                      entry["available"] as? Bool != false &&
                      ["mp4", "m4a", "mp3", "mov", "aac"].contains(URL(fileURLWithPath: path).pathExtension.lowercased())
              }),
              let path = file["path"] as? String,
              let controller = bridge?.viewController, controller.presentedViewController == nil,
              let target = try? directory(record["folder"] as? String ?? ""),
              target.startAccessingSecurityScopedResource() else {
            call.resolve(["ok": false]); return
        }
        guard FileManager.default.fileExists(atPath: path) else {
            target.stopAccessingSecurityScopedResource()
            call.resolve(["ok": false]); return
        }
        let player = IOSScopedPlayerController()
        player.releaseFile = { target.stopAccessingSecurityScopedResource() }
        player.player = AVPlayer(url: URL(fileURLWithPath: path))
        controller.present(player, animated: true) { player.player?.play() }
        call.resolve(["ok": true])
    }

    @objc func cache(_ call: CAPPluginCall) {
        let action = call.getString("action") ?? ""
        let id = call.getString("videoId") ?? ""
        let key = call.getString("cacheKey") ?? ""
        let saved = UserDefaults.standard.data(forKey: "iosYtDlpPlaybackCache")
        var entries = (saved.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
        if action == "get" {
            let entry = entries[id + ":" + key] as? [String: Any]
            let current: Any
            if (entry?["expiryTime"] as? Double ?? 0) > Date().timeIntervalSince1970 * 1000 {
                current = (entry as Any?) ?? NSNull()
            } else {
                current = NSNull()
            }
            call.resolve(["entry": current])
        } else {
            if action == "set" { entries[id + ":" + key] = ["expiryTime": call.getDouble("expiryTime") ?? 0, "source": call.getObject("source") ?? [:]] }
            if action == "delete" { entries = entries.filter { !$0.key.hasPrefix(id + ":") } }
            if action == "clear" { entries.removeAll() }
            if let data = try? JSONSerialization.data(withJSONObject: entries) {
                UserDefaults.standard.set(data, forKey: "iosYtDlpPlaybackCache")
            }
            call.resolve(["ok": true])
        }
    }

    @objc func checkUpdate(_ call: CAPPluginCall) { call.resolve(["available": false]) }
    @objc func update(_ call: CAPPluginCall) { call.resolve(["updated": false, "version": "2026.8.19"]) }
}
