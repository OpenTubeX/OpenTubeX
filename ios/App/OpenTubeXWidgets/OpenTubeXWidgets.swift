import AppIntents
import SwiftUI
import UIKit
import WidgetKit

@main
struct OpenTubeXWidgets: WidgetBundle {
    var body: some Widget {
        ContinueWatchingWidget()
        RecentDownloadsWidget()
        WatchTimeWidget()
        QuickAccessWidget()
    }
}

private let urlScheme = Bundle.main.object(forInfoDictionaryKey: "OpenTubeXURLScheme") as? String ?? "opentubex"

private func appURL(_ path: String) -> URL {
    URL(string: "\(urlScheme)://\(path)")!
}

private func videoURL(_ video: HomeWidgetVideo) -> URL {
    appURL("https://www.youtube.com/watch?v=\(video.videoId)&t=\(video.watchProgress)s")
}

// MARK: Continue watching

struct ContinueWatchingEntry: TimelineEntry {
    let date: Date
    let videos: [HomeWidgetVideo]
}

struct ContinueWatchingProvider: TimelineProvider {
    private static let sample = HomeWidgetVideo(videoId: "00000000000", title: String(repeating: " ", count: 24),
                                                author: String(repeating: " ", count: 12), watchProgress: 1,
                                                lengthSeconds: 3, thumbnail: "")

    func placeholder(in context: Context) -> ContinueWatchingEntry {
        ContinueWatchingEntry(date: .now, videos: Array(repeating: Self.sample, count: HomeWidgetStore.maxVideos))
    }

    func getSnapshot(in context: Context, completion: @escaping (ContinueWatchingEntry) -> Void) {
        completion(ContinueWatchingEntry(date: .now, videos: HomeWidgetStore.videos()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ContinueWatchingEntry>) -> Void) {
        // The app reloads this timeline whenever Continue watching changes.
        completion(Timeline(entries: [ContinueWatchingEntry(date: .now, videos: HomeWidgetStore.videos())], policy: .never))
    }
}

struct ContinueWatchingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: HomeWidgetStore.continueWatchingKind, provider: ContinueWatchingProvider()) { entry in
            ContinueWatchingView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Continue watching")
        .description("Resume videos you started watching")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct ContinueWatchingView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ContinueWatchingEntry

    var body: some View {
        if entry.videos.isEmpty {
            EmptyWidgetMessage(message: "Videos you start watching appear here", systemImage: "clock.arrow.circlepath")
        } else if family == .systemSmall, let video = entry.videos.first {
            // Small widgets have a single tap target.
            VStack(alignment: .leading, spacing: 6) {
                Thumbnail(file: HomeWidgetStore.thumbnailFile(for: video), progress: video.progress)
                Text(video.title).font(.caption.weight(.semibold)).lineLimit(2)
                Spacer(minLength: 0)
            }
            .widgetURL(videoURL(video))
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Label("Continue watching", systemImage: "clock.arrow.circlepath")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(.primary).labelStyle(TintedIconLabelStyle())
                ForEach(Array(entry.videos.prefix(family == .systemLarge ? 4 : 2).enumerated()), id: \.offset) { _, video in
                    Link(destination: videoURL(video)) { VideoRow(video: video) }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

private struct TintedIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon.foregroundStyle(.tint)
            configuration.title
        }
    }
}

private struct VideoRow: View {
    let title: String
    let author: String
    let thumbnail: URL?
    var progress: Double? = nil

    var body: some View {
        HStack(spacing: 10) {
            Thumbnail(file: thumbnail, progress: progress).frame(width: 96)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption.weight(.semibold)).lineLimit(2)
                if !author.isEmpty {
                    Text(author).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        // Link labels would otherwise take the accent color.
        .foregroundStyle(Color.primary)
        .multilineTextAlignment(.leading)
    }
}

extension VideoRow {
    init(video: HomeWidgetVideo) {
        self.init(title: video.title, author: video.author, thumbnail: HomeWidgetStore.thumbnailFile(for: video),
                  progress: video.progress)
    }

