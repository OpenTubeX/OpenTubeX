import Capacitor
import ImageIO
import UIKit
import WidgetKit

@objc(HomeWidgetsPlugin)
public class HomeWidgetsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HomeWidgetsPlugin"
    public let jsName = "HomeWidgets"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setContinueWatching", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "org.opentubex.home-widgets")

    @objc func setContinueWatching(_ call: CAPPluginCall) {
        let videos = Array((call.getArray("videos") as? [[String: Any]] ?? [])
            .compactMap(HomeWidgetVideo.init(json:)).prefix(HomeWidgetStore.maxVideos))
        let authorization = call.getObject("authorization").flatMap { json -> (origin: URL, value: String)? in
            guard let url = (json["url"] as? String).flatMap(URL.init(string:)),
                  let value = json["value"] as? String, !value.isEmpty else { return nil }
            return (url, value)
        }
        queue.async {
            do {
                try HomeWidgetStore.save(videos)
            } catch {
                call.reject("Unable to update home screen widgets", nil, error)
                return
            }
            WidgetCenter.shared.reloadTimelines(ofKind: HomeWidgetStore.continueWatchingKind)
            call.resolve()
            if self.updateThumbnails(videos, authorization: authorization) {
                WidgetCenter.shared.reloadTimelines(ofKind: HomeWidgetStore.continueWatchingKind)
            }
        }
    }

    /// Downloads missing thumbnails and removes unused ones. Runs on the serial queue.
    private func updateThumbnails(_ videos: [HomeWidgetVideo], authorization: (origin: URL, value: String)?) -> Bool {
        guard let directory = HomeWidgetStore.directory else { return false }
        var keep = Set(["continue-watching.json"])
        var downloaded = false
        for video in videos {
            guard let file = HomeWidgetStore.thumbnailFile(for: video), let url = URL(string: video.thumbnail) else { continue }
            keep.insert(file.lastPathComponent)
            if FileManager.default.fileExists(atPath: file.path) { continue }
            guard let data = ThumbnailDownload.run(url, authorization: authorization), let image = Self.decode(data),
                  let jpeg = Self.thumbnail(from: image).jpegData(compressionQuality: 0.85) else { continue }
            downloaded = (try? jpeg.write(to: file, options: .atomic)) != nil || downloaded
        }
        for file in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
            where !keep.contains(file.lastPathComponent) {
            try? FileManager.default.removeItem(at: file)
        }
        return downloaded
    }

    /// Decodes at most 1280 px on the longer side, so huge dimensions never become a full bitmap.
    private static func decode(_ data: Data) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: 1280,
              ] as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }

    /// Center-crops to a small 16:9 image; widget extensions have little memory.
    private static func thumbnail(from image: UIImage) -> UIImage {
        let size = CGSize(width: 320, height: 180)
        let scale = max(size.width / max(image.size.width, 1), size.height / max(image.size.height, 1))
        let drawn = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(x: (size.width - drawn.width) / 2, y: (size.height - drawn.height) / 2,
                                  width: drawn.width, height: drawn.height))
        }
    }
}

/// Downloads one thumbnail synchronously, stopping once it exceeds the size limit.
private final class ThumbnailDownload: NSObject, URLSessionDataDelegate {
    private static let maxBytes = 5 * 1024 * 1024
    private let authorization: (origin: URL, value: String)?
    private let finished = DispatchSemaphore(value: 0)
    private var data = Data()
    private var failed = false

    private init(authorization: (origin: URL, value: String)?) {
        self.authorization = authorization
    }

    static func run(_ url: URL, authorization: (origin: URL, value: String)?) -> Data? {
        let download = ThumbnailDownload(authorization: authorization)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 10
        let session = URLSession(configuration: configuration, delegate: download, delegateQueue: nil)
        session.dataTask(with: download.request(url)).resume()
        download.finished.wait()
        session.finishTasksAndInvalidate()
        return download.failed ? nil : download.data
    }

    /// Credentials go only to the Invidious instance's own origin.
    private func request(_ url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        if let authorization, Self.origin(of: url) == Self.origin(of: authorization.origin) {
            request.setValue(authorization.value, forHTTPHeaderField: "Authorization")
        } else {
            request.setValue(nil, forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private static func origin(of url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return nil }
        return "\(scheme)://\(host):\(url.port ?? (scheme == "https" ? 443 : 80))"
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
              response.expectedContentLength <= Self.maxBytes else {
            failed = true
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        data.append(chunk)
        if data.count > Self.maxBytes {
            failed = true
            dataTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = newRequest.url, url.scheme == "https" else { return completionHandler(nil) }
        completionHandler(request(url))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if error != nil { failed = true }
        finished.signal()
    }
}
