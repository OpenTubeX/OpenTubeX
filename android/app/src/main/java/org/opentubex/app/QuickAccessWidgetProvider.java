package org.opentubex.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Opens Search, Subscriptions or Watch Later without showing any watch history. */
public class QuickAccessWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, HomeWidgets.quickAccess(context));
    }
}
