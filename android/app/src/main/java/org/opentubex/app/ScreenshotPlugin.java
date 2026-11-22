package org.opentubex.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import android.util.Base64;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

@CapacitorPlugin(name = "Screenshot")
public class ScreenshotPlugin extends Plugin {
    private final ExecutorService thumbnails = Executors.newSingleThreadExecutor();

    @Override
    protected void handleOnDestroy() {
        thumbnails.shutdown();
        super.handleOnDestroy();
    }

    private void takeThumbnail(PluginCall call) {
        int width = call.getInt("width", 640);
        int height = call.getInt("height", 360);
        if (width < 1 || width > 640 || height < 1 || height > 640) {
            call.reject("Thumbnail dimensions must be between 1 and 640");
            return;
        }
        getActivity().runOnUiThread(() -> WebViewScreenshot.capture(
            getActivity(), getBridge().getWebView(), call.getDouble("top", 0.0),
            call.getDouble("cropHeight", 1.0), width, height, bitmap -> {
                try {
                    thumbnails.execute(() -> {
                        try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                            if (!bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 70, output)) {
                                throw new IOException("Could not encode thumbnail");
                            }
                            JSObject result = new JSObject();
                            result.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
                            call.resolve(result);
                        } catch (Exception error) {
                            call.reject("Could not encode thumbnail", error);
                        } finally {
                            bitmap.recycle();
                        }
                    });
                } catch (RejectedExecutionException error) {
                    bitmap.recycle();
                    call.reject("Screenshot plugin stopped", error);
                }
            }, error -> call.reject("Could not capture thumbnail", error)
        ));
    }

    @PluginMethod
    public void take(PluginCall call) {
        if (call.hasOption("width")) {
            takeThumbnail(call);
            return;
        }
        getActivity().runOnUiThread(() -> WebViewScreenshot.capture(
            getActivity(), getBridge().getWebView(),
            bitmap -> getBridge().execute(() -> {
                File screenshot = null;
                try {
                    screenshot = File.createTempFile("tab-preview-", ".jpg", getContext().getCacheDir());
                    try (FileOutputStream output = new FileOutputStream(screenshot)) {
                        if (!bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, output)) {
                            throw new IOException("Could not encode screenshot");
                        }
                    }
                    JSObject result = new JSObject();
                    result.put("uri", screenshot.getAbsolutePath());
                    call.resolve(result);
                } catch (Exception error) {
                    if (screenshot != null) screenshot.delete();
                    call.reject("Could not save screenshot", error);
                } finally {
                    bitmap.recycle();
                }
            }),
            error -> call.reject("Could not capture screenshot", error)
        ));
    }
}
