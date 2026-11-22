package org.opentubex.app;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Predicate;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** File-provider work on detached snapshots, separate from current queue state. */
final class YtDlpDownloadAvailability {
    private YtDlpDownloadAvailability() {}

    static Map<String, Boolean> inspect(JSONArray records, Predicate<String> exists) throws JSONException {
        Map<String, Boolean> availability = new HashMap<>();
        for (int index = 0; index < records.length(); index++) {
            JSONObject record = records.getJSONObject(index);
            JSONArray destinations = record.getJSONArray("destinations");
            for (int i = 0; i < destinations.length(); i++) {
                availability.computeIfAbsent(destinations.getString(i), exists::test);
            }
            JSONArray files = record.getJSONArray("files");
            for (int i = 0; i < files.length(); i++) {
                availability.computeIfAbsent(files.getJSONObject(i).getString("path"), exists::test);
            }
        }
        return availability;
    }

    static void annotate(JSONArray records, Map<String, Boolean> availability) throws JSONException {
        for (int index = 0; index < records.length(); index++) {
            JSONObject record = records.getJSONObject(index);
            JSONArray destinations = record.getJSONArray("destinations");
            int available = 0;
            boolean allChecked = true;
            for (int i = 0; i < destinations.length(); i++) {
                Boolean present = availability.get(destinations.getString(i));
                if (present == null) allChecked = false;
                else if (present) available++;
            }
            // A new export may have arrived during inspection. Keep its fresh
            // status and file metadata; do not invent availability for unseen URIs.
            if (allChecked) {
                record.put("availableDestinationCount", available).put("destinationCount", destinations.length());
                record.put("availability", available == 0 ? "missing" : available == destinations.length() ? "available" : "partial");
            }
            JSONArray files = record.getJSONArray("files");
            for (int i = 0; i < files.length(); i++) {
                JSONObject item = files.getJSONObject(i);
                Boolean present = availability.get(item.getString("path"));
                if (present != null) item.put("available", present);
            }
        }
    }
}
