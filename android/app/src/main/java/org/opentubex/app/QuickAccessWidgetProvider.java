package org.opentubex.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

import java.util.ArrayList;
import java.util.List;

/** Opens up to four chosen pages without showing any watch history. */
public class QuickAccessWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, HomeWidgets.quickAccess(context, HomeWidgets.quickAccessPages(context, id)));
    }

    /** Restored widgets get new IDs; keep the pages chosen under their old ones. */
    @Override
    public void onRestored(Context context, int[] oldIds, int[] newIds) {
        // Read every selection first, since a new ID can equal another widget's old one.
        List<List<HomeWidgets.Page>> pages = new ArrayList<>();
        for (int id : oldIds) pages.add(HomeWidgets.quickAccessPages(context, id));
        HomeWidgets.removeQuickAccessPages(context, oldIds);
        for (int index = 0; index < newIds.length; index++) HomeWidgets.setQuickAccessPages(context, newIds[index], pages.get(index));
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        HomeWidgets.removeQuickAccessPages(context, ids);
    }
}
