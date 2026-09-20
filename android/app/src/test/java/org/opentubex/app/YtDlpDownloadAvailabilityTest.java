package org.opentubex.app;

import static org.junit.Assert.*;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class YtDlpDownloadAvailabilityTest {
    @Test public void eachPathIsCheckedOnceAndMissingFilesAreRecheckedOnRefresh() throws Exception {
        JSONObject record = new JSONObject()
            .put("destinations", new JSONArray().put("present").put("missing"))
            .put("files", new JSONArray().put(new JSONObject().put("path", "present"))
                .put(new JSONObject().put("path", "missing")));
        JSONArray records = new JSONArray().put(record).put(new JSONObject(record.toString()));
        Map<String, Integer> calls = new HashMap<>();
        Map<String, Boolean> availability = YtDlpDownloadAvailability.inspect(records, path -> {
            calls.merge(path, 1, Integer::sum);
            return path.equals("present");
        });
        YtDlpDownloadAvailability.annotate(records, availability);
        assertEquals(Integer.valueOf(1), calls.get("present"));
        assertEquals(Integer.valueOf(1), calls.get("missing"));
        assertEquals("partial", record.getString("availability"));
        assertEquals(1, record.getInt("availableDestinationCount"));
        assertFalse(record.getJSONArray("files").getJSONObject(1).getBoolean("available"));
        YtDlpDownloadAvailability.annotate(records, YtDlpDownloadAvailability.inspect(records, path -> true));
        assertEquals("available", record.getString("availability"));
        assertTrue(record.getJSONArray("files").getJSONObject(1).getBoolean("available"));
    }

    @Test public void newExportsKeepTheirMetadataUntilTheyHaveBeenInspected() throws Exception {
        JSONObject record = new JSONObject().put("status", "completed")
            .put("destinations", new JSONArray().put("new-file"))
            .put("files", new JSONArray().put(new JSONObject().put("path", "new-file").put("available", true)));
        YtDlpDownloadAvailability.annotate(new JSONArray().put(record), new HashMap<>());
        assertEquals("completed", record.getString("status"));
        assertFalse(record.has("availability"));
        assertTrue(record.getJSONArray("files").getJSONObject(0).getBoolean("available"));
    }
}
