package org.opentubex.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.icu.text.DateFormat;
import android.icu.text.MeasureFormat;
import android.icu.util.Measure;
import android.icu.util.MeasureUnit;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.URL;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Home screen widgets. The app stores Continue watching, recent downloads,
 * watch time and thumbnails; widgets only render that cache and never make
 * network requests.
 */
final class HomeWidgets {
    static final int MAX_VIDEOS = 4;
    static final int MAX_QUICK_ACCESS_PAGES = 4;
    static final int WATCH_TIME_DAYS = 7;
    private static final String PREFERENCES = "home_widgets";
    private static final String CONTINUE_WATCHING = "continue_watching";
    private static final String DOWNLOADS = "downloads";
    private static final String WATCH_TIME = "watch_time";
    private static final String QUICK_ACCESS = "quick_access_";
    private static final Pattern DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private static final Pattern VIDEO_ID = Pattern.compile("[\\w-]{11}");
    private static final int THUMBNAIL_WIDTH = 320;
    private static final int THUMBNAIL_HEIGHT = 180;
    private static final Object LOCK = new Object();
    private static OkHttpClient client;

    private HomeWidgets() {}

    record Video(String id, String title, String author, int progress, int length, String thumbnail) {
        JSONObject toJson() throws JSONException {
            return new JSONObject().put("videoId", id).put("title", title).put("author", author)
                .put("watchProgress", progress).put("lengthSeconds", length).put("thumbnail", thumbnail);
        }

        static Video fromJson(JSONObject json) {
            String id = json.optString("videoId");
            String thumbnail = json.optString("thumbnail");
            if (!VIDEO_ID.matcher(id).matches()) return null;
            return new Video(id, json.optString("title"), json.optString("author"),
                Math.max(0, json.optInt("watchProgress")), Math.max(0, json.optInt("lengthSeconds")),
                isThumbnailUrl(thumbnail) ? thumbnail : "");
        }
    }

    static List<Video> parse(JSONArray array) {
        List<Video> videos = new ArrayList<>();
        for (int index = 0; array != null && index < array.length() && videos.size() < MAX_VIDEOS; index++) {
            JSONObject json = array.optJSONObject(index);
            Video video = json == null ? null : Video.fromJson(json);
            if (video != null) videos.add(video);
        }
        return videos;
    }

    static List<Video> continueWatching(Context context) {
        String stored = preferences(context).getString(CONTINUE_WATCHING, "[]");
        try {
            return parse(new JSONArray(stored));
        } catch (JSONException ignored) {
            return List.of();
        }
    }

    /** A download that plays offline. Thumbnails are named after the download, not a video. */
    record Download(long id, String title, String author, String thumbnail) {
        JSONObject toJson() throws JSONException {
            return new JSONObject().put("id", id).put("title", title).put("author", author).put("thumbnail", thumbnail);
        }

        static Download fromJson(JSONObject json) {
            long id = json.optLong("id", -1);
            String thumbnail = json.optString("thumbnail");
            if (id < 0) return null;
            return new Download(id, json.optString("title"), json.optString("author"), isThumbnailUrl(thumbnail) ? thumbnail : "");
        }
    }

    static List<Download> parseDownloads(JSONArray array) {
        List<Download> downloads = new ArrayList<>();
        for (int index = 0; array != null && index < array.length() && downloads.size() < MAX_VIDEOS; index++) {
            JSONObject json = array.optJSONObject(index);
            Download download = json == null ? null : Download.fromJson(json);
            if (download != null) downloads.add(download);
        }
        return downloads;
    }

    static List<Download> downloads(Context context) {
        try {
            return parseDownloads(new JSONArray(preferences(context).getString(DOWNLOADS, "[]")));
        } catch (JSONException ignored) {
            return List.of();
        }
    }

