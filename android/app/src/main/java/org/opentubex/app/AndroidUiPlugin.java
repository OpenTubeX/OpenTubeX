package org.opentubex.app;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.input.InputManager;
import android.graphics.Color;
import android.os.Build;
import android.util.Rational;
import android.view.InputDevice;

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

            boolean entered = PictureInPicture.enter(
                getActivity(),
                pictureInPictureAspectRatio,
                false
            );
            if (entered) {
                call.resolve();
            } else {
                call.reject("Android rejected the Picture-in-Picture request");
            }
        });
    }

    @PluginMethod
    public void setAutoPictureInPicture(PluginCall call) {
        autoPictureInPictureEnabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        updateAspectRatio(call);
        getActivity().runOnUiThread(() -> {
            if (supportsPictureInPicture()) {
                PictureInPicture.configure(
                    getActivity(),
                    pictureInPictureAspectRatio,
                    autoPictureInPictureEnabled
                );
            }
            call.resolve();
        });
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
            !supportsPictureInPicture() ||
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ||
            getActivity().isInPictureInPictureMode()
        ) {
            return;
        }

        // Android 8 can rotate the WebView before its PiP mode callback arrives.
        // Preserve fullscreen through that configuration change, as manual entry does.
        getBridge().triggerWindowJSEvent("opentubex:android-pip", "{\"active\":true}");
        boolean entered = false;
        try {
            entered = PictureInPicture.enter(getActivity(), pictureInPictureAspectRatio, false);
        } finally {
            if (!entered) {
                getBridge().triggerWindowJSEvent("opentubex:android-pip", "{\"active\":false}");
            }
        }
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

        static boolean enter(Activity activity, Rational aspectRatio, boolean automatic) {
            return activity.enterPictureInPictureMode(buildParams(aspectRatio, automatic));
        }

        static void configure(Activity activity, Rational aspectRatio, boolean automatic) {
            activity.setPictureInPictureParams(buildParams(aspectRatio, automatic));
        }

        private static PictureInPictureParams buildParams(
            Rational aspectRatio,
            boolean automatic
        ) {
            PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
                .setAspectRatio(aspectRatio);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                builder.setAutoEnterEnabled(automatic);
                builder.setSeamlessResizeEnabled(true);
            }

            return builder.build();
        }
    }
}
