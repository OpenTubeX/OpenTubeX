package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.PictureInPictureParams;
import android.app.PictureInPictureUiState;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.Build;
import android.os.Parcel;
import android.util.Rational;
import android.webkit.WebView;
import android.view.View;
import android.view.ViewGroup;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;

@RunWith(AndroidJUnit4.class)
public class PictureInPictureTest {
    @Test
    public void clearingTargetPreservesOnlyThePreparedCrop() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            boolean[] focused = { false };
            long deadline = android.os.SystemClock.uptimeMillis() + 5000;
            while (!focused[0] && android.os.SystemClock.uptimeMillis() < deadline) {
                scenario.onActivity(activity -> focused[0] = activity.hasWindowFocus());
                Thread.sleep(20);
            }
            assertTrue("Activity has focus", focused[0]);
            scenario.onActivity(activity -> {
                AndroidUiPlugin plugin = (AndroidUiPlugin) activity.getBridge().getPlugin("AndroidUi").getInstance();
                try {
                    Field source = AndroidUiPlugin.class.getDeclaredField("pictureInPictureSourceRect");
                    source.setAccessible(true);
                    Rect rect = new Rect(0, 120, 640, 480);
                    PluginCall clear = new PluginCall(null, "AndroidUi", "pip-clear-test", "setAutoPictureInPicture",
                        new JSObject().put("enabled", false).put("sourceRect", JSONObject.NULL)) {
                        @Override public void resolve() {}
                    };
                    source.set(plugin, rect);
                    plugin.setAutoPictureInPicture(clear);
                    assertNull("Removing the target clears its old crop", source.get(plugin));
                    source.set(plugin, rect);
                    plugin.preparePictureInPictureSurface();
                    try {
                        plugin.setAutoPictureInPicture(clear);
                        assertEquals("Pausing prepared PiP preserves its live crop", rect, source.get(plugin));
                    } finally {
                        plugin.onPictureInPictureModeChanged(false, () -> {});
                    }
                } catch (ReflectiveOperationException error) {
                    throw new AssertionError(error);
                }
            });
        }
    }

    @Test
    public void liveVideoKeepsItsViewportAndFitsTheFirstResizedFrame() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            boolean[] laidOut = { false };
            long deadline = android.os.SystemClock.uptimeMillis() + 5000;
            while (!laidOut[0] && android.os.SystemClock.uptimeMillis() < deadline) {
                scenario.onActivity(activity -> laidOut[0] = activity.getWindow().getDecorView().getWidth() > 640 &&
                    activity.getWindow().getDecorView().getHeight() > 480);
                Thread.sleep(20);
            }
            assertTrue("The original window is laid out", laidOut[0]);
            Thread.sleep(500); // Allow the activity's initial system insets to settle.
            scenario.onActivity(activity -> {
                WebView view = activity.getBridge().getWebView();
                ViewGroup parent = (ViewGroup) view.getParent();
                int rootWidth = activity.getWindow().getDecorView().getWidth();
                int rootHeight = activity.getWindow().getDecorView().getHeight();
                int width = view.getWidth();
                int height = view.getHeight();
                int layoutWidth = view.getLayoutParams().width;
                int layoutHeight = view.getLayoutParams().height;
                boolean clips = parent.getClipChildren();
                int[] location = new int[2];
                view.getLocationInWindow(location);
                Rect source = new Rect(location[0], location[1] + 120, location[0] + 640, location[1] + 480);
                PictureInPictureSurface surface = new PictureInPictureSurface(activity, view);
                surface.prepare(source);
                try {
                    View root = activity.getWindow().getDecorView();
                    root.measure(View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(180, View.MeasureSpec.EXACTLY));
                    root.layout(0, 0, 320, 180);
                    surface.onModeChanged(true, () -> {});
                    assertEquals("Chromium keeps its original width", width, view.getWidth());
                    assertEquals("Chromium keeps its original height", height, view.getHeight());
                    RectF bounds = new RectF(0, 120, 640, 480);
                    view.getMatrix().mapRect(bounds);
                    parent.getLocationInWindow(location);
                    bounds.offset(location[0] + view.getLeft(), location[1] + view.getTop());
                    assertEquals("Video begins at the window left", 0f, bounds.left, 1f);
                    assertEquals("Video begins at the window top", 0f, bounds.top, 1f);
                    assertEquals("Video fills the window width", 320f, bounds.right, 1f);
                    assertEquals("Video fills the window height", 180f, bounds.bottom, 1f);
                    boolean[] returned = { false };
                    surface.onModeChanged(false, () -> returned[0] = true);
                    assertFalse("Keep cropping until the normal native window returns", returned[0]);
                    root.measure(View.MeasureSpec.makeMeasureSpec(rootWidth, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(rootHeight, View.MeasureSpec.EXACTLY));
                    root.layout(0, 0, rootWidth, rootHeight);
                    surface.onModeChanged(false, () -> returned[0] = true);
                    assertTrue("Restore the page once its full native window is laid out", returned[0]);
                } finally {
                    surface.clear();
                }
                assertEquals(layoutWidth, view.getLayoutParams().width);
                assertEquals(layoutHeight, view.getLayoutParams().height);
                assertEquals(clips, parent.getClipChildren());
                assertEquals(1f, view.getScaleX(), 0f);
                assertEquals(1f, view.getScaleY(), 0f);
                assertEquals(0f, view.getTranslationX(), 0f);
                assertEquals(0f, view.getTranslationY(), 0f);
            });
        }
    }

    @Test
    public void pipPreservesTheWideViewportAndRestoresScrollbars() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                WebView view = activity.getBridge().getWebView();
                view.setVerticalScrollBarEnabled(true);
                view.setHorizontalScrollBarEnabled(true);
                assertTrue("Normal UI scaling honors a wide viewport", view.getSettings().getUseWideViewPort());
                activity.onPictureInPictureModeChanged(true, activity.getResources().getConfiguration());
                assertTrue("PiP preserves the original viewport settings", view.getSettings().getUseWideViewPort());
                assertFalse("PiP has no vertical WebView scrollbar", view.isVerticalScrollBarEnabled());
                assertFalse("PiP has no horizontal WebView scrollbar", view.isHorizontalScrollBarEnabled());
                activity.onPictureInPictureModeChanged(false, activity.getResources().getConfiguration());
                assertTrue("Normal UI scaling is restored on return", view.getSettings().getUseWideViewPort());
                assertTrue("Normal vertical scrollbar is restored", view.isVerticalScrollBarEnabled());
                assertTrue("Normal horizontal scrollbar is restored", view.isHorizontalScrollBarEnabled());
            });
        }
    }

    @Test
    public void automaticEntryNotifiesWebViewBeforePictureInPictureModeChanges() throws Exception {
        if (Build.VERSION.SDK_INT < 35) return;
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            long deadline = android.os.SystemClock.uptimeMillis() + 5000;
            boolean[] ready = { false };
            while (!ready[0] && android.os.SystemClock.uptimeMillis() < deadline) {
                CountDownLatch checked = new CountDownLatch(1);
                scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                    "typeof window.Capacitor?.triggerEvent === 'function'", result -> {
                        ready[0] = "true".equals(result);
                        checked.countDown();
                    }));
                assertTrue(checked.await(5, TimeUnit.SECONDS));
                if (!ready[0]) Thread.sleep(20);
            }
            assertTrue("Capacitor event bridge is ready", ready[0]);
            CountDownLatch listening = new CountDownLatch(1);
            scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                "window.__pipEarlyEntry = false; window.addEventListener('opentubex:android-pip', " +
                "event => { if (event.active && event.transitioning) window.__pipEarlyEntry = true; });",
                result -> listening.countDown()));
            assertTrue(listening.await(5, TimeUnit.SECONDS));
            scenario.onActivity(activity -> {
                assertFalse("Entry preparation precedes the mode change", activity.isInPictureInPictureMode());
                // UI-state's builder is hidden; recreate the two Parcelable flags.
                Parcel parcel = Parcel.obtain();
                parcel.writeInt(0); // Not stashed.
                parcel.writeInt(1); // Transitioning to PiP.
                parcel.setDataPosition(0);
                PictureInPictureUiState state = PictureInPictureUiState.CREATOR.createFromParcel(parcel);
                parcel.recycle();
                activity.onPictureInPictureUiStateChanged(state);
            });
            boolean[] transitioning = { false };
            deadline = android.os.SystemClock.uptimeMillis() + 5000;
            while (!transitioning[0] && android.os.SystemClock.uptimeMillis() < deadline) {
                CountDownLatch received = new CountDownLatch(1);
                scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                    "window.__pipEarlyEntry === true", result -> {
                        transitioning[0] = "true".equals(result);
                        received.countDown();
                    }));
                assertTrue(received.await(5, TimeUnit.SECONDS));
                if (!transitioning[0]) Thread.sleep(20);
            }
            assertTrue("Hide the page when Android starts its crop, before the mode callback", transitioning[0]);
        }
    }

    @Test
    public void cssVideoBoundsIncludeUiScaleAndNativeInsets() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            boolean[] focused = { false };
            long deadline = android.os.SystemClock.uptimeMillis() + 5000;
            while (!focused[0] && android.os.SystemClock.uptimeMillis() < deadline) {
                scenario.onActivity(activity -> focused[0] = activity.hasWindowFocus());
                Thread.sleep(20);
            }
            assertTrue("Activity has focus", focused[0]);
            CountDownLatch configured = new CountDownLatch(1);
            scenario.onActivity(activity -> {
                WebView view = activity.getBridge().getWebView();
                assertTrue("Activity is laid out", view.getWidth() > 0);
                AndroidUiPlugin plugin = (AndroidUiPlugin) activity.getBridge().getPlugin("AndroidUi").getInstance();
                JSObject sourceRect = new JSObject().put("x", 10.5).put("y", 40.25)
                    .put("width", 180.5).put("height", 101.5).put("viewportWidth", 240);
                plugin.setAutoPictureInPicture(new PluginCall(null, "AndroidUi", "pip-test",
                    "setAutoPictureInPicture", new JSObject().put("enabled", false).put("sourceRect", sourceRect)) {
                    @Override public void resolve() { configured.countDown(); }
                });
            });
            assertTrue(configured.await(5, TimeUnit.SECONDS));
            scenario.onActivity(activity -> {
                WebView view = activity.getBridge().getWebView();
                int[] location = new int[2];
                view.getLocationInWindow(location);
                double scale = view.getWidth() / 240.0;
                AndroidUiPlugin plugin = (AndroidUiPlugin) activity.getBridge().getPlugin("AndroidUi").getInstance();
                try {
                    Field source = AndroidUiPlugin.class.getDeclaredField("pictureInPictureSourceRect");
                    source.setAccessible(true);
                    assertEquals(new Rect(
                        location[0] + (int) Math.round(10.5 * scale),
                        location[1] + (int) Math.round(40.25 * scale),
                        location[0] + (int) Math.round(191 * scale),
                        location[1] + (int) Math.round(141.75 * scale)
                    ), source.get(plugin));
                } catch (ReflectiveOperationException error) {
                    throw new AssertionError(error);
                }
            });
        }
    }

    @Test
    public void animationTargetsTheVideoInsteadOfTheWholeActivity() throws Exception {
        Rect video = new Rect(12, 156, 1068, 750);
        assertEquals("PiP must animate from and back to the video bounds", video,
            params(video).getSourceRectHint());
    }

    @Test
    public void liveVideoUsesSeamlessNativeResizing() throws Exception {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        assertTrue("Scale the live video without reallocating its surface",
            params(null).isSeamlessResizeEnabled());
    }

    private static PictureInPictureParams params(Rect sourceRect) throws Exception {
        Class<?> factory = Class.forName("org.opentubex.app.AndroidUiPlugin$PictureInPicture");
        Method method = factory.getDeclaredMethod("buildParams", Rational.class, boolean.class, Rect.class);
        method.setAccessible(true);
        return (PictureInPictureParams) method.invoke(null, new Rational(16, 9), false, sourceRect);
    }
}