    /** Watched seconds by local date (`yyyy-MM-dd`); invalid entries are dropped. */
    static Map<String, Long> parseWatchTime(JSONObject days) {
        Map<String, Long> parsed = new HashMap<>();
        if (days == null) return parsed;
        for (java.util.Iterator<String> keys = days.keys(); keys.hasNext() && parsed.size() < WATCH_TIME_DAYS;) {
            String date = keys.next();
            long seconds = days.optLong(date);
            if (DATE.matcher(date).matches() && seconds > 0) parsed.put(date, seconds);
        }
        return parsed;
    }

    static Map<String, Long> watchTime(Context context) {
        try {
            return parseWatchTime(new JSONObject(preferences(context).getString(WATCH_TIME, "{}")));
        } catch (JSONException ignored) {
            return Map.of();
        }
    }

    static void setWatchTime(Context context, Map<String, Long> days) {
        synchronized (LOCK) {
            preferences(context).edit().putString(WATCH_TIME, new JSONObject(days).toString()).commit();
            update(context, WatchTimeWidgetProvider.class);
        }
    }

    /** Credentials for an Invidious instance, sent only to that instance's origin. */
    record Authorization(HttpUrl origin, String value) {
        static Authorization fromJson(JSONObject json) {
            HttpUrl origin = json == null ? null : HttpUrl.parse(json.optString("url"));
            String value = json == null ? "" : json.optString("value");
            return origin == null || value.isEmpty() ? null : new Authorization(origin, value);
        }

        boolean appliesTo(HttpUrl url) {
            return url.scheme().equals(origin.scheme()) && url.host().equals(origin.host()) && url.port() == origin.port();
        }
    }

    /** Stores the list, shows it at once, then adds missing thumbnails. Call off the main thread. */
    static void setContinueWatching(Context context, List<Video> videos, Authorization authorization) throws JSONException {
        synchronized (LOCK) {
            JSONArray array = new JSONArray();
            for (Video video : videos) array.put(video.toJson());
            preferences(context).edit().putString(CONTINUE_WATCHING, array.toString()).commit();
            update(context, ContinueWatchingWidgetProvider.class);
            Map<File, String> thumbnails = new LinkedHashMap<>();
            for (Video video : videos) {
                File file = thumbnailFile(context, video);
                if (file != null) thumbnails.put(file, video.thumbnail());
            }
            if (cacheThumbnails(thumbnailDirectory(context), thumbnails, authorization)) {
                update(context, ContinueWatchingWidgetProvider.class);
            }
        }
    }

    /** Stores the downloads, shows them at once, then adds missing thumbnails. Call off the main thread. */
    static void setDownloads(Context context, List<Download> downloads, Authorization authorization) throws JSONException {
        synchronized (LOCK) {
            JSONArray array = new JSONArray();
            for (Download download : downloads) array.put(download.toJson());
            preferences(context).edit().putString(DOWNLOADS, array.toString()).commit();
            update(context, RecentDownloadsWidgetProvider.class);
            Map<File, String> thumbnails = new LinkedHashMap<>();
            for (Download download : downloads) {
                File file = thumbnailFile(context, download);
                if (file != null) thumbnails.put(file, download.thumbnail());
            }
            if (cacheThumbnails(downloadThumbnailDirectory(context), thumbnails, authorization)) {
                update(context, RecentDownloadsWidgetProvider.class);
            }
        }
    }

    /** Downloads missing thumbnails and deletes the directory's other files. */
    private static boolean cacheThumbnails(File directory, Map<File, String> thumbnails, Authorization authorization) {
        boolean downloaded = false;
        for (Map.Entry<File, String> thumbnail : thumbnails.entrySet()) {
            if (!thumbnail.getKey().isFile()) downloaded |= download(thumbnail.getValue(), thumbnail.getKey(), authorization);
        }
        Set<String> keep = new HashSet<>();
        for (File file : thumbnails.keySet()) keep.add(file.getName());
        File[] files = directory.listFiles();
        if (files != null) {
            for (File file : files) if (file.isFile() && !keep.contains(file.getName())) file.delete();
        }
        return downloaded;
    }

