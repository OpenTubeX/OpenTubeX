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

/// A download that plays offline, cached for the Recent downloads widget.
struct HomeWidgetDownload: Codable, Equatable {
    let id: Int
    let title: String
    let author: String
    let thumbnail: String

    init(id: Int, title: String, author: String, thumbnail: String) {
        self.id = id
        self.title = title
        self.author = author
        self.thumbnail = thumbnail
    }

    init?(json: [String: Any]) {
        guard let id = (json["id"] as? NSNumber)?.intValue, id >= 0 else { return nil }
        let thumbnail = json["thumbnail"] as? String ?? ""
        self.init(id: id, title: json["title"] as? String ?? "", author: json["author"] as? String ?? "",
                  thumbnail: URL(string: thumbnail)?.scheme == "https" ? thumbnail : "")
    }
}

/// Shares widget data through the App Group. Widgets only read this cache;
/// the app writes it and downloads thumbnails, so widgets make no requests.
enum HomeWidgetStore {
    static let continueWatchingKind = "ContinueWatching"
    static let quickAccessKind = "QuickAccess"
    static let recentDownloadsKind = "RecentDownloads"
    static let watchTimeKind = "WatchTime"
    static let maxVideos = 4
    static let watchTimeDays = 7

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
        Array((read([HomeWidgetVideo].self, from: "continue-watching.json") ?? []).prefix(maxVideos))
    }

    static func save(_ videos: [HomeWidgetVideo]) throws {
        try write(videos, to: "continue-watching.json")
    }

    static func downloads() -> [HomeWidgetDownload] {
        Array((read([HomeWidgetDownload].self, from: "downloads.json") ?? []).prefix(maxVideos))
    }

    static func save(_ downloads: [HomeWidgetDownload]) throws {
        try write(downloads, to: "downloads.json")
    }

    /// Watched seconds keyed by local date (`yyyy-MM-dd`).
    static func watchTime() -> [String: Int] {
        read([String: Int].self, from: "watch-time.json") ?? [:]
    }

    static func saveWatchTime(_ days: [String: Int]) throws {
        try write(days, to: "watch-time.json")
    }

    /// Keeps valid dates with watch time; the app sends only the last week.
    static func parseWatchTime(_ json: [String: Any]) -> [String: Int] {
        var days: [String: Int] = [:]
        for (date, value) in json where days.count < watchTimeDays {
            guard date.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil,
                  let seconds = (value as? NSNumber)?.intValue, seconds > 0 else { continue }
            days[date] = seconds
        }
        return days
    }

    private static func read<Value: Decodable>(_ type: Value.Type, from name: String) -> Value? {
        guard let file = directory?.appendingPathComponent(name), let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private static func write<Value: Encodable>(_ value: Value, to name: String) throws {
        guard let directory else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(value).write(to: directory.appendingPathComponent(name), options: .atomic)
    }

    /// Download thumbnails live in their own folder so each list cleans up only its files.
    static var downloadThumbnailDirectory: URL? {
        directory?.appendingPathComponent("Downloads", isDirectory: true)
    }

    /// Thumbnail files are named after their URL so a changed thumbnail setting replaces them.
    static func thumbnailFile(for video: HomeWidgetVideo) -> URL? {
        guard !video.thumbnail.isEmpty else { return nil }
        return directory?.appendingPathComponent("\(video.videoId)-\(hash(video.thumbnail)).jpg")
    }

    static func thumbnailFile(for download: HomeWidgetDownload) -> URL? {
        guard !download.thumbnail.isEmpty else { return nil }
        return downloadThumbnailDirectory?.appendingPathComponent("\(download.id)-\(hash(download.thumbnail)).jpg")
    }

    /// FNV-1a: Swift's hashValue changes between launches.
    private static func hash(_ value: String) -> String {
        String(value.utf8.reduce(UInt64(14_695_981_039_346_656_037)) { ($0 ^ UInt64($1)) &* 1_099_511_628_211 }, radix: 16)
    }
}
