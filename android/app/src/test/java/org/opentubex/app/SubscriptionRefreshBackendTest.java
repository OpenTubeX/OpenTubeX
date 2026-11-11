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
        return feed("videos", requests);
    }

    private SubscriptionRefreshConfiguration.Feed feed(String type, JSONArray requests) throws Exception {
        JSONObject configuration = new JSONObject()
            .put("intervals", new JSONObject().put(type, 1800000))
            .put("requests", new JSONObject().put(type, requests))
            .put("profiles", new JSONArray().put(new JSONObject().put("id", "all")
                .put("channels", new JSONObject().put(type, new JSONArray().put("UCtest")))));
        return SubscriptionRefreshConfiguration.parseFeeds(configuration).get(0);
    }

    private JSONObject channelPage(String channelId, String path) throws Exception {
        JSONObject tab = new JSONObject().put("selected", true)
            .put("content", new JSONObject().put("videoRenderer", new JSONObject().put("videoId", "regular-video")))
            .put("endpoint", new JSONObject().put("commandMetadata", new JSONObject()
                .put("webCommandMetadata", new JSONObject().put("url", "/@channel/" + path))));
        return new JSONObject().put("metadata", new JSONObject().put("channelMetadataRenderer", new JSONObject().put("externalId", channelId)))
            .put("contents", new JSONObject().put("twoColumnBrowseResultsRenderer", new JSONObject()
                .put("tabs", new JSONArray().put(new JSONObject().put("tabRenderer", tab)))));
    }

    @Test
    public void resendsRequestsThatLostTheirConnectionOnly() throws Exception {
        int[] calls = new int[1];
        SubscriptionRefreshHttpClient.RequestFetcher closedOnce = SubscriptionRefreshHttpClient.resendingBrokenConnections((request, type, id) -> {
            if (calls[0]++ == 0) throw new java.net.SocketException("Socket closed");
            return "{}";
        });
        assertEquals("{}", closedOnce.fetch(new JSONObject(), "videos", "UCtest"));
        assertEquals(2, calls[0]);

        for (IOException error : new IOException[] {
            new IOException("unexpected end of stream on com.android.okhttp.Address@1"),
            new java.net.SocketTimeoutException("Read timed out"),
            new javax.net.ssl.SSLException("Read error: ssl=0x1: I/O error during system call, Connection reset by peer"),
            new IOException("HTTP 404"),
        }) {
            calls[0] = 0;
            IOException thrown = assertThrows(IOException.class, () -> SubscriptionRefreshHttpClient.resendingBrokenConnections((request, type, id) -> {
                calls[0]++;
                throw error;
            }).fetch(new JSONObject(), "videos", "UCtest"));
            assertSame(error, thrown);
            assertEquals(error.getMessage(), error instanceof java.net.SocketTimeoutException ? 2 : error.getMessage().startsWith("HTTP") ? 1 : 3, calls[0]);
        }

        // An attempt that already waited out a timeout gets no third try.
        calls[0] = 0;
        assertThrows(IOException.class, () -> SubscriptionRefreshHttpClient.resendingBrokenConnections((request, type, id) -> {
            if (calls[0]++ == 0) throw new java.net.SocketTimeoutException("Read timed out");
            throw new java.net.SocketException("Socket closed");
        }).fetch(new JSONObject(), "videos", "UCtest"));
        assertEquals(2, calls[0]);
    }

    @Test
    public void cancelledFetchesStopReadingTheirResponse() throws Exception {
        Thread.currentThread().interrupt();
        try {
            SubscriptionRefreshHttpClient.readResponse(new java.io.ByteArrayInputStream(new byte[] { '{', '}' }));
            fail("an interrupted fetch keeps downloading");
        } catch (java.io.IOException error) {
            assertEquals("Refresh cancelled", error.getMessage());
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    public void topicChannelWithoutUploadsDoesNotFailItsBackgroundRefresh() throws Exception {
        JSONArray requests = new JSONArray()
            .put(new JSONObject().put("format", "local"))
            .put(new JSONObject().put("format", "rss"))
            .put(new JSONObject().put("format", "localPlaylist"));
        String missingPlaylist = new JSONObject().put("alerts", new JSONArray().put(new JSONObject().put("alertRenderer", new JSONObject()
            .put("type", "ERROR").put("text", new JSONObject().put("simpleText", "The playlist does not exist."))))).toString();
        for (String channelId : List.of("UCtest", "UCother")) {
            JSONObject page = channelPage(channelId, "featured");
            page.getJSONObject("metadata").getJSONObject("channelMetadataRenderer").put("musicArtistName", "Artist");
            SubscriptionRefreshHttpClient.RequestFetcher fetcher = (request, type, id) -> {
                switch (request.getString("format")) {
                    case "local": return page.toString();
                    case "localPlaylist": return missingPlaylist;
                    default: throw new IOException("HTTP 404");
                }
            };
            if (channelId.equals("UCtest")) {
                assertEquals(0, SubscriptionRefreshHttpClient.fetch(feed(requests), "UCtest", fetcher).getJSONArray("videos").length());
            } else {
                // Only the subscribed channel's page proves that the missing playlist means no uploads.
                assertThrows(IOException.class, () -> SubscriptionRefreshHttpClient.fetch(feed(requests), "UCtest", fetcher));
            }
        }
    }

    @Test
    public void channelWithoutShortsDoesNotFailItsBackgroundRefresh() throws Exception {
        JSONArray requests = new JSONArray()
            .put(new JSONObject().put("format", "rss"))
            .put(new JSONObject().put("format", "localPlaylist"))
            .put(new JSONObject().put("format", "local").put("body", "{\"browseId\":\"%CHANNEL%\",\"params\":\"shorts\"}"));
        String page = channelPage("UCtest", "videos").toString();
        JSONObject result = SubscriptionRefreshHttpClient.fetch(feed("shorts", requests), "UCtest", (request, type, id) -> {
            if (!request.optString("format").equals("local") || new JSONObject(request.getString("body")).has("params")) {
                throw new IOException("HTTP 404");
            }
            return page;
        });
        assertEquals(0, result.getJSONArray("videos").length());
    }

    @Test
    public void redirectedOptionalTabsDoNotImportRegularVideos() throws Exception {
        for (String type : List.of("shorts", "live", "posts")) {
            for (String layout : List.of("twoColumnBrowseResultsRenderer", "singleColumnBrowseResultsRenderer", "mixed")) {
                JSONObject page = channelPage("UCtest", "videos");
                JSONObject contents = page.getJSONObject("contents");
                contents.put(layout.equals("mixed") ? "singleColumnBrowseResultsRenderer" : layout, contents.remove("twoColumnBrowseResultsRenderer"));
                if (layout.equals("mixed")) contents.put("twoColumnBrowseResultsRenderer", new JSONObject());
                JSONObject result = SubscriptionRefreshHttpClient.fetch(
                    feed(type, new JSONArray().put(new JSONObject().put("format", "local"))), "UCtest",
                    (request, feedType, id) -> page.toString());
                assertEquals(0, result.getJSONArray(type.equals("posts") ? "comments" : "videos").length());
            }
        }
    }

    @Test
    public void channelWithoutAnyContentDoesNotFailItsBackgroundRefresh() throws Exception {
        // YouTube answers every tab of such a channel with an endpoint-less Home tab.
        JSONObject tab = new JSONObject().put("title", "Home").put("selected", true)
            .put("content", new JSONObject().put("sectionListRenderer", new JSONObject().put("contents", new JSONArray()
                .put(new JSONObject().put("channelOwnerEmptyStateRenderer", new JSONObject())))));
        JSONObject page = channelPage("UCtest", "videos");
        page.getJSONObject("contents").getJSONObject("twoColumnBrowseResultsRenderer")
            .put("tabs", new JSONArray().put(new JSONObject().put("tabRenderer", tab)));
        for (String type : List.of("shorts", "live", "posts")) {
            JSONArray requests = new JSONArray()
                .put(new JSONObject().put("format", "local"))
                .put(new JSONObject().put("format", "rss"));
            JSONObject result = SubscriptionRefreshHttpClient.fetch(feed(type, requests), "UCtest", (request, feedType, id) -> {
                if (!request.optString("format").equals("local")) throw new IOException("HTTP 404");
                return page.toString();
            });
            assertEquals(0, result.getJSONArray(type.equals("posts") ? "comments" : "videos").length());
        }
    }

    @Test
    public void interruptedVerificationPreservesCancellationInsteadOfReturningDataOrHttpFailure() throws Exception {
        for (boolean beforeVerification : List.of(true, false)) {
            JSONArray requests = new JSONArray().put(new JSONObject().put("format", "local")
                .put("body", "{\"browseId\":\"%CHANNEL%\",\"params\":\"shorts\"}"));
            String page = channelPage("UCtest", "videos").toString();
            int[] calls = {0};
            try {
                IOException error = assertThrows(IOException.class, () -> SubscriptionRefreshHttpClient.fetch(feed("shorts", requests), "UCtest", (request, type, id) -> {
                    calls[0]++;
                    if (new JSONObject(request.getString("body")).has("params")) {
                        if (beforeVerification) Thread.currentThread().interrupt();
                        throw new IOException("HTTP 404");
                    }
                    Thread.currentThread().interrupt();
                    return page;
                }));
                assertEquals("Refresh cancelled", error.getMessage());
                assertEquals(beforeVerification ? 1 : 2, calls[0]);
                assertTrue(Thread.currentThread().isInterrupted());
            } finally {
                Thread.interrupted();
            }
        }
    }

    @Test
    public void missingTabVerificationDoesNotHideRealFailures() throws Exception {
        for (String type : List.of("shorts", "live", "posts")) {
            JSONObject valid = channelPage("UCtest", "videos");
            for (JSONObject page : List.of(
                channelPage("UCtest", type.equals("live") ? "streams" : type),
                channelPage("UCother", "videos"),
                new JSONObject(valid.toString()).put("alerts", new JSONArray().put(new JSONObject()
                    .put("alertRenderer", new JSONObject().put("type", "ERROR")))),
                new JSONObject(),
                new JSONObject(valid.toString()).put("contents", new JSONObject())
            )) {
                JSONArray requests = new JSONArray().put(new JSONObject().put("format", "local")
                    .put("body", "{\"browseId\":\"%CHANNEL%\",\"params\":\"tab\"}"));
                assertThrows(IOException.class, () -> SubscriptionRefreshHttpClient.fetch(feed(type, requests), "UCtest", (request, feedType, id) -> {
                    if (new JSONObject(request.getString("body")).has("params")) throw new IOException("HTTP 404");
                    return page.toString();
                }));
            }
            for (JSONObject page : List.of(channelPage("UCother", "videos"), new JSONObject(valid.toString()).put("metadata", JSONObject.NULL))) {
                assertThrows(IOException.class, () -> SubscriptionRefreshHttpClient.fetch(
                    feed(type, new JSONArray().put(new JSONObject().put("format", "local"))), "UCtest",
                    (request, feedType, id) -> page.toString()));
            }
        }
    }

    @Test
    public void localRefreshDoesNotRequireAnInvidiousInstance() throws Exception {
        JSONArray requests = new JSONArray().put(new JSONObject().put("format", "local").put("url", "https://www.youtube.com/youtubei/v1/browse"));
        SubscriptionRefreshConfiguration.Feed feed = feed(requests);
        List<String> urls = new ArrayList<>();
        JSONObject result = SubscriptionRefreshHttpClient.fetch(feed, "UCtest", (request, type, id) -> {
            urls.add(request.getString("url"));
            return "{\"contents\":{\"twoColumnBrowseResultsRenderer\":{\"tabs\":[{\"tabRenderer\":{\"selected\":true,\"content\":{}}}]}}}";
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

    @Test
    public void ordinaryTitlesDoNotBecomeUpcomingOrLiveDownloadEntries() throws Exception {
        JSONObject video = new JSONObject().put("videoId", "abcdefghijk")
            .put("title", new JSONObject().put("simpleText", "UPCOMING games and BADGE_STYLE_TYPE_LIVE_NOW explained"))
            .put("publishedTimeText", new JSONObject().put("simpleText", "1 hour ago"));
        JSONObject response = new JSONObject().put("backgroundFormat", "local")
            .put("data", new JSONObject().put("contents", new JSONObject().put("videoRenderer", video)));
        JSONObject parsed = SubscriptionRefreshDownloadMetadata.forDownloads(response, 10000000).getJSONArray("videos").getJSONObject(0);
        assertFalse(parsed.optBoolean("isUpcoming"));
        assertFalse(parsed.optBoolean("liveNow"));
        video.put("badges", new JSONArray().put(new JSONObject().put("metadataBadgeRenderer", new JSONObject().put("style", "BADGE_STYLE_TYPE_LIVE_NOW"))));
        parsed = SubscriptionRefreshDownloadMetadata.forDownloads(response, 10000000).getJSONArray("videos").getJSONObject(0);
        assertTrue(parsed.optBoolean("liveNow"));
        video.put("upcomingEventData", new JSONObject().put("startTime", "10000000"));
        parsed = SubscriptionRefreshDownloadMetadata.forDownloads(response, 10000000).getJSONArray("videos").getJSONObject(0);
        assertTrue(parsed.optBoolean("isUpcoming"));
    }

    @Test
    public void nativeTransportSupportsExplicitHttpInvidiousInstances() throws Exception {
        try (java.net.ServerSocket server = new java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            server.setSoTimeout(2000);
            Thread responder = new Thread(() -> {
                try (java.net.Socket socket = server.accept()) {
                    socket.setSoTimeout(2000);
                    java.io.BufferedReader input = new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream(), java.nio.charset.StandardCharsets.US_ASCII));
                    for (String line; (line = input.readLine()) != null && !line.isEmpty();) { }
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 13\r\nConnection: close\r\n\r\n{\"videos\":[]}".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
                } catch (IOException ignored) { }
            });
            responder.start();
            try {
                JSONObject request = new JSONObject().put("format", "invidious")
                    .put("url", "http://localhost:" + server.getLocalPort() + "/api/v1/channels/UCtest/videos");
                assertEquals(0, SubscriptionRefreshHttpClient.fetch(feed(new JSONArray().put(request)), "UCtest").getJSONArray("videos").length());
            } finally {
                server.close();
                responder.join(3000);
            }
        }
        JSONObject file = new JSONObject().put("format", "invidious").put("url", "file:///tmp/feed.json");
        assertThrows(IOException.class, () -> SubscriptionRefreshHttpClient.fetch(feed(new JSONArray().put(file)), "UCtest"));
    }

    @Test
    public void malformedLocalContentFallsBackInsteadOfSavingAnEmptySuccess() throws Exception {
        JSONArray requests = new JSONArray().put(new JSONObject().put("format", "local")).put(new JSONObject().put("format", "invidious"));
        for (String contents : List.of("{}", "42", "{\"twoColumnBrowseResultsRenderer\":{\"tabs\":[]}}")) {
            List<String> formats = new ArrayList<>();
            JSONObject result = SubscriptionRefreshHttpClient.fetch(feed(requests), "UCtest", (request, type, id) -> {
                formats.add(request.getString("format"));
                return request.getString("format").equals("local") ? "{\"contents\":" + contents + "}" : "{\"videos\":[]}";
            });
            assertEquals(List.of("local", "invidious"), formats);
            assertEquals(0, result.getJSONArray("videos").length());
        }
    }


    @Test
    public void malformedRssEntriesDoNotDiscardValidDownloadCandidates() throws Exception {
        String valid = "<entry><yt:videoId>valid</yt:videoId><title>Valid</title><published>2026-09-14T08:00:00Z</published><media:statistics views=\"42\"/></entry>";
        String missing = "<entry><media:statistics views=\"42\"/></entry>";
        String invalid = valid.replace("2026-09-14T08:00:00Z", "invalid");
        JSONObject response = new JSONObject().put("backgroundFormat", "rss").put("text", "<feed>" + missing + valid + invalid + "</feed>");
        JSONArray videos = SubscriptionRefreshDownloadMetadata.forDownloads(response, 0).getJSONArray("videos");
        assertEquals(1, videos.length());
        assertEquals("valid", videos.getJSONObject(0).getString("videoId"));
    }

    @Test
    public void nativeYearDurationMatchesTheSharedFeedParser() throws Exception {
        long now = 1800000000000L;
        JSONObject video = new JSONObject().put("videoId", "yearold")
            .put("publishedTimeText", new JSONObject().put("simpleText", "1 year ago"));
        JSONObject response = new JSONObject().put("backgroundFormat", "local")
            .put("data", new JSONObject().put("contents", new JSONObject().put("videoRenderer", video)));
        long published = SubscriptionRefreshDownloadMetadata.forDownloads(response, now).getJSONArray("videos").getJSONObject(0).getLong("published");
        assertEquals(now / 1000 - 31556952, published);
    }
}