    static void update(Context context, Class<?> provider) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, provider));
        for (int id : ids) manager.updateAppWidget(id, views(context, provider, id, manager.getAppWidgetOptions(id)));
    }

    static RemoteViews views(Context context, Class<?> provider, int id, Bundle options) {
        if (provider == QuickAccessWidgetProvider.class) return quickAccess(context, quickAccessPages(context, id));
        if (provider == WatchTimeWidgetProvider.class) return watchTime(context, LocalDate.now());
        if (provider == RecentDownloadsWidgetProvider.class) return recentDownloads(context, options);
        return continueWatching(context, options);
    }

    static RemoteViews continueWatching(Context context, Bundle options) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_continue_watching);
        views.setOnClickPendingIntent(R.id.widget_header, activity(context, new Intent(context, MainActivity.class)));
        views.removeAllViews(R.id.widget_videos);
        List<Video> videos = continueWatching(context);
        int rows = Math.min(videos.size(), rows(options));
        for (int index = 0; index < rows; index++) {
            Video video = videos.get(index);
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_continue_watching_video);
            row.setTextViewText(R.id.widget_video_title, video.title());
            row.setTextViewText(R.id.widget_video_author, video.author());
            row.setViewVisibility(R.id.widget_video_author, video.author().isEmpty() ? View.GONE : View.VISIBLE);
            if (video.length() > 0) {
                row.setProgressBar(R.id.widget_video_progress, video.length(), Math.min(video.progress(), video.length()), false);
            } else {
                row.setViewVisibility(R.id.widget_video_progress, View.GONE);
            }
            Bitmap thumbnail = loadThumbnail(thumbnailFile(context, video));
            if (thumbnail != null) row.setImageViewBitmap(R.id.widget_video_thumbnail, thumbnail);
            row.setOnClickPendingIntent(R.id.widget_video, activity(context, videoIntent(context, video)));
            views.addView(R.id.widget_videos, row);
        }
        views.setViewVisibility(R.id.widget_empty, rows == 0 ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_videos, rows == 0 ? View.GONE : View.VISIBLE);
        return views;
    }

    static RemoteViews recentDownloads(Context context, Bundle options) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_recent_downloads);
        views.setOnClickPendingIntent(R.id.widget_header, activity(context, pageIntent(context, "downloads")));
        views.removeAllViews(R.id.widget_videos);
        List<Download> downloads = downloads(context);
        int rows = Math.min(downloads.size(), rows(options));
        for (int index = 0; index < rows; index++) {
            Download download = downloads.get(index);
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_continue_watching_video);
            row.setTextViewText(R.id.widget_video_title, download.title());
            row.setTextViewText(R.id.widget_video_author, download.author());
            row.setViewVisibility(R.id.widget_video_author, download.author().isEmpty() ? View.GONE : View.VISIBLE);
            row.setViewVisibility(R.id.widget_video_progress, View.GONE);
            Bitmap thumbnail = loadThumbnail(thumbnailFile(context, download));
            if (thumbnail != null) row.setImageViewBitmap(R.id.widget_video_thumbnail, thumbnail);
            row.setOnClickPendingIntent(R.id.widget_video, activity(context, pageIntent(context, "download/" + download.id())));
            views.addView(R.id.widget_videos, row);
        }
        views.setViewVisibility(R.id.widget_empty, rows == 0 ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_videos, rows == 0 ? View.GONE : View.VISIBLE);
        return views;
    }

    private static final int[] BARS = {
        R.id.widget_bar_0, R.id.widget_bar_1, R.id.widget_bar_2, R.id.widget_bar_3,
        R.id.widget_bar_4, R.id.widget_bar_5, R.id.widget_bar_6,
    };
    private static final int[] DAYS = {
        R.id.widget_day_0, R.id.widget_day_1, R.id.widget_day_2, R.id.widget_day_3,
        R.id.widget_day_4, R.id.widget_day_5, R.id.widget_day_6,
    };

    /** The last seven days ending with today, which is drawn last in the accent color. */
    static RemoteViews watchTime(Context context, LocalDate today) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_watch_time);
        views.setOnClickPendingIntent(R.id.widget_header, activity(context, pageIntent(context, "stats")));
        views.setOnClickPendingIntent(R.id.widget_summary, activity(context, pageIntent(context, "stats")));
        Locale locale = context.getResources().getConfiguration().getLocales().get(0);
        Map<String, Long> watched = watchTime(context);
        long[] seconds = new long[WATCH_TIME_DAYS];
        long total = 0;
        long maximum = 0;
        for (int index = 0; index < WATCH_TIME_DAYS; index++) {
            seconds[index] = watched.getOrDefault(today.minusDays(WATCH_TIME_DAYS - 1 - index).toString(), 0L);
            total += seconds[index];
            maximum = Math.max(maximum, seconds[index]);
        }
        DateFormat weekday = DateFormat.getInstanceForSkeleton("EEEEEE", locale);
        for (int index = 0; index < WATCH_TIME_DAYS; index++) {
            LocalDate date = today.minusDays(WATCH_TIME_DAYS - 1 - index);
            // A small floor keeps days with any watch time visible next to long days.
            int progress = seconds[index] == 0 ? 0 : (int) Math.max(40, seconds[index] * 1000 / maximum);
            views.setProgressBar(BARS[index], 1000, progress, false);
            views.setTextViewText(DAYS[index], weekday.format(Date.from(date.atStartOfDay(ZoneId.systemDefault()).toInstant())));
        }
        views.setTextViewText(R.id.widget_today_value, formatDuration(seconds[WATCH_TIME_DAYS - 1], locale));
        views.setTextViewText(R.id.widget_week_value, formatDuration(total, locale));
        return views;
    }

    /** Whole minutes in the locale's narrow units, such as "1h 5m". */
    static String formatDuration(long seconds, Locale locale) {
        long minutes = seconds / 60;
        MeasureFormat format = MeasureFormat.getInstance(locale, MeasureFormat.FormatWidth.NARROW);
        Measure hours = new Measure(minutes / 60, MeasureUnit.HOUR);
        Measure rest = new Measure(minutes % 60, MeasureUnit.MINUTE);
        if (minutes < 60) return format.format(rest);
        return minutes % 60 == 0 ? format.format(hours) : format.formatMeasures(hours, rest);
    }

    /** Redraws Watch time shortly after the next local midnight, even when the app does not run. */
    static void scheduleMidnightUpdate(Context context) {
        long midnight = LocalDate.now().plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
        context.getSystemService(AlarmManager.class).set(AlarmManager.RTC, midnight + 1000, midnightUpdate(context));
    }

    static void cancelMidnightUpdate(Context context) {
        context.getSystemService(AlarmManager.class).cancel(midnightUpdate(context));
    }

    private static PendingIntent midnightUpdate(Context context) {
        Intent intent = new Intent(context, WatchTimeWidgetProvider.class).setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS,
            AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, WatchTimeWidgetProvider.class)));
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Quick access destinations. Downloads needs the bundled yt-dlp. */
    enum Page {
        SEARCH("search", R.string.widget_search, R.drawable.ic_widget_search),
        SUBSCRIPTIONS("subscriptions", R.string.widget_subscriptions, R.drawable.ic_widget_subscriptions),
        WATCH_LATER("watch-later", R.string.widget_watch_later, R.drawable.ic_widget_watch_later),
        HISTORY("history", R.string.widget_history, R.drawable.ic_widget_history),
        PLAYLISTS("playlists", R.string.widget_playlists, R.drawable.ic_widget_playlists),
        DOWNLOADS("downloads", R.string.widget_downloads, R.drawable.ic_widget_downloads);

        final String id;
        final int label;
        final int icon;

        Page(String id, int label, int icon) {
            this.id = id;
            this.label = label;
            this.icon = icon;
        }

        static List<Page> available() {
            List<Page> pages = new ArrayList<>(List.of(values()));
            if (!BuildConfig.BUNDLES_YT_DLP) pages.remove(DOWNLOADS);
            return pages;
        }

        static Page fromId(String id) {
            for (Page page : available()) if (page.id.equals(id)) return page;
            return null;
        }
    }

    static final List<Page> DEFAULT_QUICK_ACCESS_PAGES = List.of(Page.SEARCH, Page.SUBSCRIPTIONS, Page.WATCH_LATER);

    static List<Page> quickAccessPages(Context context, int widgetId) {
        String stored = preferences(context).getString(QUICK_ACCESS + widgetId, null);
        if (stored == null) return DEFAULT_QUICK_ACCESS_PAGES;
        List<Page> pages = new ArrayList<>();
        for (String id : stored.split(",")) {
            Page page = Page.fromId(id);
            if (page != null && !pages.contains(page) && pages.size() < MAX_QUICK_ACCESS_PAGES) pages.add(page);
        }
        return pages.isEmpty() ? DEFAULT_QUICK_ACCESS_PAGES : pages;
    }

    static void setQuickAccessPages(Context context, int widgetId, List<Page> pages) {
        List<String> ids = new ArrayList<>();
        for (Page page : pages) ids.add(page.id);
        preferences(context).edit().putString(QUICK_ACCESS + widgetId, String.join(",", ids)).apply();
    }

    static void removeQuickAccessPages(Context context, int[] widgetIds) {
        android.content.SharedPreferences.Editor editor = preferences(context).edit();
        for (int id : widgetIds) editor.remove(QUICK_ACCESS + id);
        editor.apply();
    }

    private static final int[] ACTIONS = { R.id.widget_action_0, R.id.widget_action_1, R.id.widget_action_2, R.id.widget_action_3 };
    private static final int[] ACTION_ICONS = {
        R.id.widget_action_icon_0, R.id.widget_action_icon_1, R.id.widget_action_icon_2, R.id.widget_action_icon_3,
    };
    private static final int[] ACTION_LABELS = {
        R.id.widget_action_label_0, R.id.widget_action_label_1, R.id.widget_action_label_2, R.id.widget_action_label_3,
    };

    static RemoteViews quickAccess(Context context, List<Page> pages) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_access);
        for (int index = 0; index < ACTIONS.length; index++) {
            Page page = index < pages.size() ? pages.get(index) : null;
            views.setViewVisibility(ACTIONS[index], page == null ? View.GONE : View.VISIBLE);
            if (page == null) continue;
            views.setImageViewResource(ACTION_ICONS[index], page.icon);
            views.setTextViewText(ACTION_LABELS[index], context.getString(page.label));
            views.setOnClickPendingIntent(ACTIONS[index], activity(context, pageIntent(context, page.id)));
        }
        return views;
    }

    /** Rows that fit the widget's height; launchers report the portrait size in dp. */
    static int rows(Bundle options) {
        int height = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT);
        if (height <= 0) return 2;
        return Math.max(1, Math.min(MAX_VIDEOS, (height - 48) / 64));
    }

    static Intent videoIntent(Context context, Video video) {
        Uri uri = Uri.parse("https://www.youtube.com/watch").buildUpon()
            .appendQueryParameter("v", video.id())
            .appendQueryParameter("t", video.progress() + "s")
            .build();
        return new Intent(Intent.ACTION_VIEW, uri, context, MainActivity.class);
    }

    static Intent pageIntent(Context context, String page) {
        return new Intent(Intent.ACTION_VIEW, Uri.parse("opentubex://open/" + page), context, MainActivity.class);
    }

    private static PendingIntent activity(Context context, Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static boolean isThumbnailUrl(String value) {
        try {
            return !value.isEmpty() && AndroidMediaArtwork.isSafeArtworkUrl(new URL(value));
        } catch (IOException ignored) {
            return false;
        }
    }

    private static android.content.SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private static File thumbnailDirectory(Context context) {
        File directory = new File(context.getFilesDir(), "home-widgets");
        directory.mkdirs();
        return directory;
    }

    private static File thumbnailFile(Context context, Video video) {
        if (video.thumbnail().isEmpty()) return null;
        return new File(thumbnailDirectory(context), video.id() + "-" + Integer.toHexString(video.thumbnail().hashCode()) + ".jpg");
    }

    private static File downloadThumbnailDirectory(Context context) {
        File directory = new File(thumbnailDirectory(context), "downloads");
        directory.mkdirs();
        return directory;
    }

    private static File thumbnailFile(Context context, Download download) {
        if (download.thumbnail().isEmpty()) return null;
        return new File(downloadThumbnailDirectory(context), download.id() + "-" + Integer.toHexString(download.thumbnail().hashCode()) + ".jpg");
    }

    private static synchronized OkHttpClient client() {
        if (client == null) {
            // Same public-address and size limits as media notification artwork.
            client = new OkHttpClient.Builder()
                .dns(AndroidMediaArtwork.publicDns(okhttp3.Dns.SYSTEM))
                .proxyAuthenticator(AndroidProxy.proxyAuthenticator())
                .followSslRedirects(false)
                .connectTimeout(5, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS)
                .callTimeout(10, TimeUnit.SECONDS).build();
        }
        return client;
    }

    private static boolean download(String source, File file, Authorization authorization) {
        HttpUrl url = HttpUrl.parse(source);
        if (url == null) return false;
        Request.Builder request = new Request.Builder().url(url);
        // OkHttp drops this header when a redirect leaves the instance's host.
        if (authorization != null && authorization.appliesTo(url)) request.header("Authorization", authorization.value());
        try (Response response = client().newCall(request.build()).execute()) {
            ResponseBody body = response.body();
            if (!response.isSuccessful() || body == null) return false;
            byte[] encoded = AndroidMediaArtwork.readArtworkBytes(body.byteStream(), body.contentLength());
            if (encoded == null) return false;
            Bitmap thumbnail = decodeThumbnail(encoded);
            if (thumbnail == null) return false;
            File temporary = new File(file.getPath() + ".tmp");
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                thumbnail.compress(Bitmap.CompressFormat.JPEG, 85, output);
            } finally {
                thumbnail.recycle();
            }
            return temporary.renameTo(file);
        } catch (IOException | RuntimeException ignored) {
            // The widget keeps its placeholder; the next update retries.
            return false;
        }
    }

    /** Center-crops to a small 16:9 image. */
    private static Bitmap decodeThumbnail(byte[] encoded) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(encoded, 0, encoded.length, bounds);
        int sampleSize = AndroidMediaArtwork.calculateArtworkSampleSize(bounds.outWidth, bounds.outHeight);
        if (sampleSize == 0) return null;
        while (bounds.outWidth / (sampleSize * 2) >= THUMBNAIL_WIDTH && bounds.outHeight / (sampleSize * 2) >= THUMBNAIL_HEIGHT) {
            sampleSize *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize;
        Bitmap decoded = BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
        if (decoded == null) return null;
        Bitmap result = Bitmap.createBitmap(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, Bitmap.Config.ARGB_8888);
        float scale = Math.max((float) THUMBNAIL_WIDTH / decoded.getWidth(), (float) THUMBNAIL_HEIGHT / decoded.getHeight());
        Matrix matrix = new Matrix();
        matrix.setScale(scale, scale);
        matrix.postTranslate((THUMBNAIL_WIDTH - decoded.getWidth() * scale) / 2, (THUMBNAIL_HEIGHT - decoded.getHeight() * scale) / 2);
        new Canvas(result).drawBitmap(decoded, matrix, new Paint(Paint.FILTER_BITMAP_FLAG));
        decoded.recycle();
        return result;
    }

    /** Loads a cached thumbnail with rounded corners. RemoteViews cannot clip images before Android 12. */
    private static Bitmap loadThumbnail(File file) {
        Bitmap source = file == null || !file.isFile() ? null : BitmapFactory.decodeFile(file.getPath());
        if (source == null) return null;
        Bitmap rounded = Bitmap.createBitmap(source.getWidth(), source.getHeight(), Bitmap.Config.ARGB_8888);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setShader(new BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
        float radius = source.getHeight() * 0.08f;
        new Canvas(rounded).drawRoundRect(new RectF(0, 0, source.getWidth(), source.getHeight()), radius, radius, paint);
        source.recycle();
        return rounded;
    }
}
