package org.opentubex.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Opens up to four chosen pages without showing any watch history. */
public class QuickAccessWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, HomeWidgets.quickAccess(context, HomeWidgets.quickAccessPages(context, id)));
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        HomeWidgets.removeQuickAccessPages(context, ids);
    }
}
