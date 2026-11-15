package org.opentubex.app;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Field;
import java.util.Collections;
import java.util.Map;
import org.junit.Test;
import static org.junit.Assert.*;

public class YouTubeSessionActivityTest {
    private ActivityScenario<YouTubeSessionActivity> launch() {
        Intent intent = new Intent(InstrumentationRegistry.getInstrumentation().getTargetContext(), YouTubeSessionActivity.class)
            .putExtra("saveLabel", "Save").putExtra("hint", "Test session").putExtra("errorLabel", "Unable to save");
        return ActivityScenario.launch(intent);
    }

    private static Field field(String name) {
        try {
            Field field = YouTubeSessionActivity.class.getDeclaredField(name);
            field.setAccessible(true);
            return field;
        } catch (Exception error) { throw new AssertionError(error); }
    }

    @Test public void savingSurvivesSavedStateAndOrientationDoesNotRecreateBrowser() {
        try (ActivityScenario<YouTubeSessionActivity> scenario = launch()) {
            scenario.onActivity(activity -> {
                try {
                    ((WebView) field("browser").get(activity)).stopLoading();
                    field("saving").setBoolean(activity, true);
                    Bundle state = new Bundle();
                    activity.onSaveInstanceState(state);
                    assertTrue("Pending export must survive process recreation", state.getBoolean("saving"));
                    ActivityInfo info = activity.getPackageManager().getActivityInfo(activity.getComponentName(), 0);
                    assertEquals(ActivityInfo.CONFIG_ORIENTATION | ActivityInfo.CONFIG_SCREEN_SIZE,
                        info.configChanges & (ActivityInfo.CONFIG_ORIENTATION | ActivityInfo.CONFIG_SCREEN_SIZE));
                } catch (Exception error) { throw new AssertionError(error); }
            });
        }
    }

    @Test public void failedMainFrameSaveResetsPendingStateButSubresourceFailureDoesNot() {
        try (ActivityScenario<YouTubeSessionActivity> scenario = launch()) {
            scenario.onActivity(activity -> {
                try {
                    WebView browser = (WebView) field("browser").get(activity);
                    browser.stopLoading();
                    field("saving").setBoolean(activity, true);
                    WebResourceResponse error = new WebResourceResponse("text/plain", "UTF-8", 502, "Bad Gateway", Collections.emptyMap(), null);
                    browser.getWebViewClient().onReceivedHttpError(browser, request(false), error);
                    assertTrue(field("saving").getBoolean(activity));
                    browser.getWebViewClient().onReceivedHttpError(browser, request(true), error);
                    assertFalse("A failed export must be retryable", field("saving").getBoolean(activity));
                } catch (Exception error) { throw new AssertionError(error); }
            });
        }
    }

    private static WebResourceRequest request(boolean mainFrame) {
        return new WebResourceRequest() {
            @Override public Uri getUrl() { return Uri.parse("https://www.youtube.com/robots.txt"); }
            @Override public boolean isForMainFrame() { return mainFrame; }
            @Override public boolean isRedirect() { return false; }
            @Override public boolean hasGesture() { return false; }
            @Override public String getMethod() { return "GET"; }
            @Override public Map<String, String> getRequestHeaders() { return Collections.emptyMap(); }
        };
    }

    @Test public void redirectAwayFromExportPageResetsPendingSaveWithoutExporting() {
        try (ActivityScenario<YouTubeSessionActivity> scenario = launch()) {
            scenario.onActivity(activity -> {
                try {
                    WebView browser = (WebView) field("browser").get(activity);
                    browser.stopLoading();
                    field("saving").setBoolean(activity, true);
                    WebView redirected = new WebView(activity) {
                        @Override public String getUrl() { return "https://accounts.google.com/ServiceLogin"; }
                    };
                    try { browser.getWebViewClient().onPageFinished(redirected, redirected.getUrl()); }
                    finally { redirected.destroy(); }
                    assertFalse("A redirect must not leave export pending", field("saving").getBoolean(activity));
                } catch (Exception error) { throw new AssertionError(error); }
            });
        }
    }
}
