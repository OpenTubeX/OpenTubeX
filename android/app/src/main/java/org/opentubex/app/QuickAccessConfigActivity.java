package org.opentubex.app;

import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import java.util.ArrayList;
import java.util.List;

/** Lets the user choose the Quick access pages when adding or reconfiguring the widget. */
public class QuickAccessConfigActivity extends AppCompatActivity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bundle extras = getIntent().getExtras();
        if (extras != null) widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_CANCELED, result());
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }

        List<HomeWidgets.Page> pages = HomeWidgets.Page.available();
        List<HomeWidgets.Page> selected = HomeWidgets.quickAccessPages(this, widgetId);
        String[] labels = new String[pages.size()];
        boolean[] checked = new boolean[pages.size()];
        for (int index = 0; index < pages.size(); index++) {
            labels[index] = getString(pages.get(index).label);
            checked[index] = selected.contains(pages.get(index));
        }
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle(R.string.widget_quick_access_choose)
            .setMultiChoiceItems(labels, checked, (shown, which, isChecked) -> {
                AlertDialog alert = (AlertDialog) shown;
                if (isChecked && count(checked) > HomeWidgets.MAX_QUICK_ACCESS_PAGES) {
                    checked[which] = false;
                    alert.getListView().setItemChecked(which, false);
                }
                alert.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(count(checked) > 0);
            })
            .setPositiveButton(android.R.string.ok, (shown, which) -> {
                List<HomeWidgets.Page> chosen = new ArrayList<>();
                for (int index = 0; index < pages.size(); index++) if (checked[index]) chosen.add(pages.get(index));
                HomeWidgets.setQuickAccessPages(this, widgetId, chosen);
                AppWidgetManager.getInstance(this).updateAppWidget(widgetId, HomeWidgets.quickAccess(this, chosen));
                setResult(RESULT_OK, result());
            })
            .setNegativeButton(android.R.string.cancel, null)
            .create();
        dialog.setOnDismissListener(shown -> finish());
        dialog.show();
    }

    private Intent result() {
        return new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
    }

    private static int count(boolean[] values) {
        int count = 0;
        for (boolean value : values) if (value) count++;
        return count;
    }
}
