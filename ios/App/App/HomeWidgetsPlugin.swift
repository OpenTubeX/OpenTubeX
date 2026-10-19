import Capacitor
import UIKit
import WidgetKit

@objc(HomeWidgetsPlugin)
public class HomeWidgetsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HomeWidgetsPlugin"
    public let jsName = "HomeWidgets"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setContinueWatching", returnType: CAPPluginReturnPromise)
    ]
    private static let maxThumbnailBytes = 5 * 1024 * 1024
    private let queue = DispatchQueue(label: "org.opentubex.home-widgets")
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 10
        return URLSession(configuration: configuration)
    }()

    @objc func setContinueWatching(_ call: CAPPluginCall) {
        let videos = Array((call.getArray("videos") as? [[String: Any]] ?? [])
            .compactMap(HomeWidgetVideo.init(json:)).prefix(HomeWidgetStore.maxVideos))
        queue.async {
            do {
                try HomeWidgetStore.save(videos)
            } catch {
                call.reject("Unable to update home screen widgets", nil, error)
                return
            }
            WidgetCenter.shared.reloadTimelines(ofKind: HomeWidgetStore.continueWatchingKind)
            call.resolve()
            if self.updateThumbnails(videos) {
                WidgetCenter.shared.reloadTimelines(ofKind: HomeWidgetStore.continueWatchingKind)
            }
        }
    }

    /// Downloads missing thumbnails and removes unused ones. Runs on the serial queue.
    private func updateThumbnails(_ videos: [HomeWidgetVideo]) -> Bool {
        guard let directory = HomeWidgetStore.directory else { return false }
        var keep = Set(["continue-watching.json"])
        var downloaded = false
        for video in videos {
            guard let file = HomeWidgetStore.thumbnailFile(for: video), let url = URL(string: video.thumbnail) else { continue }
            keep.insert(file.lastPathComponent)
            if FileManager.default.fileExists(atPath: file.path) { continue }
            guard let data = download(url), let image = UIImage(data: data),
                  let jpeg = Self.thumbnail(from: image).jpegData(compressionQuality: 0.85) else { continue }
            downloaded = (try? jpeg.write(to: file, options: .atomic)) != nil || downloaded
        }
        for file in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
            where !keep.contains(file.lastPathComponent) {
            try? FileManager.default.removeItem(at: file)
        }
        return downloaded
    }

    private func download(_ url: URL) -> Data? {
        let semaphore = DispatchSemaphore(value: 0)
        var result: Data?
        session.dataTask(with: url) { data, response, _ in
            if let data, data.count <= Self.maxThumbnailBytes,
               let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) {
                result = data
            }
            semaphore.signal()
        }.resume()
        semaphore.wait()
        return result
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
