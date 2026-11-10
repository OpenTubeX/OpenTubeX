import Foundation

/// A Continue watching video cached for the home screen widgets.
struct HomeWidgetVideo: Codable, Equatable {
    let videoId: String
    let title: String
    let author: String
    let watchProgress: Int
    let lengthSeconds: Int
    let thumbnail: String

    init(videoId: String, title: String, author: String, watchProgress: Int, lengthSeconds: Int, thumbnail: String) {
        self.videoId = videoId
        self.title = title
        self.author = author
        self.watchProgress = watchProgress
        self.lengthSeconds = lengthSeconds
        self.thumbnail = thumbnail
    }

    init?(json: [String: Any]) {
        guard let id = json["videoId"] as? String,
              id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else { return nil }
        let thumbnail = json["thumbnail"] as? String ?? ""
        self.init(videoId: id, title: json["title"] as? String ?? "", author: json["author"] as? String ?? "",
                  watchProgress: max(0, (json["watchProgress"] as? NSNumber)?.intValue ?? 0),
                  lengthSeconds: max(0, (json["lengthSeconds"] as? NSNumber)?.intValue ?? 0),
                  thumbnail: URL(string: thumbnail)?.scheme == "https" ? thumbnail : "")
    }
}

/// Shares widget data through the App Group. Widgets only read this cache;
/// the app writes it and downloads thumbnails, so widgets make no requests.
enum HomeWidgetStore {
    static let continueWatchingKind = "ContinueWatching"
    static let quickAccessKind = "QuickAccess"
    static let maxVideos = 4

    static var directory: URL? {
        guard let configured = Bundle.main.object(forInfoDictionaryKey: "OpenTubeXAppGroup") as? String else { return nil }
        let profile = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision").flatMap { try? Data(contentsOf: $0) }
        let group = appGroup(configured, provisioned: provisionedAppGroups(profile))
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
        return container.appendingPathComponent("HomeWidgets", isDirectory: true)
    }

    /// SideStore re-signs with the App Group renamed to `<group>.<team ID>`,
    /// so the app and its widgets look up the name their profile grants.
    static func appGroup(_ configured: String, provisioned: [String]) -> String {
        provisioned.contains(configured) ? configured : provisioned.first { $0.hasPrefix(configured + ".") } ?? configured
    }

    /// Reads the App Groups from the XML plist inside a signed provisioning profile.
    static func provisionedAppGroups(_ profile: Data?) -> [String] {
        guard let profile,
              let start = profile.range(of: Data("<?xml".utf8)),
              let end = profile.range(of: Data("</plist>".utf8), in: start.lowerBound..<profile.endIndex),
              let plist = try? PropertyListSerialization.propertyList(from: profile[start.lowerBound..<end.upperBound], format: nil) as? [String: Any],
              let entitlements = plist["Entitlements"] as? [String: Any] else { return [] }
        return entitlements["com.apple.security.application-groups"] as? [String] ?? []
    }

    static func videos() -> [HomeWidgetVideo] {
        guard let file = directory?.appendingPathComponent("continue-watching.json"),
              let data = try? Data(contentsOf: file) else { return [] }
        return Array(((try? JSONDecoder().decode([HomeWidgetVideo].self, from: data)) ?? []).prefix(maxVideos))
    }

    static func save(_ videos: [HomeWidgetVideo]) throws {
        guard let directory else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(videos).write(to: directory.appendingPathComponent("continue-watching.json"), options: .atomic)
    }

    /// Thumbnail files are named after their URL so a changed thumbnail setting replaces them.
    static func thumbnailFile(for video: HomeWidgetVideo) -> URL? {
        guard !video.thumbnail.isEmpty else { return nil }
        // FNV-1a: Swift's hashValue changes between launches.
        let hash = video.thumbnail.utf8.reduce(UInt64(14_695_981_039_346_656_037)) { ($0 ^ UInt64($1)) &* 1_099_511_628_211 }
        return directory?.appendingPathComponent("\(video.videoId)-\(String(hash, radix: 16)).jpg")
    }
}