    init(download: HomeWidgetDownload) {
        self.init(title: download.title, author: download.author, thumbnail: HomeWidgetStore.thumbnailFile(for: download))
    }
}

private extension HomeWidgetVideo {
    var progress: Double? {
        lengthSeconds > 0 ? min(1, Double(watchProgress) / Double(lengthSeconds)) : nil
    }
}

private struct Thumbnail: View {
    let file: URL?
    var progress: Double? = nil

    var body: some View {
        ZStack(alignment: .bottom) {
            Rectangle().fill(.quaternary)
            if let file, let image = UIImage(contentsOfFile: file.path) {
                Image(uiImage: image).resizable().scaledToFill()
            }
            if let progress {
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.black.opacity(0.6))
                        Capsule().fill(.red).frame(width: geometry.size.width * progress)
                    }
                }
                .frame(height: 3).padding(.horizontal, 4).padding(.bottom, 4)
            }
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .accessibilityHidden(true)
    }
}

private struct EmptyWidgetMessage: View {
    let message: LocalizedStringKey
    let systemImage: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage).font(.title2).foregroundStyle(.tint)
            Text(message).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: Recent downloads

private func downloadURL(_ download: HomeWidgetDownload) -> URL {
    appURL("open/download/\(download.id)")
}

struct RecentDownloadsEntry: TimelineEntry {
    let date: Date
    let downloads: [HomeWidgetDownload]
}

struct RecentDownloadsProvider: TimelineProvider {
    private static let sample = HomeWidgetDownload(id: 0, title: String(repeating: " ", count: 24),
                                                   author: String(repeating: " ", count: 12), thumbnail: "")

    func placeholder(in context: Context) -> RecentDownloadsEntry {
        RecentDownloadsEntry(date: .now, downloads: Array(repeating: Self.sample, count: HomeWidgetStore.maxVideos))
    }

