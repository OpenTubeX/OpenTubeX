package org.opentubex.app;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class SubscriptionRefreshBackgroundTest {
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
}
