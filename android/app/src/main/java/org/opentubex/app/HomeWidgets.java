package org.opentubex.app;

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
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
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
 * Home screen widgets. The app stores Continue watching and its thumbnails;
 * widgets only render that cache and never make network requests.
 */
final class HomeWidgets {
    static final int MAX_VIDEOS = 4;
    private static final String PREFERENCES = "home_widgets";
    private static final String CONTINUE_WATCHING = "continue_watching";
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
        String stored = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(CONTINUE_WATCHING, "[]");
        try {
            return parse(new JSONArray(stored));
        } catch (JSONException ignored) {
            return List.of();
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
            context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
                .putString(CONTINUE_WATCHING, array.toString()).commit();
            update(context, ContinueWatchingWidgetProvider.class);

            File directory = thumbnailDirectory(context);
            Set<String> keep = new HashSet<>();
            boolean downloaded = false;
            for (Video video : videos) {
                File file = thumbnailFile(context, video);
                if (file == null) continue;
                keep.add(file.getName());
                if (!file.isFile()) downloaded |= download(video.thumbnail(), file, authorization);
            }
            File[] files = directory.listFiles();
            if (files != null) {
                for (File file : files) if (!keep.contains(file.getName())) file.delete();
            }
            if (downloaded) update(context, ContinueWatchingWidgetProvider.class);
        }
    }

    static void update(Context context, Class<?> provider) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, provider));
        for (int id : ids) {
            manager.updateAppWidget(id, provider == QuickAccessWidgetProvider.class
                ? quickAccess(context)
                : continueWatching(context, manager.getAppWidgetOptions(id)));
        }
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
            Bitmap thumbnail = loadThumbnail(context, video);
            if (thumbnail != null) row.setImageViewBitmap(R.id.widget_video_thumbnail, thumbnail);
            row.setOnClickPendingIntent(R.id.widget_video, activity(context, videoIntent(context, video)));
            views.addView(R.id.widget_videos, row);
        }
        views.setViewVisibility(R.id.widget_empty, rows == 0 ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_videos, rows == 0 ? View.GONE : View.VISIBLE);
        return views;
    }

    static RemoteViews quickAccess(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_access);
        views.setOnClickPendingIntent(R.id.widget_search, activity(context, pageIntent(context, "search")));
        views.setOnClickPendingIntent(R.id.widget_subscriptions, activity(context, pageIntent(context, "subscriptions")));
        views.setOnClickPendingIntent(R.id.widget_watch_later, activity(context, pageIntent(context, "watch-later")));
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

    private static File thumbnailDirectory(Context context) {
        File directory = new File(context.getFilesDir(), "home-widgets");
        directory.mkdirs();
        return directory;
    }

    private static File thumbnailFile(Context context, Video video) {
        if (video.thumbnail().isEmpty()) return null;
        return new File(thumbnailDirectory(context), video.id() + "-" + Integer.toHexString(video.thumbnail().hashCode()) + ".jpg");
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
    private static Bitmap loadThumbnail(Context context, Video video) {
        File file = thumbnailFile(context, video);
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
