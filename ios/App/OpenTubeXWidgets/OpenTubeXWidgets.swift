import SwiftUI
import UIKit
import WidgetKit

@main
struct OpenTubeXWidgets: WidgetBundle {
    var body: some Widget {
        ContinueWatchingWidget()
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
            VStack(spacing: 8) {
                Image(systemName: "clock.arrow.circlepath").font(.title2).foregroundStyle(.tint)
                Text("Videos you start watching appear here")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if family == .systemSmall, let video = entry.videos.first {
            // Small widgets have a single tap target.
            VStack(alignment: .leading, spacing: 6) {
                Thumbnail(video: video)
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
    let video: HomeWidgetVideo

    var body: some View {
        HStack(spacing: 10) {
            Thumbnail(video: video).frame(width: 96)
            VStack(alignment: .leading, spacing: 2) {
                Text(video.title).font(.caption.weight(.semibold)).lineLimit(2)
                if !video.author.isEmpty {
                    Text(video.author).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        // Link labels would otherwise take the accent color.
        .foregroundStyle(Color.primary)
        .multilineTextAlignment(.leading)
    }
}

private struct Thumbnail: View {
    let video: HomeWidgetVideo

    var body: some View {
        ZStack(alignment: .bottom) {
            Rectangle().fill(.quaternary)
            if let file = HomeWidgetStore.thumbnailFile(for: video), let image = UIImage(contentsOfFile: file.path) {
                Image(uiImage: image).resizable().scaledToFill()
            }
            if video.lengthSeconds > 0 {
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.black.opacity(0.6))
                        Capsule().fill(.red)
                            .frame(width: geometry.size.width * min(1, Double(video.watchProgress) / Double(video.lengthSeconds)))
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

// MARK: Quick access

struct QuickAccessEntry: TimelineEntry {
    let date: Date
}

struct QuickAccessProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuickAccessEntry { QuickAccessEntry(date: .now) }

    func getSnapshot(in context: Context, completion: @escaping (QuickAccessEntry) -> Void) {
        completion(QuickAccessEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuickAccessEntry>) -> Void) {
        completion(Timeline(entries: [QuickAccessEntry(date: .now)], policy: .never))
    }
}

struct QuickAccessWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: HomeWidgetStore.quickAccessKind, provider: QuickAccessProvider()) { _ in
            QuickAccessView().containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Quick access")
        .description("Open Search, Subscriptions or Watch Later")
        // Small widgets support only one tap target.
        .supportedFamilies([.systemMedium])
    }
}

struct QuickAccessView: View {
    var body: some View {
        HStack(spacing: 8) {
            action("Search", systemImage: "magnifyingglass", page: "search")
            action("Subscriptions", systemImage: "dot.radiowaves.left.and.right", page: "subscriptions")
            action("Watch Later", systemImage: "clock", page: "watch-later")
        }
    }

    private func action(_ title: LocalizedStringKey, systemImage: String, page: String) -> some View {
        Link(destination: appURL("open/\(page)")) {
            VStack(spacing: 6) {
                Image(systemName: systemImage).font(.title2).foregroundStyle(.tint).accessibilityHidden(true)
                Text(title).font(.caption).lineLimit(1).minimumScaleFactor(0.8).foregroundStyle(Color.primary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.fill.quaternary, in: RoundedRectangle(cornerRadius: 14))
        }
    }
}
