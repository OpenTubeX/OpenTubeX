package org.opentubex.app;

import static org.junit.Assert.assertEquals;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;

public class ExternalMediaLinkTest {
    private static final String[] MEDIA_LINKS = {
        "https://www.instagram.com/reel/C1a2b3c4d5e/",
        "https://instagram.com/p/C1a2b3c4d5e/",
        "https://www.tiktok.com/@example/video/7234567890123456789",
        "https://vm.tiktok.com/ZMabc123/",
        "https://x.com/example/status/1234567890",
        "https://www.reddit.com/r/videos/comments/abc123/example/",
        "https://www.facebook.com/reel/1234567890",
        "https://www.facebook.com/example/videos/1234567890/",
        "https://www.facebook.com/watch?v=1234567890",
        "https://m.facebook.com/watch/?v=1234567890",
        "https://www.dailymotion.com/video/x8abc12",
        "https://dai.ly/x8abc12",
        "https://www.twitch.tv/videos/1234567890",
        "https://www.twitch.tv/example/clip/AwkwardSlug",
        "https://clips.twitch.tv/AwkwardSlug",
        "https://soundcloud.com/example/track-name",
        "https://www.bilibili.com/video/BV1xx411c7mD",
        "https://www.bilibili.com/bangumi/play/ep123456",
        "https://rumble.com/v123456-example.html",
        "https://rumble.com/v123456-dotted.slug.html",
        "https://bsky.app/profile/example.bsky.social/post/3abc123",
        "https://odysee.com/@example:a/video-title:b",
        "https://kick.com/example/videos/12345678-1234-1234-1234-123456789abc",
        "https://kick.com/example/clips/clip_01ABCDEF",
        "https://www.nicovideo.jp/watch/sm12345678",
        "https://vk.com/video-12345_67890",
        "https://vkvideo.ru/clip-12345_67890",
        "https://example.bandcamp.com/track/song-name",
        "https://example.bandcamp.com/album/album-name",
    };

    private static final String[] OTHER_LINKS = {
        "https://www.instagram.com/reel/",
        "https://www.instagram.com/example/",
        "https://www.tiktok.com/@example/video/",
        "https://www.tiktok.com/@example",
        "https://vt.tiktok.com/",
        "https://x.com/example/status/",
        "https://x.com/example",
        "https://www.reddit.com/r/videos/comments/",
        "https://www.reddit.com/r/videos/",
        "https://www.facebook.com/reel/",
        "https://www.facebook.com/example",
        "https://www.dailymotion.com/video/",
        "https://dai.ly/",
        "https://www.twitch.tv/videos/",
        "https://clips.twitch.tv/",
        "https://www.twitch.tv/example",
        "https://soundcloud.com/example/",
        "https://soundcloud.com/example",
        "https://www.bilibili.com/video/",
        "https://rumble.com/videos",
        "https://bsky.app/profile/example.bsky.social/post/",
        "https://odysee.com/@example:a/",
        "https://odysee.com/@example:a",
        "https://kick.com/example/videos/",
        "https://kick.com/example",
        "https://www.nicovideo.jp/watch/",
        "https://vk.com/video",
        "https://vk.com/videos",
        "https://vk.com/clips",
        "https://example.bandcamp.com/track/",
        "https://example.bandcamp.com/album/",
    };

    private static final String[] YOUTUBE_LINKS = {
        "https://www.youtube.com/watch?v=aaaaaaaaaaa",
        "https://m.youtube.com/watch?v=aaaaaaaaaaa&list=PLaaaaaaaaaa",
        "https://youtube.com/shorts/aaaaaaaaaaa",
        "https://www.youtube.com/live/aaaaaaaaaaa",
        "https://www.youtube.com/embed/aaaaaaaaaaa",
        "https://youtu.be/aaaaaaaaaaa?t=7",
        "https://www.youtube.com/playlist?list=PLaaaaaaaaaa",
        "https://www.youtube.com/embed?listType=playlist&list=PLaaaaaaaaaa",
        "https://www.youtube.com/show/VLPLaaaaaaaaaa",
        "https://www.youtube.com/@example",
        "https://www.youtube.com/@example/videos",
        "https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa",
        "https://www.youtube.com/c/example",
        "https://www.youtube.com/user/example",
        "https://www.youtube.com/post/Ugkxaaaaaaaaaa",
        "https://www.youtube.com/hashtag/example",
        "https://www.youtube.com/results?search_query=example",
        "https://www.youtube.com/feed/subscriptions",
    };

    private static final String[] OTHER_YOUTUBE_LINKS = {
        "https://www.youtube.com/",
        "https://www.youtube.com/activate",
        "https://www.youtube.com/tv/activate",
        "https://www.youtube.com/account",
        "https://www.youtube.com/premium",
        "https://www.youtube.com/watchlater",
        "https://www.youtube.com/feed/storefront",
        "https://youtu.be/",
        "https://music.youtube.com/watch?v=aaaaaaaaaaa",
    };

    @Test public void youtubeLinksMatchOnlyPagesTheAppOpens() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        for (String url : YOUTUBE_LINKS) {
            assertEquals(url, true, matches(context, url, "org.opentubex.app.MainActivity"));
        }
        for (String url : OTHER_YOUTUBE_LINKS) {
            assertEquals(url, false, matches(context, url, "org.opentubex.app.MainActivity"));
        }
    }

    @Test public void linksMatchMediaButNotListingsOrEmptyPaths() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        for (String url : MEDIA_LINKS) {
            assertEquals(url, BuildConfig.BUNDLES_YT_DLP, matchesExternalMediaLink(context, url));
        }
        for (String url : OTHER_LINKS) {
            assertEquals(url, false, matchesExternalMediaLink(context, url));
        }
    }

    private static boolean matchesExternalMediaLink(Context context, String url) {
        return matches(context, url, "org.opentubex.app.ExternalMediaLinkActivity");
    }

    private static boolean matches(Context context, String url, String activity) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url))
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .setPackage(context.getPackageName());
        return context.getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
            .stream().anyMatch(result -> result.activityInfo.name.equals(activity));
    }
}
