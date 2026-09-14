package org.opentubex.app;

import java.io.StringReader;
import java.time.Instant;
import java.util.Iterator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.xml.parsers.DocumentBuilderFactory;
import org.json.JSONArray;
import org.json.JSONObject;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

/** Minimal metadata for native download rules; UI parsing remains shared with foreground feeds. */
final class SubscriptionRefreshDownloadMetadata {
    private static final Pattern AGE = Pattern.compile("(\\d+) (second|minute|hour|day|week|month|year)s? ago");

    static JSONObject forDownloads(JSONObject response, long now) throws Exception {
        String format = response.optString("backgroundFormat");
        if (format.isEmpty()) return response;
        JSONArray videos = new JSONArray();
        if (format.equals("rss")) {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            // Android's XML parser does not support every Xerces feature flag.
            // Feeds need no DTD; reject declarations before parsing any entities.
            String xml = response.getString("text");
            if (xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY")) throw new java.io.IOException("RSS declarations are not supported");
            NodeList entries = factory.newDocumentBuilder().parse(new InputSource(new StringReader(xml))).getElementsByTagName("entry");
            for (int i = 0; i < entries.getLength(); i++) {
                Element entry = (Element) entries.item(i);
                // RSS cannot distinguish zero/one-view premieres from uploaded videos.
                // Leave those to the foreground's existing watch-page enrichment.
                NodeList statistics = entry.getElementsByTagName("media:statistics");
                if (statistics.getLength() == 0) continue;
                try {
                    if (Long.parseLong(((Element) statistics.item(0)).getAttribute("views")) <= 1) continue;
                } catch (NumberFormatException invalidViews) {
                    continue;
                }
                String videoId = text(entry, "yt:videoId");
                String title = text(entry, "title");
                if (videoId.isEmpty() || title.isEmpty()) continue;
                try {
                    videos.put(new JSONObject()
                        .put("videoId", videoId)
                        .put("title", title)
                        .put("published", Instant.parse(text(entry, "published")).getEpochSecond()));
                } catch (java.time.format.DateTimeParseException invalidDate) {
                    // A malformed entry must not discard other download candidates.
                }
            }
        } else if (format.equals("local") || format.equals("localPlaylist")) {
            collect(response.getJSONObject("data").opt("contents"), videos, now);
            JSONObject continuation = response.optJSONObject("continuation");
            if (continuation != null) {
                collect(continuation.opt("onResponseReceivedActions"), videos, now);
                collect(continuation.opt("onResponseReceivedEndpoints"), videos, now);
            }
        }
        return new JSONObject().put("videos", videos);
    }

    private static String text(Element entry, String tag) {
        NodeList nodes = entry.getElementsByTagName(tag);
        return nodes.getLength() == 0 ? "" : nodes.item(0).getTextContent();
    }

    private static String label(JSONObject value) {
        if (value == null) return "";
        if (value.has("simpleText")) return value.optString("simpleText");
        if (value.has("content")) return value.optString("content");
        StringBuilder result = new StringBuilder();
        JSONArray runs = value.optJSONArray("runs");
        if (runs != null) for (int i = 0; i < runs.length(); i++) result.append(runs.optJSONObject(i).optString("text"));
        return result.toString();
    }

    private static long published(String text, long now) {
        Matcher age = AGE.matcher(text);
        if (!age.find()) return 0;
        long seconds;
        switch (age.group(2)) {
            case "second": seconds = 1; break;
            case "minute": seconds = 60; break;
            case "hour": seconds = 3600; break;
            case "day": seconds = 86400; break;
            case "week": seconds = 604800; break;
            case "month": seconds = 2592000; break;
            default: seconds = 31556952;
        }
        return now / 1000 - Long.parseLong(age.group(1)) * seconds;
    }

    private static long duration(String label) {
        if (!label.matches("\\d+(?::\\d+){1,2}")) return 0;
        long seconds = 0;
        for (String part : label.split(":")) seconds = seconds * 60 + Long.parseLong(part);
        return seconds;
    }

    private static void collectLockup(JSONObject lockup, JSONArray videos, long now) throws Exception {
        String type = lockup.optString("contentType");
        if (!type.equals("LOCKUP_CONTENT_TYPE_VIDEO") && !type.equals("LOCKUP_CONTENT_TYPE_SHORT")) return;
        JSONObject metadata = child(lockup, "metadata", "lockupMetadataViewModel");
        JSONObject video = new JSONObject()
            .put("videoId", lockup.optString("contentId"))
            .put("title", label(metadata.optJSONObject("title")))
            .put("published", 0)
            .put("lengthSeconds", 0);
        JSONArray rows = child(metadata, "metadata", "contentMetadataViewModel").optJSONArray("metadataRows");
        if (rows != null) for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            JSONArray parts = row == null ? null : row.optJSONArray("metadataParts");
            if (parts == null) continue;
            for (int j = 0; j < parts.length(); j++) {
                JSONObject part = parts.optJSONObject(j);
                String text = part == null ? "" : label(part.optJSONObject("text"));
                if (AGE.matcher(text).find()) video.put("published", published(text, now));
            }
        }
        collectBadges(lockup.opt("contentImage"), video);
        videos.put(video);
    }

