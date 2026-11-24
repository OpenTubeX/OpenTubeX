package org.opentubex.app;

import android.app.PictureInPictureUiState;
import android.content.Intent;
import android.content.res.Configuration;
import android.hardware.input.InputManager;
import android.os.Bundle;
import android.os.Build;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsAnimation;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import com.capacitorjs.plugins.share.SharePlugin;

import java.net.CookieHandler;
import java.util.List;

public class MainActivity extends BridgeActivity {
    /** AndroidProxyRelay.clock when the app was last hidden, kept if Android recreates the activity. */
    private static Long hiddenAt;
    private InputManager inputManager;
    private int lastOrientation;
    private WebViewRotationFrame rotationFrame;
    private ImageView fullscreenCover;
    private int fullscreenCoverRequest;
    private boolean transientSystemBars;
    private StatusBarSwipeFilter statusBarSwipeFilter;
    private AppLock appLock;
    private final InputManager.InputDeviceListener inputDeviceListener =
        new InputManager.InputDeviceListener() {
            @Override
            public void onInputDeviceAdded(int deviceId) {
                notifyHardwareKeyboardState();
            }

            @Override
            public void onInputDeviceRemoved(int deviceId) {
                notifyHardwareKeyboardState();
            }

            @Override
            public void onInputDeviceChanged(int deviceId) {
                notifyHardwareKeyboardState();
            }
        };

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (bridge != null) {
            PluginHandle handle = bridge.getPlugin("Share");
            if (handle != null && handle.getInstance() instanceof SharePlugin share &&
                share.dispatchActivityResult(requestCode, resultCode, data)) return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onStart() {
        // Android can freeze or firewall a hidden app, so a server may have closed
        // a kept-alive connection unseen. Close those tunnels before the page
        // learns it is visible and reuses them, which would wait for a reply that
        // never comes. Tunnels that kept streaming, such as background playback, stay.
        if (hiddenAt != null) AndroidProxy.closeStaleTunnels(hiddenAt);
        WebViewNetworkState.refresh();
        super.onStart();
        appLock.onStart();
        AppVisibility.setVisible(true);
        SubscriptionRefreshWorker.onAppVisibilityChanged(this);
        BackgroundSync.onAppVisibilityChanged(this);
    }

    @Override
    public void onStop() {
        hiddenAt = AndroidProxyRelay.clock.getAsLong();
        appLock.onStop();
        AppVisibility.setVisible(false);
        SubscriptionRefreshWorker.onAppVisibilityChanged(this);
        BackgroundSync.onAppVisibilityChanged(this);
        super.onStop();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Only one renderer may use the app's data, and this one replaces the
        // hidden renderer that syncs while the app is closed.
        BackgroundSyncRenderer.stop();
        registerPlugin(AndroidProxyPlugin.class);
        registerPlugin(SecretStoragePlugin.class);
        registerPlugin(AndroidLocalNetworkPlugin.class);
        registerPlugin(DlnaPlugin.class);
        registerPlugin(ChromecastPlugin.class);
        registerPlugin(PoTokenPlugin.class);
        // Lite builds omit the runtime; the renderer then hides yt-dlp features.
        if (BuildConfig.BUNDLES_YT_DLP) registerPlugin(YtDlpPlugin.class);
        registerPlugin(AndroidUiPlugin.class);
        registerPlugin(AndroidBackPlugin.class);
        registerPlugin(AndroidDynamicColorsPlugin.class);
        registerPlugin(AppIconPlugin.class);
        registerPlugin(ScreenshotPlugin.class);
        registerPlugin(PullToRefreshPlugin.class);
        registerPlugin(AndroidStoragePlugin.class);
        registerPlugin(LibraryDatabasePlugin.class);
        registerPlugin(AndroidMediaSessionPlugin.class);
        registerPlugin(SubscriptionRefreshPlugin.class);
        registerPlugin(BackgroundSyncPlugin.class);
        registerPlugin(SabrHttpPlugin.class);
        registerPlugin(AndroidHttpPlugin.class);
        registerPlugin(VoiceOverHttpPlugin.class);
        registerPlugin(AndroidSharePlugin.class);
        registerPlugin(HomeWidgetsPlugin.class);
        registerPlugin(AppLockPlugin.class);
        // Android recreates an activity with the intent that first opened it, and
        // Capacitor passes that intent to onNewIntent on every create. Handle a
        // share or notification when it arrives, not again when the app comes
        // back from Recents or is restored after the system stopped it.
        if (savedInstanceState != null ||
            (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
            setIntent(new Intent(Intent.ACTION_MAIN));
        }
        super.onCreate(savedInstanceState);
        // Capacitor's cookie plugin makes HttpURLConnection share the WebView
        // cookie store, including the YouTube sign-in created for yt-dlp. Keep
        // native requests stateless like desktop: once YouTube recognizes a
        // visitor it serves preroll ads, which SABR enforces as long backoffs.
        CookieHandler.setDefault(null);
        lastOrientation = getResources().getConfiguration().orientation;
        // Capacitor must select its no-title theme before the decor is created.
        StartupBackground.apply(getWindow(), StartupBackground.getColor(this));
        setTransientSystemBars(false);
        // Without an insets animation callback, Android keeps the keyboard-sized
        // layout until a keyboard closed by predictive back has left the screen,
        // so the page stays short and the bottom navigation floats mid-screen.
        // With one, the page grows when the keyboard starts to close.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().getDecorView().setWindowInsetsAnimationCallback(
                new WindowInsetsAnimation.Callback(WindowInsetsAnimation.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                    @Override
                    public WindowInsets onProgress(WindowInsets insets, List<WindowInsetsAnimation> animations) {
                        return insets;
                    }
                }
            );
        }
        try {
            AppIconPlugin.updateTaskIcon(this);
        } catch (android.content.pm.PackageManager.NameNotFoundException | RuntimeException error) {
            android.util.Log.e("AppIcon", "Unable to restore recent apps icon", error);
        }
        // Honor viewport widths larger than the device for UI scales below 100%.
        getBridge().getWebView().getSettings().setUseWideViewPort(true);
        // UI scale owns the page viewport; the custom player handles video pinch zoom.
        getBridge().getWebView().getSettings().setSupportZoom(false);
        // Render small text at its CSS size like Electron and iOS instead of
        // WebView's default 8px minimum, which distorts scaled-down previews.
        getBridge().getWebView().getSettings().setMinimumFontSize(1);
        // Capacitor falls back to addJavascriptInterface when the modern,
        // top-frame-only bridge is unavailable. Fail closed instead of
        // exposing native plugins to untrusted subframes.
        getBridge().getWebView().removeJavascriptInterface("androidBridge");
        getBridge().setWebViewClient(new OpenTubeXWebViewClient(getBridge()));
        OpenTubeXNotificationChannels.createAll(this);
        inputManager = (InputManager) getSystemService(INPUT_SERVICE);
        inputManager.registerInputDeviceListener(inputDeviceListener, null);
        appLock = new AppLock(this);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        return (appLock != null && appLock.interceptKeyEvent(event)) || super.dispatchKeyEvent(event);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // Opening an upload notification marks its entry read.
        UploadNotifications.recordDismissed(this, intent);
        super.onNewIntent(intent);
    }

