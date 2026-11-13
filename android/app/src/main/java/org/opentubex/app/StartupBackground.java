package org.opentubex.app;

import android.content.Context;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.view.Window;

/** The native surface is visible before the settings database and renderer load. */
final class StartupBackground {
    private static final String PREFERENCES = "startup-background";

    private static String systemMode(Context context) {
        return (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES ? "dark" : "light";
    }

    static int getColor(Context context) {
        var preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        String mode = systemMode(context);
        String key = preferences.getBoolean("followSystem", true) ? mode : "fixed";
        return preferences.getInt(key, context.getColor(R.color.startup_background));
    }

    static void save(Context context, int color, boolean followSystem) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
            .putBoolean("followSystem", followSystem)
            .putInt(followSystem ? systemMode(context) : "fixed", color)
            .apply();
    }

    static void apply(Window window, int color) {
        // SystemBars reapplies the OS background on style/rotation changes.
        // Retain the app color through those updates and native inset padding.
        window.getDecorView().setBackgroundTintList(ColorStateList.valueOf(color));
        window.getDecorView().setBackgroundColor(color);
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);
    }
}