    private static JSONObject child(JSONObject object, String first, String second) {
        JSONObject parent = object.optJSONObject(first);
        JSONObject result = parent == null ? null : parent.optJSONObject(second);
        return result == null ? new JSONObject() : result;
    }

    private static void collectBadges(Object node, JSONObject video) throws Exception {
        if (node instanceof JSONArray) {
            JSONArray array = (JSONArray) node;
            for (int i = 0; i < array.length(); i++) collectBadges(array.get(i), video);
        } else if (node instanceof JSONObject) {
            JSONObject object = (JSONObject) node;
            JSONObject metadataBadge = object.optJSONObject("metadataBadgeRenderer");
            if (metadataBadge != null) {
                if (metadataBadge.optString("style").equals("BADGE_STYLE_TYPE_LIVE_NOW")) video.put("liveNow", true);
                return;
            }
            JSONObject status = object.optJSONObject("thumbnailOverlayTimeStatusRenderer");
            if (status != null) {
                long seconds = duration(label(status.optJSONObject("text")));
                if (seconds > 0) video.put("lengthSeconds", seconds);
                if (status.optString("style").equals("LIVE")) video.put("liveNow", true);
                if (status.optString("style").equals("UPCOMING")) video.put("isUpcoming", true);
                return;
            }
            JSONObject badge = object.optJSONObject("thumbnailBadgeViewModel");
            if (badge != null) {
                String text = badge.optString("text");
                long seconds = duration(text);
                if (seconds > 0) video.put("lengthSeconds", seconds);
                if (text.equalsIgnoreCase("upcoming")) video.put("isUpcoming", true);
                if (text.toLowerCase(java.util.Locale.ROOT).contains("premiere")) video.put("premiere", true);
                if (badge.optString("badgeStyle").equals("THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE") || badge.optString("iconName").equals("LIVE")) video.put("liveNow", true);
                return;
            }
            for (Iterator<String> keys = object.keys(); keys.hasNext();) collectBadges(object.get(keys.next()), video);
        }
    }

    private static void collect(Object node, JSONArray videos, long now) throws Exception {
        if (node instanceof JSONArray) {
            JSONArray array = (JSONArray) node;
            for (int i = 0; i < array.length(); i++) collect(array.get(i), videos, now);
        } else if (node instanceof JSONObject) {
            JSONObject object = (JSONObject) node;
            JSONObject lockup = object.optJSONObject("lockupViewModel");
            if (lockup != null) {
                collectLockup(lockup, videos, now);
                return;
            }
            JSONObject video = object.optJSONObject("videoRenderer");
            if (video == null) video = object.optJSONObject("gridVideoRenderer");
            if (video == null) video = object.optJSONObject("playlistVideoRenderer");
            if (video != null) {
                JSONObject parsed = new JSONObject()
                    .put("videoId", video.optString("videoId"))
                    .put("title", label(video.optJSONObject("title")))
                    .put("published", published(label(video.optJSONObject("publishedTimeText")), now))
                    .put("lengthSeconds", duration(label(video.optJSONObject("lengthText"))))
                    .put("isUpcoming", video.optJSONObject("upcomingEventData") != null)
                    .put("liveNow", false);
                collectBadges(video.opt("badges"), parsed);
                collectBadges(video.opt("thumbnailOverlays"), parsed);
                videos.put(parsed);
                return;
            }
            for (Iterator<String> keys = object.keys(); keys.hasNext();) collect(object.get(keys.next()), videos, now);
        }
    }
}
