package org.opentubex.app;

import static org.junit.Assert.assertEquals;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;

public class ExternalMediaLinkTest {
    @Test public void rumbleLinksMatchVideosButNotListings() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        for (String path : new String[] { "/v123456.html", "/v123456-example.html", "/v123456-example.html?start=10" }) {
            assertEquals(path, BuildConfig.BUNDLES_YT_DLP, matchesRumbleLink(context, path));
        }
        for (String path : new String[] { "/", "/videos", "/videos/", "/v123456-example", "/v123456-exampleXhtml" }) {
            assertEquals(path, false, matchesRumbleLink(context, path));
        }
    }

    private static boolean matchesRumbleLink(Context context, String path) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://rumble.com" + path))
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .setPackage(context.getPackageName());
        return context.getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
            .stream().anyMatch(result -> result.activityInfo.name.equals("org.opentubex.app.ExternalMediaLinkActivity"));
    }
}
