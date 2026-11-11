package org.opentubex.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

import java.time.LocalDate;

/** Shows watch time for the last seven days and moves on to a new day at midnight. */
public class WatchTimeWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, HomeWidgets.watchTime(context, LocalDate.now()));
        HomeWidgets.scheduleMidnightUpdate(context);
    }

    @Override
    public void onDisabled(Context context) {
        HomeWidgets.cancelMidnightUpdate(context);
    }
}
