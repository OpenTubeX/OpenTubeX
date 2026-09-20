package org.opentubex.app;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class YtDlpDownloadProgressTest {
    @Test public void preparationAndProcessingClearStaleTransferMetrics() throws Exception {
        JSONObject record = new JSONObject().put("status", "downloading").put("percent", 97.3)
            .put("speed", "2MiB/s").put("eta", "00:00");
        YtDlpDownloads.updateProgress(record, "__OPENTUBEX_PREPARING__:aaaaaaaaaaa");
        assertEquals("preparing", record.getString("status"));
        assertEquals(0, record.getDouble("percent"), 0);
        assertTrue(record.isNull("eta"));
        assertTrue(record.isNull("speed"));
        YtDlpDownloads.updateProgress(record, "__OPENTUBEX_DOWNLOAD__:downloading\t97.3%\t2MiB/s\t00:00");
        assertEquals("downloading", record.getString("status"));
        assertEquals(97.3, record.getDouble("percent"), 0);
        YtDlpDownloads.updateProgress(record, "__OPENTUBEX_DOWNLOAD__:finished\t97.3%\t2MiB/s\t00:00");
        assertEquals("processing", record.getString("status"));
        assertTrue(record.isNull("eta"));
        assertTrue(record.isNull("speed"));
        YtDlpDownloads.updateProgress(record, "__OPENTUBEX_PROCESSING__");
        assertEquals("processing", record.getString("status"));
        YtDlpDownloads.updateProgress(record, "__OPENTUBEX_DOWNLOAD__:downloading\t0.1%\t Unknown B/s\tUnknown");
        assertEquals("downloading", record.getString("status"));
        assertTrue(record.isNull("speed"));
        assertTrue(record.isNull("eta"));
    }

    @Test public void roundedPercentageDoesNotFinishTheTransfer() throws Exception {
        JSONObject record = new JSONObject();
        YtDlpDownloads.updateProgress(record, "__OPENTUBEX_DOWNLOAD__:downloading\t100.0%\t1MiB/s\t00:00");
        assertEquals("downloading", record.getString("status"));
        YtDlpDownloads.updateProgress(record, "__OPENTUBEX_DOWNLOAD__:downloading\tUnknown %\t Unknown B/s\tUnknown");
        assertEquals(0, record.getDouble("percent"), 0);
    }

    @Test public void bridgeAcceptsPhaseReportingArguments() {
        JSONArray args = new JSONArray().put("--no-simulate").put("--print").put("video:__OPENTUBEX_PREPARING__:%(id)s")
            .put("--progress-template").put("postprocess:__OPENTUBEX_PROCESSING__");
        assertEquals(5, YtDlpArguments.validate(args).size());
    }
}
