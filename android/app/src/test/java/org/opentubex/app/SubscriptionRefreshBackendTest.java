package org.opentubex.app;

import static org.junit.Assert.*;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class SubscriptionRefreshBackendTest {
    private SubscriptionRefreshConfiguration.Feed feed(JSONArray requests) throws Exception {
        JSONObject configuration = new JSONObject()
            .put("intervals", new JSONObject().put("videos", 1800000))
            .put("requests", new JSONObject().put("videos", requests))
            .put("profiles", new JSONArray().put(new JSONObject().put("id", "all")
                .put("channels", new JSONObject().put("videos", new JSONArray().put("UCtest")))));
        return SubscriptionRefreshConfiguration.parseFeeds(configuration).get(0);
    }

    @Test
    public void localRefreshDoesNotRequireAnInvidiousInstance() throws Exception {
        JSONArray requests = new JSONArray().put(new JSONObject().put("format", "local").put("url", "https://www.youtube.com/youtubei/v1/browse"));
        SubscriptionRefreshConfiguration.Feed feed = feed(requests);
        List<String> urls = new ArrayList<>();
        JSONObject result = SubscriptionRefreshHttpClient.fetch(feed, "UCtest", (request, type, id) -> {
            urls.add(request.getString("url"));
            return "{\"contents\":{}}";
        });
        assertEquals(List.of("https://www.youtube.com/youtubei/v1/browse"), urls);
        assertEquals("local", result.getString("backgroundFormat"));
    }

    @Test
    public void honorsOrderedFallbackAndRejectsMalformedRss() throws Exception {
        JSONArray requests = new JSONArray()
            .put(new JSONObject().put("format", "rss"))
            .put(new JSONObject().put("format", "invidious"));
        List<String> formats = new ArrayList<>();
        JSONObject result = SubscriptionRefreshHttpClient.fetch(feed(requests), "UCtest", (request, type, id) -> {
            String format = request.getString("format");
            formats.add(format);
            return format.equals("rss") ? "<html>failure</html>" : "{\"videos\":[]}";
        });
        assertEquals(List.of("rss", "invidious"), formats);
        assertEquals(0, result.getJSONArray("videos").length());
    }

    @Test
    public void aFailedLocalRequestDoesNotInventAnInvidiousFallback() throws Exception {
        JSONArray requests = new JSONArray().put(new JSONObject().put("format", "local"));
        List<String> formats = new ArrayList<>();
        assertThrows(IOException.class, () -> SubscriptionRefreshHttpClient.fetch(feed(requests), "UCtest", (request, type, id) -> {
            formats.add(request.getString("format"));
            throw new IOException("offline");
        }));
        assertEquals(List.of("local"), formats);
    }

    @Test
    public void backendChangesInvalidateTheNativeCheckpoint() throws Exception {
        SubscriptionRefreshConfiguration.Feed local = feed(new JSONArray().put(new JSONObject().put("format", "local")));
        SubscriptionRefreshConfiguration.Feed rss = feed(new JSONArray().put(new JSONObject().put("format", "rss")));
        assertNotEquals(SubscriptionRefreshCheckpoint.configurationId(List.of(local)), SubscriptionRefreshCheckpoint.configurationId(List.of(rss)));
    }
    @Test
    public void downloadsKeepWorkingWithLocalResults() throws Exception {
        long now = java.time.Instant.parse("2026-09-14T12:00:00Z").toEpochMilli();
        JSONObject video = new JSONObject().put("videoId", "abcdefghijk")
            .put("title", new JSONObject().put("simpleText", "New video"))
            .put("publishedTimeText", new JSONObject().put("simpleText", "1 hour ago"))
            .put("lengthText", new JSONObject().put("simpleText", "2:30"));
        JSONObject response = new JSONObject().put("backgroundFormat", "local")
            .put("data", new JSONObject().put("contents", new JSONObject().put("videoRenderer", video)));
        JSONObject parsed = SubscriptionRefreshDownloadMetadata.forDownloads(response, now).getJSONArray("videos").getJSONObject(0);
        assertEquals(now / 1000 - 3600, parsed.getLong("published"));
        assertEquals(150, parsed.getLong("lengthSeconds"));
        assertEquals("abcdefghijk", parsed.getString("videoId"));
    }

    @Test
    public void emptyLivePagesRecognizeContinuationTokensButDoNotPaginatePastVideos() throws Exception {
        JSONObject response = new JSONObject().put("contents", new JSONObject().put("continuationCommand", new JSONObject().put("token", "next")));
        assertEquals("next", SubscriptionRefreshHttpClient.emptyLiveContinuation(response));
        response.getJSONObject("contents").put("videoRenderer", new JSONObject());
        assertNull(SubscriptionRefreshHttpClient.emptyLiveContinuation(response));
    }

    @Test
    public void downloadsReadGridPlaylistAndLiveContinuationResults() throws Exception {
        JSONObject video = new JSONObject().put("videoId", "abcdefghijk")
            .put("title", new JSONObject().put("simpleText", "New video"))
            .put("publishedTimeText", new JSONObject().put("simpleText", "1 hour ago"));
        for (String renderer : List.of("gridVideoRenderer", "playlistVideoRenderer")) {
            JSONObject response = new JSONObject().put("backgroundFormat", "localPlaylist")
                .put("data", new JSONObject().put("contents", new JSONObject().put(renderer, video)));
            assertEquals(1, SubscriptionRefreshDownloadMetadata.forDownloads(response, 10000000).getJSONArray("videos").length());
        }
        video.put("thumbnailOverlays", new JSONArray().put(new JSONObject().put("thumbnailOverlayTimeStatusRenderer",
            new JSONObject().put("style", "DEFAULT").put("text", new JSONObject().put("simpleText", "3:00")))));
        JSONObject playlist = new JSONObject().put("backgroundFormat", "localPlaylist")
            .put("data", new JSONObject().put("contents", new JSONObject().put("playlistVideoRenderer", video)));
        assertEquals(180, SubscriptionRefreshDownloadMetadata.forDownloads(playlist, 10000000).getJSONArray("videos").getJSONObject(0).getLong("lengthSeconds"));
        video.remove("publishedTimeText");
        assertEquals(0, SubscriptionRefreshDownloadMetadata.forDownloads(playlist, 10000000).getJSONArray("videos").getJSONObject(0).getLong("published"));
        JSONObject response = new JSONObject().put("backgroundFormat", "local")
            .put("data", new JSONObject().put("contents", new JSONObject()))
            .put("continuation", new JSONObject().put("onResponseReceivedActions", new JSONArray()
                .put(new JSONObject().put("appendContinuationItemsAction", new JSONObject()
                    .put("continuationItems", new JSONArray().put(new JSONObject().put("videoRenderer", video)))))));
        assertEquals(1, SubscriptionRefreshDownloadMetadata.forDownloads(response, 10000000).getJSONArray("videos").length());
    }

    @Test
    public void rssDownloadCandidatesSkipPremieresAndMalformedViewsIndividually() throws Exception {
        StringBuilder xml = new StringBuilder("<feed xmlns:yt='urn:yt' xmlns:media='urn:media'>");
        for (String views : List.of("0", "1", "unknown", "2")) {
            xml.append("<entry><yt:videoId>abcdefghijk</yt:videoId><title>Video</title><published>2026-09-14T12:00:00Z</published><media:statistics views='")
                .append(views).append("'/></entry>");
        }
        xml.append("</feed>");
        JSONArray videos = SubscriptionRefreshDownloadMetadata.forDownloads(new JSONObject()
            .put("backgroundFormat", "rss").put("text", xml.toString()), 0).getJSONArray("videos");
        assertEquals(1, videos.length());
    }

    @Test
    public void downloadsReadRecordedLockupMetadataButNeverInventPublicationDates() throws Exception {
        // Minimal metadata from the recorded edited-comments fixture.
        JSONObject lockup = new JSONObject("{\"contentId\":\"NxNlfjVeTas\",\"contentType\":\"LOCKUP_CONTENT_TYPE_VIDEO\",\"metadata\":{\"lockupMetadataViewModel\":{\"title\":{\"content\":\"Strong Women vs. Skinny Men - (Who\\u2019s Stronger?)\"},\"metadata\":{\"contentMetadataViewModel\":{\"metadataRows\":[{\"metadataParts\":[{\"text\":{\"content\":\"2.2M views\"}},{\"text\":{\"content\":\"1 month ago\"},\"accessibilityLabel\":\"1 month ago\"}]}],\"delimiter\":\" \\u2022 \"}}}},\"contentImage\":{\"thumbnailViewModel\":{\"overlays\":[{\"thumbnailBottomOverlayViewModel\":{\"badges\":[{\"thumbnailBadgeViewModel\":{\"text\":\"24:58\",\"badgeStyle\":\"THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT\"}}]}}]}}}");
        JSONObject response = new JSONObject().put("backgroundFormat", "local")
            .put("data", new JSONObject().put("contents", new JSONObject().put("lockupViewModel", lockup)));
        JSONObject parsed = SubscriptionRefreshDownloadMetadata.forDownloads(response, 4000000000L).getJSONArray("videos").getJSONObject(0);
        assertEquals(1408000, parsed.getLong("published"));
        assertEquals(1498, parsed.getLong("lengthSeconds"));
        assertEquals("NxNlfjVeTas", parsed.getString("videoId"));
        JSONObject badge = lockup.getJSONObject("contentImage").getJSONObject("thumbnailViewModel")
            .getJSONArray("overlays").getJSONObject(0).getJSONObject("thumbnailBottomOverlayViewModel")
            .getJSONArray("badges").getJSONObject(0).getJSONObject("thumbnailBadgeViewModel");
        badge.put("text", "Upcoming");
        parsed = SubscriptionRefreshDownloadMetadata.forDownloads(response, 4000000000L).getJSONArray("videos").getJSONObject(0);
        assertTrue(parsed.getBoolean("isUpcoming"));
        assertFalse(YtDlpAutomaticDownloads.matches(parsed, "videos", new JSONObject().put("includeVideos", true).put("enabledAt", 1000), 4000000000L));
        badge.put("text", "PREMIERE").put("badgeStyle", "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE");
        parsed = SubscriptionRefreshDownloadMetadata.forDownloads(response, 4000000000L).getJSONArray("videos").getJSONObject(0);
        assertTrue(parsed.getBoolean("premiere"));
        assertTrue(parsed.getBoolean("liveNow"));
        badge.put("text", "24:58").put("badgeStyle", "THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT");
        lockup.getJSONObject("metadata").getJSONObject("lockupMetadataViewModel").remove("metadata");
        parsed = SubscriptionRefreshDownloadMetadata.forDownloads(response, 4000000000L).getJSONArray("videos").getJSONObject(0);
        assertEquals(0, parsed.getLong("published"));
        assertFalse(YtDlpAutomaticDownloads.matches(parsed, "videos", new JSONObject().put("includeVideos", true).put("enabledAt", 1000), 4000000000L));
    }

}
