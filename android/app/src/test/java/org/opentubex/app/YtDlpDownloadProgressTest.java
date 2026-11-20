package org.opentubex.app;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.util.Arrays;
import java.util.List;
import static org.junit.Assert.*;

public class YtDlpDownloadProgressTest {
    @Test public void preparationAndProcessingClearStaleTransferMetrics() throws Exception {
        JSONObject record = new JSONObject().put("status", "downloading").put("percent", 97.3)
            .put("speed", "2MiB/s").put("eta", "00:00");
        YtDlpDownloads.updateProgress(record, "__OPENTUBEX_PREPARING__:aaaaaaaaaaa\t3\t12\t\"Caf\\u00e9\\tvideo\"");
        assertEquals("aaaaaaaaaaa", record.getString("currentVideoId"));
        assertEquals("Caf\u00e9\tvideo", record.getString("currentTitle"));
        assertEquals(3, record.getInt("playlistIndex"));
        assertEquals(12, record.getInt("playlistCount"));
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

    @Test public void liveRecordingsShowTheLengthAndSizeThatFfmpegReports() throws Exception {
        JSONObject part = new JSONObject().put("status", "preparing").put("percent", 0);
        YtDlpDownloads.updateProgress(part, "__OPENTUBEX_LIVE__:True");
        for (String line : Arrays.asList("total_size=N/A", "out_time_us=N/A", "progress=continue", "total_size=10485760",
            "out_time_us=9648333", "out_time=00:00:09.648333", "speed=1.01x", "progress=continue")) {
            YtDlpDownloads.updateProgress(part, line);
        }
        assertEquals("downloading", part.getString("status"));
        assertEquals(9.648333, part.getDouble("recordedSeconds"), 0);
        assertEquals(10485760, part.getLong("recordedBytes"));
        JSONObject record = new JSONObject();
        YtDlpDownloads.showProgress(record, Arrays.asList(part), null);
        assertTrue(record.getBoolean("live"));
        assertEquals(10485760, record.getLong("recordedBytes"));

        // FFmpeg reports once more while it finishes a stopped recording
        part.put("stopping", true).put("status", "processing");
        YtDlpDownloads.updateProgress(part, "progress=continue");
        assertEquals("processing", part.getString("status"));

        // A live video earlier in a playlist must not mark the next one as live
        YtDlpDownloads.updateProgress(part, "__OPENTUBEX_PREPARING__:bbbbbbbbbbb\t2\t2\t\"Video\"");
        assertFalse(part.getBoolean("live"));
        assertFalse(part.has("recordedSeconds"));
        assertFalse(part.has("stopping"));
        YtDlpDownloads.updateProgress(part, "__OPENTUBEX_LIVE__:False");
        YtDlpDownloads.updateProgress(part, "progress=continue");
        assertEquals("preparing", part.getString("status"));

        // Parts of a split playlist keep their own live state, and the row shows the recording
        // even after an earlier video, so it cannot be paused
        JSONObject live = new JSONObject().put("status", "preparing").put("percent", 0);
        YtDlpDownloads.updateProgress(live, "__OPENTUBEX_PREPARING__:ccccccccccc\t3\t3\t\"Live stream\"");
        YtDlpDownloads.updateProgress(live, "__OPENTUBEX_LIVE__:True");
        YtDlpDownloads.updateProgress(live, "out_time_us=5000000");
        YtDlpDownloads.updateProgress(live, "progress=continue");
        JSONObject combined = new JSONObject();
        YtDlpDownloads.showProgress(combined, Arrays.asList(live, part), null);
        assertTrue(combined.getBoolean("live"));
        assertEquals(3, combined.getInt("playlistIndex"));
        assertEquals(5, combined.getDouble("recordedSeconds"), 0);

        // An ended stream that is processing doesn't hide the stop button of one still recording
        JSONObject ended = new JSONObject().put("status", "preparing").put("percent", 0);
        YtDlpDownloads.updateProgress(ended, "__OPENTUBEX_PREPARING__:ddddddddddd\t1\t3\t\"Ended stream\"");
        YtDlpDownloads.updateProgress(ended, "__OPENTUBEX_LIVE__:True");
        YtDlpDownloads.updateProgress(ended, "__OPENTUBEX_PROCESSING__");
        YtDlpDownloads.showProgress(combined, Arrays.asList(ended, part, live), null);
        assertEquals("downloading", combined.getString("status"));
        assertEquals(3, combined.getInt("playlistIndex"));
    }

    @Test public void roundedPercentageDoesNotFinishTheTransfer() throws Exception {
        JSONObject record = new JSONObject();
        YtDlpDownloads.updateProgress(record, "__OPENTUBEX_DOWNLOAD__:downloading\t100.0%\t1MiB/s\t00:00");
        assertEquals("downloading", record.getString("status"));
        YtDlpDownloads.updateProgress(record, "__OPENTUBEX_DOWNLOAD__:downloading\tUnknown %\t Unknown B/s\tUnknown");
        assertEquals(0, record.getDouble("percent"), 0);
    }

    @Test public void bridgeAcceptsPhaseReportingArguments() {
        JSONArray args = new JSONArray().put("--no-simulate").put("--print").put("video:__OPENTUBEX_PREPARING__:%(id)s\t%(playlist_index|)s\t%(playlist_count,n_entries|)s\t%(title)j")
            .put("--progress-template").put("postprocess:__OPENTUBEX_PROCESSING__");
        assertEquals(5, YtDlpArguments.validate(args).size());
    }

    @Test public void splitPlaylistsShowTheEarliestVideoWithTheCombinedSpeed() throws Exception {
        List<String> remoteArgs = Arrays.asList("--no-playlist", "https://www.youtube.com/playlist?list=PL1234567890");
        JSONObject remote = new JSONObject().put("isPlaylist", true);
        assertEquals(Arrays.asList(
            Arrays.asList("--no-playlist", "--playlist-items", "1::2", "https://www.youtube.com/playlist?list=PL1234567890"),
            Arrays.asList("--no-playlist", "--playlist-items", "2::2", "https://www.youtube.com/playlist?list=PL1234567890")
        ), YtDlpDownloads.splitArguments(remoteArgs, remote, 2));
        JSONArray videoIds = new JSONArray().put("aaaaaaaaaaa").put("bbbbbbbbbbb").put("ccccccccccc");
        List<String> localArgs = Arrays.asList("-S", "res:720", "https://www.youtube.com/watch?v=aaaaaaaaaaa",
            "https://www.youtube.com/watch?v=bbbbbbbbbbb", "https://www.youtube.com/watch?v=ccccccccccc");
        JSONObject local = new JSONObject().put("isPlaylist", true).put("videoIds", videoIds);
        assertEquals(Arrays.asList(
            Arrays.asList("-S", "res:720", "--autonumber-start", "1", "https://www.youtube.com/watch?v=aaaaaaaaaaa"),
            Arrays.asList("-S", "res:720", "--autonumber-start", "2", "https://www.youtube.com/watch?v=bbbbbbbbbbb", "https://www.youtube.com/watch?v=ccccccccccc")
        ), YtDlpDownloads.splitArguments(localArgs, local, 2));
        assertEquals(Arrays.asList(localArgs), YtDlpDownloads.splitArguments(localArgs, new JSONObject(), 3));

        JSONObject first = new JSONObject();
        JSONObject second = new JSONObject();
        YtDlpDownloads.updateProgress(first, "__OPENTUBEX_PREPARING__:ccccccccccc\t\t\t\"Third\"");
        YtDlpDownloads.updateProgress(first, "__OPENTUBEX_DOWNLOAD__:downloading\t40.0%\t  1.50MiB/s\t00:10");
        YtDlpDownloads.updateProgress(second, "__OPENTUBEX_PREPARING__:bbbbbbbbbbb\t\t\t\"Second\"");
        YtDlpDownloads.updateProgress(second, "__OPENTUBEX_DOWNLOAD__:downloading\t20.0%\t512.00KiB/s\t00:30");
        JSONObject record = new JSONObject();
        YtDlpDownloads.showProgress(record, Arrays.asList(first, second), videoIds);
        assertEquals("bbbbbbbbbbb", record.getString("currentVideoId"));
        assertEquals(20, record.getDouble("percent"), 0);
        assertEquals("00:30", record.getString("eta"));
        assertEquals("2.00MiB/s", record.getString("speed"));
        second.put("done", true);
        YtDlpDownloads.showProgress(record, Arrays.asList(first, second), videoIds);
        assertEquals("Third", record.getString("currentTitle"));
        assertEquals("1.50MiB/s", record.getString("speed"));
    }
}