    @Override
    public void onDestroy() {
        if (rotationFrame != null) rotationFrame.run();
        inputManager.unregisterInputDeviceListener(inputDeviceListener);
        if (isFinishing() && bridge != null) {
            PluginHandle handle = bridge.getPlugin("SubscriptionRefresh");
            if (handle != null && handle.getInstance() instanceof SubscriptionRefreshPlugin refresh &&
                refresh.retainRenderer()) {
                // Dismiss playback with the task, but let subscription requests and
                // their database writes finish before destroying the Capacitor bridge.
                bridge.triggerWindowJSEvent("opentubex:android-task-removed");
                ((AndroidMediaSessionPlugin) bridge.getPlugin("AndroidMediaSession").getInstance()).handleOnDestroy();
                bridge = null;
            }
        }
        super.onDestroy();
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();

        PluginHandle handle = getBridge().getPlugin("AndroidUi");
        if (handle != null && handle.getInstance() instanceof AndroidUiPlugin) {
            ((AndroidUiPlugin) handle.getInstance()).enterAutomaticPictureInPictureIfEnabled();
        }
    }

    @Override
    public void onPictureInPictureUiStateChanged(PictureInPictureUiState state) {
        super.onPictureInPictureUiStateChanged(state);
        if (Build.VERSION.SDK_INT >= 35 && state.isTransitioningToPip()) {
            AndroidUiPlugin plugin = (AndroidUiPlugin) getBridge().getPlugin("AndroidUi").getInstance();
            plugin.notifyPictureInPictureEntering();
            plugin.preparePictureInPictureSurface();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(
        boolean isInPictureInPictureMode,
        Configuration newConfig
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        appLock.onPictureInPictureModeChanged(isInPictureInPictureMode);
        notifyPictureInPictureState(isInPictureInPictureMode, newConfig);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (bridge == null) return;
        if (hasFocus) {
            // System gestures can reveal the bars without changing player controls.
            bridge.triggerWindowJSEvent("opentubex:android-window-focus");
        } else {
            // Recents keeps the app resumed, so this is the last event before a
            // swipe there removes the task and Android ends the process.
            bridge.triggerWindowJSEvent("opentubex:android-window-blur");
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // A PiP exit can happen while Chromium is suspended behind the lock
        // screen. Reconcile both layers with the Activity's current state.
        notifyPictureInPictureState(isInPictureInPictureMode(), getResources().getConfiguration());
        LauncherActivity.finishReturn();
        appLock.onResume();
    }

    private void notifyPictureInPictureState(boolean active, Configuration config) {
        // The callback's configuration describes the destination on PiP exit,
        // while WebView's outerWidth still describes the small PiP window.
        ((AndroidUiPlugin) getBridge().getPlugin("AndroidUi").getInstance()).onPictureInPictureModeChanged(active, () -> {
            getBridge().triggerWindowJSEvent("opentubex:android-pip",
                "{\"active\":" + active + ",\"windowWidth\":" + config.screenWidthDp +
                    ",\"windowHeight\":" + config.screenHeightDp + "}"
            );
        });
    }

    /**
     * By default, swiped bars stay visible so a second swipe can open notifications,
     * and the player hides the status bar again with its controls. Transient bars
     * hide again on their own, for players that keep the status bar hidden.
     */
    void setTransientSystemBars(boolean transientBars) {
        transientSystemBars = transientBars;
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
            .setSystemBarsBehavior(transientBars
                ? WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                : WindowInsetsControllerCompat.BEHAVIOR_DEFAULT);
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        if (statusBarSwipeFilter == null) {
            statusBarSwipeFilter = new StatusBarSwipeFilter(ViewConfiguration.get(this).getScaledTouchSlop());
        }
        int action = event.getActionMasked();
        boolean fromStatusBar = action == MotionEvent.ACTION_DOWN && transientSystemBars &&
            event.getRawY() < statusBarHeight();
        switch (statusBarSwipeFilter.onTouch(action, event.getRawX(), event.getRawY(), fromStatusBar)) {
            case DROP:
                return true;
            case CANCEL:
                MotionEvent cancel = MotionEvent.obtain(event);
                cancel.setAction(MotionEvent.ACTION_CANCEL);
                super.dispatchTouchEvent(cancel);
                cancel.recycle();
                return true;
            default:
                return super.dispatchTouchEvent(event);
        }
    }

    private int statusBarHeight() {
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(getWindow().getDecorView());
        return insets == null ? 0 : insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.statusBars()).top;
    }

    void prepareFullscreenRotation() {
        if (getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE
            || isInPictureInPictureMode()) return;
        if (rotationFrame != null) rotationFrame.run();
        rotationFrame = new WebViewRotationFrame(getBridge().getWebView(), true);
    }

    // Chromium hands fullscreen to a custom view, which Capacitor returns at
    // once. Recreating the WebView's renderer surface draws an empty page and
    // then the inline page before the fullscreen layout, so cover the WebView
    // with its current pixels until the fullscreen layout is ready to draw.
    void coverFullscreenEntry(Runnable done) {
        removeFullscreenCover(fullscreenCover);
        // A newer request replaces a copy that is still pending.
        int request = ++fullscreenCoverRequest;
        WebView webView = getBridge().getWebView();
        if (isInPictureInPictureMode()) {
            done.run();
            return;
        }
        WebViewScreenshot.copyVisible(this, webView, bitmap -> {
            ViewGroup content = findViewById(android.R.id.content);
            if (request == fullscreenCoverRequest && webView.isAttachedToWindow() && content != null) {
                ImageView cover = new ImageView(this);
                cover.setImageBitmap(bitmap);
                cover.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                int[] webViewLocation = new int[2];
                int[] contentLocation = new int[2];
                webView.getLocationInWindow(webViewLocation);
                content.getLocationInWindow(contentLocation);
                cover.setTranslationX(webViewLocation[0] - contentLocation[0]);
                cover.setTranslationY(webViewLocation[1] - contentLocation[1]);
                content.addView(cover, new FrameLayout.LayoutParams(bitmap.getWidth(), bitmap.getHeight()));
                fullscreenCover = cover;
                // Never hide the page for long when fullscreen does not finish.
                cover.postDelayed(() -> removeFullscreenCover(cover), 2000);
            }
            done.run();
        }, error -> done.run());
    }

    void uncoverFullscreenEntry() {
        ImageView cover = fullscreenCover;
        if (cover == null) return;
        // The next draw after this callback includes the fullscreen layout.
        getBridge().getWebView().postVisualStateCallback(0, new WebView.VisualStateCallback() {
            @Override
            public void onComplete(long requestId) {
                removeFullscreenCover(cover);
            }
        });
    }

    private void removeFullscreenCover(ImageView cover) {
        if (cover == null || fullscreenCover != cover) return;
        fullscreenCover = null;
        ((ViewGroup) cover.getParent()).removeView(cover);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);

        if (newConfig.orientation != lastOrientation) {
            lastOrientation = newConfig.orientation;
            if (rotationFrame != null) rotationFrame.run();
            // PiP has its own viewport/surface synchronization.
            rotationFrame = isInPictureInPictureMode() ? null : new WebViewRotationFrame(getBridge().getWebView());
        }

        notifyHardwareKeyboardState();
    }

    private void notifyHardwareKeyboardState() {
        PluginHandle handle = getBridge().getPlugin("AndroidUi");
        if (handle != null && handle.getInstance() instanceof AndroidUiPlugin) {
            boolean attached = ((AndroidUiPlugin) handle.getInstance()).hasHardwareKeyboard();
            getBridge().triggerWindowJSEvent(
                "opentubex:hardware-keyboard",
                "{\"attached\":" + attached + "}"
            );
        }
    }
}