    func getSnapshot(in context: Context, completion: @escaping (RecentDownloadsEntry) -> Void) {
        completion(RecentDownloadsEntry(date: .now, downloads: HomeWidgetStore.downloads()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RecentDownloadsEntry>) -> Void) {
        // The app reloads this timeline whenever its downloads change.
        completion(Timeline(entries: [RecentDownloadsEntry(date: .now, downloads: HomeWidgetStore.downloads())], policy: .never))
    }
}

struct RecentDownloadsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: HomeWidgetStore.recentDownloadsKind, provider: RecentDownloadsProvider()) { entry in
            RecentDownloadsView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Recent downloads")
        .description("Play videos you downloaded")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct RecentDownloadsView: View {
    @Environment(\.widgetFamily) private var family
    let entry: RecentDownloadsEntry

    var body: some View {
        if entry.downloads.isEmpty {
            EmptyWidgetMessage(message: "Videos you download appear here", systemImage: "arrow.down.to.line")
                .widgetURL(appURL("open/downloads"))
        } else if family == .systemSmall, let download = entry.downloads.first {
            // Small widgets have a single tap target.
            VStack(alignment: .leading, spacing: 6) {
                Thumbnail(file: HomeWidgetStore.thumbnailFile(for: download))
                Text(download.title).font(.caption.weight(.semibold)).lineLimit(2)
                Spacer(minLength: 0)
            }
            .widgetURL(downloadURL(download))
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Link(destination: appURL("open/downloads")) {
                    // Link labels would otherwise take the accent color.
                    Label("Recent downloads", systemImage: "arrow.down.to.line")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Color.primary).labelStyle(TintedIconLabelStyle())
                }
                ForEach(Array(entry.downloads.prefix(family == .systemLarge ? 4 : 2).enumerated()), id: \.offset) { _, download in
                    Link(destination: downloadURL(download)) { VideoRow(download: download) }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: Watch time

struct WatchTimeEntry: TimelineEntry {
    let date: Date
    /// Watched seconds for the last seven days, ending with this entry's day.
    let days: [(date: Date, seconds: Int)]
}

struct WatchTimeProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchTimeEntry { entry(for: .now, watched: [:]) }

    func getSnapshot(in context: Context, completion: @escaping (WatchTimeEntry) -> Void) {
        completion(entry(for: .now, watched: HomeWidgetStore.watchTime()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchTimeEntry>) -> Void) {
        // The app reloads this timeline when its statistics change; the entries move on at midnight
        // until every cached day has left the week.
        let watched = HomeWidgetStore.watchTime()
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        let entries = [entry(for: .now, watched: watched)] + (1...HomeWidgetStore.watchTimeDays).compactMap { offset in
            calendar.date(byAdding: .day, value: offset, to: today).map { entry(for: $0, watched: watched) }
        }
        completion(Timeline(entries: entries, policy: .never))
    }

    private func entry(for date: Date, watched: [String: Int]) -> WatchTimeEntry {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: date)
        // The app keys days by Gregorian date, whatever calendar the system uses.
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        let days = (0..<HomeWidgetStore.watchTimeDays).reversed().compactMap { offset -> (date: Date, seconds: Int)? in
            guard let day = calendar.date(byAdding: .day, value: -offset, to: today) else { return nil }
            return (day, watched[formatter.string(from: day)] ?? 0)
        }
        return WatchTimeEntry(date: date, days: days)
    }
}

struct WatchTimeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: HomeWidgetStore.watchTimeKind, provider: WatchTimeProvider()) { entry in
            WatchTimeView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(appURL("open/stats"))
        }
        .configurationDisplayName("Watch time")
        .description("Your watch time over the last 7 days")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct WatchTimeView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WatchTimeEntry

    private var today: Int { entry.days.last?.seconds ?? 0 }
    private var total: Int { entry.days.reduce(0) { $0 + $1.seconds } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Watch time", systemImage: "chart.bar.fill")
                .font(.subheadline.weight(.semibold)).labelStyle(TintedIconLabelStyle()).lineLimit(1)
            if family == .systemSmall {
                summary("Today", seconds: today, font: .title3)
                bars
            } else {
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        summary("Today", seconds: today, font: .title3)
                        summary("Last 7 days", seconds: total, font: .subheadline)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    bars.frame(maxWidth: .infinity)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func summary(_ label: LocalizedStringKey, seconds: Int, font: Font) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(Self.format(seconds)).font(font.weight(.bold)).lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }

    // Day names are decorative; the totals carry the information.
    private var bars: some View {
        let maximum = max(1, entry.days.map(\.seconds).max() ?? 0)
        return HStack(alignment: .bottom, spacing: 4) {
            ForEach(Array(entry.days.enumerated()), id: \.offset) { index, day in
                let isToday = index == entry.days.count - 1
                VStack(spacing: 2) {
                    GeometryReader { geometry in
                        VStack(spacing: 0) {
                            Spacer(minLength: 0)
                            // A small floor keeps days with any watch time visible next to long days.
                            Capsule().fill(isToday ? AnyShapeStyle(.tint) : AnyShapeStyle(.tint.opacity(0.45)))
                                .frame(height: day.seconds == 0 ? 0 : max(4, geometry.size.height * Double(day.seconds) / Double(maximum)))
                        }
                        .frame(maxWidth: .infinity)
                        .background(Capsule().fill(.fill.quaternary))
                    }
                    Text(day.date.formatted(.dateTime.weekday(.short)))
                        .font(.system(size: 9, weight: isToday ? .bold : .regular))
                        .foregroundStyle(isToday ? .primary : .secondary).lineLimit(1).minimumScaleFactor(0.6)
                }
            }
        }
        .accessibilityHidden(true)
    }

    /// Whole minutes in the locale's abbreviated units, such as "1h 5m".
    static func format(_ seconds: Int) -> String {
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .abbreviated
        // "1h" instead of "1h 0m", but still "0m" for no watch time.
        formatter.allowedUnits = seconds >= 3600 ? [.hour, .minute] : [.minute]
        formatter.zeroFormattingBehavior = seconds >= 3600 ? .dropAll : .default
        return formatter.string(from: TimeInterval(seconds / 60 * 60)) ?? ""
    }
}

// MARK: Quick access

enum QuickAccessPage: String, AppEnum {
    case search
    case subscriptions
    case watchLater = "watch-later"
    case history
    case playlists
    case downloads

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Pages"
    static var caseDisplayRepresentations: [QuickAccessPage: DisplayRepresentation] = [
        .search: "Search",
        .subscriptions: "Subscriptions",
        .watchLater: "Watch Later",
        .history: "History",
        .playlists: "Playlists",
        .downloads: "Downloads",
    ]

    var title: LocalizedStringKey {
        switch self {
        case .search: "Search"
        case .subscriptions: "Subscriptions"
        case .watchLater: "Watch Later"
        case .history: "History"
        case .playlists: "Playlists"
        case .downloads: "Downloads"
        }
    }

    var systemImage: String {
        switch self {
        case .search: "magnifyingglass"
        case .subscriptions: "dot.radiowaves.left.and.right"
        case .watchLater: "clock"
        case .history: "clock.arrow.circlepath"
        case .playlists: "bookmark"
        case .downloads: "arrow.down.to.line"
        }
    }
}

struct QuickAccessIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Quick access"
    static var description = IntentDescription("Open up to 4 pages you choose")

    // Only enum arrays without a size limit are supported; the provider shows the first 4.
    @Parameter(title: "Pages", default: [.search, .subscriptions, .watchLater])
    var pages: [QuickAccessPage]
}

struct QuickAccessEntry: TimelineEntry {
    let date: Date
    let pages: [QuickAccessPage]
}

struct QuickAccessProvider: AppIntentTimelineProvider {
    static let defaultPages: [QuickAccessPage] = [.search, .subscriptions, .watchLater]

