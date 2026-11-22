package org.opentubex.app;

import android.content.res.Configuration;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidDynamicColors")
public class AndroidDynamicColorsPlugin extends Plugin {
    @PluginMethod
    public void getColors(PluginCall call) {
        call.resolve(readColors());
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration configuration) {
        notifyListeners("dynamicColorsChanged", readColors());
    }

    @Override
    protected void handleOnResume() {
        notifyListeners("dynamicColorsChanged", readColors());
    }

    private JSObject readColors() {
        JSObject result = new JSObject();
        result.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return result;

        JSObject palette = new JSObject();
        String[] families = { "accent1", "accent2", "accent3", "neutral1", "neutral2" };
        int[] tones = { 0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000 };
        for (String family : families) {
            JSObject colors = new JSObject();
            for (int tone : tones) {
                int id = getContext().getResources().getIdentifier(
                    "system_" + family + "_" + tone, "color", "android"
                );
                colors.put(Integer.toString(tone), String.format(
                    java.util.Locale.ROOT, "#%06x", getContext().getColor(id) & 0xffffff
                ));
            }
            palette.put(family, colors);
        }
        result.put("palette", palette);
        return result;
    }
}
