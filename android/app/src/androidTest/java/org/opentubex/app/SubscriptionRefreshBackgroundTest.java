package org.opentubex.app;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class SubscriptionRefreshBackgroundTest {
    @Test
    public void missingShortsTabIsSavedAsAnEmptySuccess() throws Exception {
        String channelId = "UCtest";
        String profileId = "background-test-" + UUID.randomUUID();
        SubscriptionRefreshConfiguration.Feed feed = new SubscriptionRefreshConfiguration.Feed(
            profileId, "shorts", 1800000, List.of(channelId), "", null, "Refresh test", "Cancel"
        );
        AtomicReference<Throwable> serverError = new AtomicReference<>();
        java.net.ProxySelector original = java.net.ProxySelector.getDefault();
        try (ServerSocket server = new ServerSocket(0, 2, java.net.InetAddress.getByName("127.0.0.1"))) {
            // The app proxy deliberately rejects loopback; reach only this test server directly.
            java.net.ProxySelector.setDefault(new java.net.ProxySelector() {
                @Override public List<java.net.Proxy> select(java.net.URI uri) {
                    return "127.0.0.1".equals(uri.getHost()) ? List.of(java.net.Proxy.NO_PROXY) : original.select(uri);
                }
                @Override public void connectFailed(java.net.URI uri, java.net.SocketAddress address, java.io.IOException error) {
                    original.connectFailed(uri, address, error);
                }
            });
            server.setSoTimeout(5000);
            Thread responder = new Thread(() -> {
                try {
                    for (int index = 0; index < 2; index++) {
                        try (Socket socket = server.accept()) {
                            socket.setSoTimeout(5000);
                            java.io.BufferedReader input = new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                            int length = 0;
                            for (String line; (line = input.readLine()) != null && !line.isEmpty();) {
                                if (line.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
                            }
                            char[] body = new char[length];
                            for (int read = 0; read < length;) {
                                int count = input.read(body, read, length - read);
                                if (count < 0) throw new java.io.EOFException();
                                read += count;
                            }
                            JSONObject request = new JSONObject(new String(body));
                            assertEquals(channelId, request.getString("browseId"));
                            assertEquals(index == 0, request.has("params"));
                            String response = index == 0 ? "{}" : "{\"metadata\":{\"channelMetadataRenderer\":{\"externalId\":\"UCtest\"}},\"contents\":{\"twoColumnBrowseResultsRenderer\":{\"tabs\":[{\"tabRenderer\":{\"selected\":true,\"content\":{},\"endpoint\":{\"commandMetadata\":{\"webCommandMetadata\":{\"url\":\"/@channel/videos\"}}}}}]}}}";
                            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
                            String headers = "HTTP/1.1 " + (index == 0 ? "404 Not Found" : "200 OK") + "\r\nContent-Type: application/json\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n";
                            socket.getOutputStream().write(headers.getBytes(StandardCharsets.US_ASCII));
                            socket.getOutputStream().write(bytes);
                        }
                    }
                } catch (Throwable error) { serverError.set(error); }
            });
            responder.start();
            feed.requests = new JSONArray().put(new JSONObject().put("format", "local")
                .put("url", "http://127.0.0.1:" + server.getLocalPort() + "/browse")
                .put("body", "{\"browseId\":\"%CHANNEL%\",\"params\":\"shorts\"}"));
            try {
                JSONObject payload = SubscriptionRefreshHttpClient.fetch(feed, channelId);
                assertEquals(0, payload.getJSONArray("videos").length());
                Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
                String slot = profileId + "\nshorts\n" + channelId;
                File resultFile = new File(new File(context.getFilesDir(), "subscription-refresh-results"), UUID.nameUUIDFromBytes(slot.getBytes(StandardCharsets.UTF_8)) + ".json");
                try {
                    SubscriptionRefreshResultStore.writeChannel(context, profileId, "shorts", channelId, payload, System.currentTimeMillis());
                    JSONObject saved = new JSONObject(new String(Files.readAllBytes(resultFile.toPath()), StandardCharsets.UTF_8));
                    assertEquals(0, saved.getJSONObject("payload").getJSONArray("videos").length());
                    assertTrue(SubscriptionRefreshResultStore.acknowledge(context, saved.getString("id")));
                } finally { resultFile.delete(); }
            } finally {
                server.close();
                responder.join(6000);
            }
            assertNull(serverError.get());
            assertFalse(responder.isAlive());
        } finally {
            java.net.ProxySelector.setDefault(original);
        }
    }

    @Test
    public void nativeLocalRefreshFetchesAndPersistsWithoutAnActivity() throws Exception {
        // Opt in explicitly: normal instrumentation runs never depend on YouTube.
        assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("backgroundRefreshNetworkProbe")));
        assertFalse(AppVisibility.isVisible());
        String clientVersion = InstrumentationRegistry.getArguments().getString("localClientVersion");
        assertNotNull(clientVersion);
        String channelId = "UCSMOQeBJ2RAnuFungnQOxLg";
        String profileId = "background-test-" + UUID.randomUUID();
        SubscriptionRefreshConfiguration.Feed feed = new SubscriptionRefreshConfiguration.Feed(
            profileId, "videos", 1800000, List.of(channelId), "", null, "Refresh test", "Cancel"
        );
        JSONObject client = new JSONObject().put("clientName", "WEB").put("clientVersion", clientVersion).put("hl", "en").put("gl", "US");
        JSONObject body = new JSONObject().put("context", new JSONObject().put("client", client)).put("browseId", channelId).put("params", "EgZ2aWRlb3PyBgQKAjoA");
        feed.requests = new JSONArray().put(new JSONObject().put("format", "local")
            .put("url", "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false").put("body", body.toString()));
        JSONObject payload = SubscriptionRefreshHttpClient.fetch(feed, channelId);
        assertEquals("local", payload.getString("backgroundFormat"));
        assertTrue(payload.getJSONObject("data").has("contents"));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String slot = profileId + "\nvideos\n" + channelId;
        File resultFile = new File(new File(context.getFilesDir(), "subscription-refresh-results"), UUID.nameUUIDFromBytes(slot.getBytes(StandardCharsets.UTF_8)) + ".json");
        try {
            SubscriptionRefreshResultStore.writeChannel(context, profileId, "videos", channelId, payload, System.currentTimeMillis());
            JSONObject saved = new JSONObject(new String(Files.readAllBytes(resultFile.toPath()), StandardCharsets.UTF_8));
            assertEquals(profileId, saved.getString("profileId"));
            assertEquals("local", saved.getJSONObject("payload").getString("backgroundFormat"));
            assertTrue(SubscriptionRefreshResultStore.acknowledge(context, saved.getString("id")));
            assertFalse(resultFile.exists());
        } finally { resultFile.delete(); }
    }

    @Test
    public void nativeLocalShortsRefreshFindsUploadsToNotifyAbout() throws Exception {
        assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("backgroundRefreshNetworkProbe")));
        String clientVersion = InstrumentationRegistry.getArguments().getString("localClientVersion");
        assertNotNull(clientVersion);
        String channelId = "UCSMOQeBJ2RAnuFungnQOxLg";
        SubscriptionRefreshConfiguration.Feed feed = new SubscriptionRefreshConfiguration.Feed(
            "background-test-" + UUID.randomUUID(), "shorts", 1800000, List.of(channelId), "", null, "Refresh test", "Cancel"
        );
        JSONObject client = new JSONObject().put("clientName", "WEB").put("clientVersion", clientVersion).put("hl", "en").put("gl", "US");
        JSONObject body = new JSONObject().put("context", new JSONObject().put("client", client)).put("browseId", channelId).put("params", "EgZzaG9ydHPyBgUKA5oBAA%3D%3D");
        feed.requests = new JSONArray().put(new JSONObject().put("format", "local")
            .put("url", "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false").put("body", body.toString()));

        JSONArray entries = UploadNotifications.entries("shorts", SubscriptionRefreshHttpClient.fetch(feed, channelId), System.currentTimeMillis());
        assertTrue(entries.length() > 0);
        assertFalse(entries.getJSONObject(0).getString("id").isEmpty());
        assertFalse(entries.getJSONObject(0).getString("title").isEmpty());
    }

    @Test
    public void scheduledRefreshFetchesChannelsConcurrentlyAndSharesThemAcrossProfiles() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertFalse(AppVisibility.isVisible());
        List<String> channelIds = List.of("UCa", "UCb", "UCc", "UCd", "UCe", "UCf", "UCg", "UCh");
        String allProfile = "background-test-all-" + UUID.randomUUID();
        String customProfile = "background-test-custom-" + UUID.randomUUID();
        java.util.Map<String, Integer> requests = new java.util.concurrent.ConcurrentHashMap<>();
        java.util.concurrent.atomic.AtomicInteger running = new java.util.concurrent.atomic.AtomicInteger();
        java.util.concurrent.atomic.AtomicInteger mostRunning = new java.util.concurrent.atomic.AtomicInteger();
        android.content.SharedPreferences preferences = context.getSharedPreferences("subscription-refresh", Context.MODE_PRIVATE);
        String savedConfiguration = preferences.getString("configuration", null);
        File results = new File(context.getFilesDir(), "subscription-refresh-results");
        java.net.ProxySelector original = java.net.ProxySelector.getDefault();
        try (ServerSocket server = new ServerSocket(0, 16, java.net.InetAddress.getByName("127.0.0.1"))) {
            java.net.ProxySelector.setDefault(new java.net.ProxySelector() {
                @Override public List<java.net.Proxy> select(java.net.URI uri) {
                    return "127.0.0.1".equals(uri.getHost()) ? List.of(java.net.Proxy.NO_PROXY) : original.select(uri);
                }
                @Override public void connectFailed(java.net.URI uri, java.net.SocketAddress address, java.io.IOException error) {
                    original.connectFailed(uri, address, error);
                }
            });
            Thread acceptor = new Thread(() -> {
                while (!server.isClosed()) {
                    Socket socket;
                    try { socket = server.accept(); } catch (java.io.IOException closed) { return; }
                    new Thread(() -> {
                        try (Socket connection = socket) {
                            mostRunning.accumulateAndGet(running.incrementAndGet(), Math::max);
                            java.io.BufferedReader input = new java.io.BufferedReader(new java.io.InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
                            String requestLine = input.readLine();
                            for (String line; (line = input.readLine()) != null && !line.isEmpty();) {}
                            requests.merge(requestLine.split(" ")[1].replace("/feed/", ""), 1, Integer::sum);
                            Thread.sleep(300);
                            byte[] body = "<feed xmlns=\"http://www.w3.org/2005/Atom\"></feed>".getBytes(StandardCharsets.UTF_8);
                            running.decrementAndGet();
                            connection.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: application/atom+xml\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                            connection.getOutputStream().write(body);
                        } catch (Exception ignored) {
                            // The refresh records a failed request itself.
                        }
                    }).start();
                }
            });
            acceptor.start();
            JSONObject configuration = new JSONObject()
                .put("intervals", new JSONObject().put("videos", 1800000))
                .put("requests", new JSONObject().put("videos", new JSONArray().put(new JSONObject()
                    .put("format", "rss").put("url", "http://127.0.0.1:" + server.getLocalPort() + "/feed/%CHANNEL%"))))
                .put("profiles", new JSONArray()
                    .put(new JSONObject().put("id", allProfile).put("channels", new JSONObject().put("videos", new JSONArray(channelIds))))
                    .put(new JSONObject().put("id", customProfile).put("channels", new JSONObject().put("videos", new JSONArray(channelIds.subList(0, 3))))));
            SubscriptionRefreshConfiguration.save(context, configuration);

            androidx.work.OneTimeWorkRequest request = new androidx.work.OneTimeWorkRequest.Builder(SubscriptionRefreshWorker.class)
                .setInputData(new androidx.work.Data.Builder().putString(SubscriptionRefreshWorker.FEED_TYPE_INPUT, "videos").build())
                .build();
            androidx.work.WorkManager workManager = androidx.work.WorkManager.getInstance(context);
            workManager.enqueue(request).getResult().get();
            long deadline = android.os.SystemClock.elapsedRealtime() + 30000;
            androidx.work.WorkInfo info;
            while (!(info = workManager.getWorkInfoById(request.getId()).get()).getState().isFinished()) {
                assertTrue("the refresh finishes", android.os.SystemClock.elapsedRealtime() < deadline);
                Thread.sleep(100);
            }
            assertEquals(androidx.work.WorkInfo.State.SUCCEEDED, info.getState());

            for (String channelId : channelIds) assertEquals("each channel is fetched once", Integer.valueOf(1), requests.get(channelId));
            assertTrue("channels are fetched in parallel, at most four at a time", mostRunning.get() > 1 && mostRunning.get() <= 4);
            for (String channelId : channelIds.subList(0, 3)) {
                JSONObject all = savedResult(results, allProfile + "\nvideos\n" + channelId);
                JSONObject custom = savedResult(results, customProfile + "\nvideos\n" + channelId);
                assertEquals("profiles share one fetch time", all.getLong("timestamp"), custom.getLong("timestamp"));
                assertEquals("rss", custom.getJSONObject("payload").getString("backgroundFormat"));
                assertEquals("the index reads the ID from the start of a result", custom.getString("id"),
                    SubscriptionRefreshResultStore.readId(new File(results, slotName(customProfile + "\nvideos\n" + channelId) + ".json")));
            }
            assertEquals("completion", savedResult(results, allProfile + "\nvideos\ncompletion").getString("kind"));
            assertEquals("completion", savedResult(results, customProfile + "\nvideos\ncompletion").getString("kind"));
        } finally {
            java.net.ProxySelector.setDefault(original);
            if (savedConfiguration == null) preferences.edit().remove("configuration").commit();
            else preferences.edit().putString("configuration", savedConfiguration).commit();
            for (String profileId : List.of(allProfile, customProfile)) {
                for (String slot : new String[] { "completion", "failure", "UCa", "UCb", "UCc", "UCd", "UCe", "UCf", "UCg", "UCh" }) {
                    File file = new File(results, slotName(profileId + "\nvideos\n" + slot) + ".json");
                    if (file.exists()) SubscriptionRefreshResultStore.acknowledge(context, SubscriptionRefreshResultStore.readId(file));
                    new File(results, slotName(profileId + "\nvideos\n" + slot) + ".fingerprint").delete();
                }
            }
        }
    }

    @Test
    public void aFailedChannelGetsItsNextUnchangedFeedImported() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File results = new File(context.getFilesDir(), "subscription-refresh-results");
        String profileId = "background-test-" + UUID.randomUUID();
        String slot = profileId + "\nvideos\nUCtest";
        File feed = new File(results, slotName(slot) + ".json");
        File failure = new File(results, slotName(slot + "\nfailure") + ".json");
        JSONObject payload = new JSONObject().put("videos", new JSONArray());
        try {
            SubscriptionRefreshResultStore.writeChannel(context, profileId, "videos", "UCtest", payload, 1);
            assertTrue(SubscriptionRefreshResultStore.acknowledge(context, SubscriptionRefreshResultStore.readId(feed)));
            SubscriptionRefreshResultStore.writeChannelFailure(context, profileId, "videos", "UCtest",
                SubscriptionRefreshRequestDiagnostic.create("videos", "Subscription backend", new java.io.IOException("HTTP 500")), true, 2);
            SubscriptionRefreshResultStore.writeChannel(context, profileId, "videos", "UCtest", payload, 3);
            assertTrue("the unchanged feed is saved again, so that the app stops listing the channel", feed.exists());
            JSONObject saved = savedResult(results, slot + "\nfailure");
            assertEquals("the failure does not replace the feed", "channelFailure", saved.getString("kind"));
            assertEquals("UCtest", saved.getString("channelId"));
            assertTrue(saved.getBoolean("unavailable"));
            assertEquals("HTTP 500", saved.getJSONObject("diagnostic").getString("message"));
        } finally {
            for (File file : new File[] { feed, failure }) {
                if (file.exists()) SubscriptionRefreshResultStore.acknowledge(context, SubscriptionRefreshResultStore.readId(file));
            }
            new File(results, slotName(slot) + ".fingerprint").delete();
        }
    }

    private static String slotName(String slot) {
        return UUID.nameUUIDFromBytes(slot.getBytes(StandardCharsets.UTF_8)).toString();
    }

    private static JSONObject savedResult(File results, String slot) throws Exception {
        return new JSONObject(new String(Files.readAllBytes(new File(results, slotName(slot) + ".json").toPath()), StandardCharsets.UTF_8));
    }
}
