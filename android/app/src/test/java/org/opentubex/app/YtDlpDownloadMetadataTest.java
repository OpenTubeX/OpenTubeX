package org.opentubex.app;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

public class YtDlpDownloadMetadataTest {
    @Test public void missingChannelMetadataDoesNotCreateASubscriptionToNA() throws Exception {
        JSONObject item = YtDlpDownloads.parseCompletedFile(
            "__OPENTUBEX_FILE__:video-id\t120\t1920\t1080\tnull\tnull\t\"Title\"\t/cache/video.mp4");
        assertFalse(item.has("authorId"));
        assertFalse(item.has("author"));
        assertEquals("Title", item.getString("title"));
    }

    @Test public void completedPlaylistEntryRetainsItsOwnChannelAndTitle() throws Exception {
        JSONObject item = YtDlpDownloads.parseCompletedFile(
            "__OPENTUBEX_FILE__:video-id\t120\t1920\t1080\t\"Channel \\t name\"\t\"UC-channel\"\t\"Video title\"\t/cache/video.mp4");
        assertEquals("Channel \t name", item.optString("author"));
        assertEquals("UC-channel", item.optString("authorId"));
        assertEquals("Video title", item.optString("title"));
        assertEquals("/cache/video.mp4", item.getString("path"));
        assertEquals(120, item.getDouble("duration"), 0);
    }
}