    func placeholder(in context: Context) -> QuickAccessEntry { QuickAccessEntry(date: .now, pages: Self.defaultPages) }

    func snapshot(for configuration: QuickAccessIntent, in context: Context) async -> QuickAccessEntry {
        entry(configuration)
    }

    func timeline(for configuration: QuickAccessIntent, in context: Context) async -> Timeline<QuickAccessEntry> {
        Timeline(entries: [entry(configuration)], policy: .never)
    }

    private func entry(_ configuration: QuickAccessIntent) -> QuickAccessEntry {
        var pages: [QuickAccessPage] = []
        for page in configuration.pages where !pages.contains(page) && pages.count < 4 { pages.append(page) }
        return QuickAccessEntry(date: .now, pages: pages.isEmpty ? Self.defaultPages : pages)
    }
}

struct QuickAccessWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: HomeWidgetStore.quickAccessKind, intent: QuickAccessIntent.self,
                               provider: QuickAccessProvider()) { entry in
            QuickAccessView(pages: entry.pages).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Quick access")
        .description("Open up to 4 pages you choose")
        // Small widgets support only one tap target.
        .supportedFamilies([.systemMedium])
    }
}

struct QuickAccessView: View {
    let pages: [QuickAccessPage]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(pages, id: \.self) { page in
                Link(destination: appURL("open/\(page.rawValue)")) {
                    VStack(spacing: 6) {
                        Image(systemName: page.systemImage).font(.title2).foregroundStyle(.tint).accessibilityHidden(true)
                        Text(page.title).font(.caption).lineLimit(1).minimumScaleFactor(0.8).foregroundStyle(Color.primary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.fill.quaternary, in: RoundedRectangle(cornerRadius: 14))
                }
            }
        }
    }
}
