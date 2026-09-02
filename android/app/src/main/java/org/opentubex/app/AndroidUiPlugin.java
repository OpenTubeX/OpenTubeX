package org.opentubex.app;

import android.app.PictureInPictureParams;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.res.Configuration;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Rational;

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
    public void getPictureInPictureSupport(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", supportsPictureInPicture());
        result.put("automaticSupported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S);
        call.resolve(result);
    }

    @PluginMethod
    public void enterPictureInPicture(PluginCall call) {
        updateAspectRatio(call);
        getActivity().runOnUiThread(() -> {
            if (!supportsPictureInPicture()) {
                call.reject("Picture-in-Picture is not supported on this device");
                return;
            }

            boolean entered = getActivity().enterPictureInPictureMode(buildPictureInPictureParams(false));
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
                getActivity().setPictureInPictureParams(
                    buildPictureInPictureParams(autoPictureInPictureEnabled)
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
    public void setFullscreenOrientation(PluginCall call) {
        boolean landscape = Boolean.TRUE.equals(call.getBoolean("landscape", false));
        getActivity().runOnUiThread(() -> {
            getActivity().setRequestedOrientation(
                landscape
                    ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            );
            call.resolve();
        });
    }

    @PluginMethod
    public void getHardwareKeyboardState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("attached", hasHardwareKeyboard());
        call.resolve(result);
    }

    @PluginMethod
    public void writeClipboard(PluginCall call) {
        String text = call.getString("text");
        if (text == null) {
            call.reject("Clipboard text is required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            ClipboardManager clipboard = (ClipboardManager) getContext()
                .getSystemService(Context.CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(ClipData.newPlainText("OpenTubeX", text));
            call.resolve();
        });
    }

    public boolean hasHardwareKeyboard() {
        Configuration configuration = getContext().getResources().getConfiguration();
        return configuration.keyboard != Configuration.KEYBOARD_NOKEYS &&
            configuration.hardKeyboardHidden != Configuration.HARDKEYBOARDHIDDEN_YES;
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

        getActivity().enterPictureInPictureMode(buildPictureInPictureParams(false));
    }

    private boolean supportsPictureInPicture() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    private PictureInPictureParams buildPictureInPictureParams(boolean automatic) {
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
            .setAspectRatio(pictureInPictureAspectRatio);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(automatic);
            builder.setSeamlessResizeEnabled(true);
        }

        return builder.build();
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
}
