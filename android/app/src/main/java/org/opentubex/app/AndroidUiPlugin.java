package org.opentubex.app;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.content.res.Configuration;
import android.hardware.input.InputManager;
import android.graphics.Color;
import android.os.Build;
import android.util.Rational;
import android.view.InputDevice;
import android.view.OrientationEventListener;
import android.view.Surface;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidUi")
public class AndroidUiPlugin extends Plugin {
    private boolean autoPictureInPictureEnabled = false;
    private Rational pictureInPictureAspectRatio = new Rational(16, 9);
    private PictureInPictureSurface pictureInPictureSurface;
    private Rect pictureInPictureSourceRect;
    private boolean pictureInPictureScrollbarsHidden;
    private boolean fullscreenScrollbarsHidden;
    private boolean pageScrollbarsHidden;
    private boolean restoreVerticalScrollBar;
    private boolean restoreHorizontalScrollBar;
    private OrientationEventListener deviceRotationListener;
    private boolean deviceRotationEnabled;
    private Boolean deviceLandscape;

    @PluginMethod
    public void setDeviceRotationEnabled(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            deviceRotationEnabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
            if (deviceRotationEnabled) {
                if (deviceRotationListener == null) {
                    deviceRotationListener = new OrientationEventListener(getContext()) {
                        @Override
                        public void onOrientationChanged(int orientation) {
                            int rotation = getActivity().getWindowManager().getDefaultDisplay().getRotation();
                            boolean displayLandscape = getActivity().getResources().getConfiguration().orientation
                                == Configuration.ORIENTATION_LANDSCAPE;
                            // Refresh the natural basis when the activity's display changes.
                            boolean naturalLandscape = displayLandscape
                                ^ (rotation == Surface.ROTATION_90 || rotation == Surface.ROTATION_270);
                            Boolean landscape = landscapeForDeviceOrientation(orientation, naturalLandscape);
                            if (landscape == null || landscape.equals(deviceLandscape)) return;
                            deviceLandscape = landscape;
                            notifyListeners("deviceRotationChange", new JSObject().put("landscape", landscape));
                        }
                    };
                }
                if (!deviceRotationListener.canDetectOrientation()) {
                    deviceRotationEnabled = false;
                    call.reject("Device orientation sensing is unavailable");
                    return;
                }
                deviceLandscape = null;
                deviceRotationListener.enable();
            } else if (deviceRotationListener != null) {
                deviceRotationListener.disable();
            }
            call.resolve();
        });
    }

    // Leave a gap between portrait and landscape to avoid toggling near diagonals.
    static Boolean landscapeForDeviceOrientation(int orientation, boolean naturalLandscape) {
        if (orientation == OrientationEventListener.ORIENTATION_UNKNOWN) return null;
        int angle = orientation % 180;
        if (angle <= 20 || angle >= 160) return naturalLandscape;
        if (angle >= 70 && angle <= 110) return !naturalLandscape;
        return null;
    }

    @Override
    protected void handleOnPause() {
        if (deviceRotationListener != null) deviceRotationListener.disable();
    }

    @Override
    protected void handleOnResume() {
        if (deviceRotationEnabled && deviceRotationListener != null) {
            deviceLandscape = null;
            deviceRotationListener.enable();
        }
    }

    @PluginMethod
    public void setAlwaysShowScrollbars(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            android.webkit.WebView view = getBridge().getWebView();
            view.setScrollbarFadingEnabled(!enabled);
            view.invalidate();
            call.resolve();
        });
    }

    @PluginMethod
    public void setPageScrollbarsHidden(PluginCall call) {
        boolean hidden = Boolean.TRUE.equals(call.getBoolean("hidden", false));
        getActivity().runOnUiThread(() -> {
            fullscreenScrollbarsHidden = hidden;
            updatePageScrollbars();
            call.resolve();
        });
    }

    @PluginMethod
    public void setSystemBarsBackground(PluginCall call) {
        final int color;
        try {
            color = com.getcapacitor.util.WebColor.parseColor(call.getString("color", "#000000"));
        } catch (IllegalArgumentException error) {
            call.reject("Invalid system bar background color", error);
            return;
        }
        getActivity().runOnUiThread(() -> {
            boolean followSystem = Boolean.TRUE.equals(call.getBoolean("followSystem"));
            StartupBackground.save(getContext(), color, followSystem);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Android creates the splash window before onCreate can read our cache.
                // Persist the app's brightness without changing the phone's night mode.
                double brightness = 0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color);
                getContext().getSystemService(UiModeManager.class).setApplicationNightMode(followSystem
                    ? UiModeManager.MODE_NIGHT_AUTO
                    : brightness > 127.5 ? UiModeManager.MODE_NIGHT_NO : UiModeManager.MODE_NIGHT_YES);
            }
            StartupBackground.apply(getActivity().getWindow(), color);
            call.resolve();
        });
    }

    @PluginMethod
    public void getPictureInPictureSupport(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", supportsPictureInPicture());
        result.put("automaticSupported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S);
        call.resolve(result);
    }

    @PluginMethod
    public void isLauncherReturnInProgress(PluginCall call) {
        call.resolve(new JSObject().put("inProgress", LauncherActivity.isReturningToApp()));
    }

    @PluginMethod
    public void enterPictureInPicture(PluginCall call) {
        updateAspectRatio(call);
        getActivity().runOnUiThread(() -> {
            if (!supportsPictureInPicture()) {
                call.reject("Picture-in-Picture is not supported on this device");
                return;
            }

            updateSourceRect(call);
            getBridge().triggerWindowJSEvent("opentubex:android-pip",
                "{\"active\":true,\"transitioning\":true}");
            setPictureInPictureScrollbars(true);
            surface().prepare(pictureInPictureSourceRect);
            if (getActivity().isFinishing() || getActivity().isDestroyed()) {
                cancelPictureInPictureEntry();
                call.reject("Activity closed before Picture-in-Picture entry");
                return;
            }
            if (getActivity().isInPictureInPictureMode()) {
                call.resolve();
                return;
            }
            try {
                boolean entered = PictureInPicture.enter(
                    getActivity(),
                    pictureInPictureAspectRatio,
                    false,
                    pictureInPictureSourceRect
                );
                if (entered) {
                    call.resolve();
                } else {
                    cancelPictureInPictureEntry();
                    call.reject("Android rejected the Picture-in-Picture request");
                }
            } catch (IllegalStateException error) {
                // The user can leave before the queued native request runs.
                cancelPictureInPictureEntry();
                call.reject("Activity is no longer resumed for Picture-in-Picture entry", error);
            }
        });
    }

    @PluginMethod
    public void setAutoPictureInPicture(PluginCall call) {
        autoPictureInPictureEnabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        updateAspectRatio(call);
        getActivity().runOnUiThread(() -> {
            if (supportsPictureInPicture()) {
                updateSourceRect(call);
                PictureInPicture.configure(
                    getActivity(),
                    pictureInPictureAspectRatio,
                    autoPictureInPictureEnabled && pictureInPictureSourceRect != null,
                    pictureInPictureSourceRect
                );
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void updatePictureInPictureSourceRect(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (supportsPictureInPicture() && !getActivity().isInPictureInPictureMode()) {
                updateSourceRect(call);
                PictureInPicture.configure(getActivity(), pictureInPictureAspectRatio,
                    autoPictureInPictureEnabled && pictureInPictureSourceRect != null, pictureInPictureSourceRect);
            }
            call.resolve();
        });
    }

    private void updateSourceRect(PluginCall call) {
        // Preserve the in-app destination while PiP exits: its mode callback
        // precedes the full-size WebView layout and window focus returning.
        if (getActivity().isInPictureInPictureMode() ||
            (pictureInPictureSurface != null && pictureInPictureSurface.isPrepared())) return;
        JSObject source = call.getObject("sourceRect");
        if (source == null) {
            pictureInPictureSourceRect = null;
            return;
        }
        if (!getActivity().hasWindowFocus()) return;
        double viewportWidth = source.optDouble("viewportWidth", 0);
        double x = source.optDouble("x", Double.NaN);
        double y = source.optDouble("y", Double.NaN);
        double width = source.optDouble("width", 0);
        double height = source.optDouble("height", 0);
        if (!Double.isFinite(viewportWidth) || viewportWidth <= 0 ||
            !Double.isFinite(x) || !Double.isFinite(y) ||
            !Double.isFinite(width) || width <= 0 || !Double.isFinite(height) || height <= 0) return;
        // CSS pixels include the app's UI scale; Android expects window pixels.
        android.webkit.WebView view = getBridge().getWebView();
        double scale = view.getWidth() / viewportWidth;
        int[] location = new int[2];
        view.getLocationInWindow(location);
        Rect rect = new Rect(
            location[0] + (int) Math.round(x * scale),
            location[1] + (int) Math.round(y * scale),
            location[0] + (int) Math.round((x + width) * scale),
            location[1] + (int) Math.round((y + height) * scale)
        );
        if (!rect.isEmpty()) pictureInPictureSourceRect = rect;
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            call.resolve();
            getActivity().finishAndRemoveTask();
        });
    }

    @PluginMethod
    public void restartApp(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Intent intent = new Intent(getContext(), RestartActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK)
                .putExtra(RestartActivity.EXTRA_PROCESS_ID, android.os.Process.myPid());
            try {
                getActivity().startActivity(intent);
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("Unable to restart app", error);
            }
        });
    }

    @PluginMethod
    public void getHardwareKeyboardState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("attached", hasHardwareKeyboard());
        call.resolve(result);
    }

    @PluginMethod
    public void getDeviceArchitecture(PluginCall call) {
        JSObject result = new JSObject();
        result.put(
            "architecture",
            Build.SUPPORTED_ABIS.length == 0 ? "" : Build.SUPPORTED_ABIS[0]
        );
        call.resolve(result);
    }

    public boolean hasHardwareKeyboard() {
        InputManager inputManager = (InputManager) getContext()
            .getSystemService(Context.INPUT_SERVICE);
        for (int deviceId : inputManager.getInputDeviceIds()) {
            InputDevice device = inputManager.getInputDevice(deviceId);
            if (isHardwareKeyboardDevice(device)) {
                return true;
            }
        }
        return false;
    }

    static boolean isHardwareKeyboardDevice(InputDevice device) {
        return device != null && isHardwareKeyboardDevice(
            device.isVirtual(),
            device.getKeyboardType()
        );
    }

    static boolean isHardwareKeyboardDevice(boolean virtual, int keyboardType) {
        return !virtual && keyboardType == InputDevice.KEYBOARD_TYPE_ALPHABETIC;
    }

    public void enterAutomaticPictureInPictureIfEnabled() {
        if (
            !autoPictureInPictureEnabled ||
            pictureInPictureSourceRect == null ||
            !supportsPictureInPicture() ||
            getActivity().isInPictureInPictureMode()
        ) {
            return;
        }

        if (Build.VERSION.SDK_INT >= 35) {
            preparePictureInPictureSurface();
            return;
        }
        getBridge().triggerWindowJSEvent("opentubex:android-pip",
            "{\"active\":true,\"transitioning\":true}");
        preparePictureInPictureSurface();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return;
        boolean entered = false;
        try {
            entered = PictureInPicture.enter(getActivity(), pictureInPictureAspectRatio, false,
                pictureInPictureSourceRect);
        } finally {
            if (!entered) {
                cancelPictureInPictureEntry();
            }
        }
    }

    private PictureInPictureSurface surface() {
        if (pictureInPictureSurface == null) {
            pictureInPictureSurface = new PictureInPictureSurface(getActivity(), getBridge().getWebView());
        }
        return pictureInPictureSurface;
    }

    void preparePictureInPictureSurface() {
        // Pin the live viewport before automatic entry starts resizing it.
        setPictureInPictureScrollbars(true);
        surface().prepare(pictureInPictureSourceRect);
    }

    private void cancelPictureInPictureEntry() {
        surface().clear();
        setPictureInPictureScrollbars(false);
        getBridge().triggerWindowJSEvent("opentubex:android-pip", "{\"active\":false}");
    }

    private void setPictureInPictureScrollbars(boolean active) {
        pictureInPictureScrollbarsHidden = active;
        updatePageScrollbars();
    }

    private void updatePageScrollbars() {
        android.webkit.WebView view = getBridge().getWebView();
        boolean hidden = fullscreenScrollbarsHidden || pictureInPictureScrollbarsHidden;
        if (hidden && !pageScrollbarsHidden) {
            restoreVerticalScrollBar = view.isVerticalScrollBarEnabled();
            restoreHorizontalScrollBar = view.isHorizontalScrollBarEnabled();
            view.setVerticalScrollBarEnabled(false);
            view.setHorizontalScrollBarEnabled(false);
            pageScrollbarsHidden = true;
        } else if (!hidden && pageScrollbarsHidden) {
            view.setVerticalScrollBarEnabled(restoreVerticalScrollBar);
            view.setHorizontalScrollBarEnabled(restoreHorizontalScrollBar);
            pageScrollbarsHidden = false;
        }
    }

    void onPictureInPictureModeChanged(boolean active, Runnable notifyRenderer) {
        Runnable complete = () -> {
            setPictureInPictureScrollbars(active);
            notifyRenderer.run();
        };
        if (pictureInPictureSurface != null) pictureInPictureSurface.onModeChanged(active, complete);
        else complete.run();
    }

    @Override
    protected void handleOnDestroy() {
        if (deviceRotationListener != null) deviceRotationListener.disable();
        if (pictureInPictureSurface != null) pictureInPictureSurface.clear();
        super.handleOnDestroy();
    }

    private boolean supportsPictureInPicture() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    private void updateAspectRatio(PluginCall call) {
        int width = Math.max(1, call.getInt("width", 16));
        int height = Math.max(1, call.getInt("height", 9));
        double ratio = (double) width / height;

        // Android only accepts PiP aspect ratios between 1:2.39 and 2.39:1.
        if (ratio >= (1.0 / 2.39) && ratio <= 2.39) {
            pictureInPictureAspectRatio = new Rational(width, height);
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private static final class PictureInPicture {
        private PictureInPicture() {}

        static boolean enter(Activity activity, Rational aspectRatio, boolean automatic, Rect sourceRect) {
            return activity.enterPictureInPictureMode(buildParams(aspectRatio, automatic, sourceRect));
        }

        static void configure(Activity activity, Rational aspectRatio, boolean automatic, Rect sourceRect) {
            activity.setPictureInPictureParams(buildParams(aspectRatio, automatic, sourceRect));
        }

        private static PictureInPictureParams buildParams(
            Rational aspectRatio,
            boolean automatic,
            Rect sourceRect
        ) {
            PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
                .setAspectRatio(aspectRatio)
                .setSourceRectHint(sourceRect);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                builder.setAutoEnterEnabled(automatic);
                builder.setSeamlessResizeEnabled(true);
            }

            return builder.build();
        }
    }
}
