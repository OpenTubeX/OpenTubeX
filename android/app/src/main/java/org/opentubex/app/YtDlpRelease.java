package org.opentubex.app;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;

final class YtDlpRelease {
    private YtDlpRelease() {}

    /**
     * Reads the tag from the {@code releases/latest} redirect, which unlike GitHub's
     * REST API has no 60 requests per hour limit for unauthenticated clients.
     */
    static String latestTag(String origin, String repository) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(origin + "/" + repository + "/releases/latest").openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("HEAD");
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(15_000);
        try {
            int status = connection.getResponseCode();
            String location = connection.getHeaderField("Location");
            String prefix = origin + "/" + repository + "/releases/tag/";
            String tag = location != null && location.startsWith(prefix) ? location.substring(prefix.length()) : "";
            if (status / 100 != 3 || !tag.matches("[\\w.-]+")) throw new IOException("Could not find the latest " + repository + " release");
            return tag;
        } finally { connection.disconnect(); }
    }

    /** Compares yt-dlp's numeric, dot-separated release versions. */
    static int compare(String left, String right) {
        String[] a = left.split("\\."), b = right.split("\\.");
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            int result = Long.compare(i < a.length ? Long.parseLong(a[i]) : 0, i < b.length ? Long.parseLong(b[i]) : 0);
            if (result != 0) return result;
        }
        return 0;
    }
}
