package org.opentubex.app;

import android.content.res.Configuration;
import android.os.Bundle;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onStart() {
        super.onStart();
        AppVisibility.setVisible(true);
    }

    @Override
    public void onStop() {
        AppVisibility.setVisible(false);
        super.onStop();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PoTokenPlugin.class);
        registerPlugin(AndroidUiPlugin.class);
        registerPlugin(AndroidMediaSessionPlugin.class);
        registerPlugin(SubscriptionRefreshPlugin.class);
        registerPlugin(SabrHttpPlugin.class);
        super.onCreate(savedInstanceState);
        // Capacitor falls back to addJavascriptInterface when the modern,
        // top-frame-only bridge is unavailable. Fail closed instead of
        // exposing native plugins to untrusted subframes.
        getBridge().getWebView().removeJavascriptInterface("androidBridge");
        getBridge().setWebViewClient(new OpenTubeXWebViewClient(getBridge()));

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                getBridge().triggerWindowJSEvent("opentubex:android-back");
            }
        });
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
    public void onPictureInPictureModeChanged(
        boolean isInPictureInPictureMode,
        Configuration newConfig
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        getBridge().triggerWindowJSEvent(
            "opentubex:android-pip",
            "{\"active\":" + isInPictureInPictureMode + "}"
        );
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);

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
