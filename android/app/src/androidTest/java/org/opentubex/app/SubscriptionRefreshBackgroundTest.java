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
}
