package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import org.json.JSONObject;
import org.junit.Test;

public class SubscriptionRefreshResultStoreTest {
    private static JSONObject feed(String title, String tracking, String redirectToken, String countries) throws Exception {
        return new JSONObject("{\"backgroundFormat\":\"local\",\"data\":{"
            + "\"responseContext\":{\"visitorData\":\"" + tracking + "\"},"
            + "\"metadata\":{\"channelMetadataRenderer\":{\"title\":\"Channel\",\"availableCountryCodes\":" + countries + "}},"
            + "\"contents\":{\"items\":[{\"videoId\":\"abcdefghijk\",\"title\":{\"content\":\"" + title + "\"},"
            + "\"trackingParams\":\"" + tracking + "\",\"clickTrackingParams\":\"" + tracking + "\","
            + "\"navigationEndpoint\":{\"urlEndpoint\":{\"url\":\"https://www.youtube.com/redirect?redir_token=" + redirectToken + "\"}},"
            + "\"continuationCommand\":{\"token\":\"" + tracking + "\"}}]}}}");
    }

    @Test
    public void fingerprintIgnoresPerRequestYouTubeValues() throws Exception {
        assertEquals(
            SubscriptionRefreshResultStore.fingerprint(feed("Video", "first", "a", "[\"US\",\"DE\"]")),
            SubscriptionRefreshResultStore.fingerprint(feed("Video", "second", "b", "[\"DE\",\"US\"]"))
        );
    }

    @Test
    public void fingerprintIgnoresKeyOrder() throws Exception {
        assertEquals(
            SubscriptionRefreshResultStore.fingerprint(new JSONObject("{\"a\":1,\"b\":[\"x\",null,true]}")),
            SubscriptionRefreshResultStore.fingerprint(new JSONObject("{\"b\":[\"x\",null,true],\"a\":1}"))
        );
    }

    @Test
    public void fingerprintChangesWithFeedContent() throws Exception {
        assertNotEquals(
            SubscriptionRefreshResultStore.fingerprint(feed("Video", "same", "a", "[]")),
            SubscriptionRefreshResultStore.fingerprint(feed("Renamed video", "same", "a", "[]"))
        );
        assertNotEquals(
            SubscriptionRefreshResultStore.fingerprint(new JSONObject("{\"a\":[\"x\",\"y\"]}")),
            SubscriptionRefreshResultStore.fingerprint(new JSONObject("{\"a\":[\"y\",\"x\"]}"))
        );
        assertNotEquals(
            SubscriptionRefreshResultStore.fingerprint(new JSONObject("{\"a\":\"x\",\"b\":\"\"}")),
            SubscriptionRefreshResultStore.fingerprint(new JSONObject("{\"a\":\"\",\"b\":\"x\"}"))
        );
    }

    @Test
    public void fingerprintIgnoresUrlQueriesButNotUrlPaths() throws Exception {
        assertEquals(
            SubscriptionRefreshResultStore.fingerprint(new JSONObject("{\"url\":\"https://i.ytimg.com/vi/a/hq720.jpg?sqp=1&rs=x\"}")),
            SubscriptionRefreshResultStore.fingerprint(new JSONObject("{\"url\":\"https://i.ytimg.com/vi/a/hq720.jpg?sqp=2&rs=y\"}"))
        );
        assertNotEquals(
            SubscriptionRefreshResultStore.fingerprint(new JSONObject("{\"url\":\"https://i.ytimg.com/vi/a/oar2.jpg\"}")),
            SubscriptionRefreshResultStore.fingerprint(new JSONObject("{\"url\":\"https://i.ytimg.com/vi/a/oar3.jpg\"}"))
        );
    }
}
