package org.opentubex.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** Keeps the running task independent of launcher aliases that can be disabled. */
public class LauncherActivity extends Activity {
    private static boolean returningToApp;

    static synchronized void beginReturn() {
        returningToApp = true;
    }

    static synchronized boolean isReturningToApp() {
        return returningToApp;
    }

    static synchronized void finishReturn() {
        returningToApp = false;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        beginReturn();
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        finish();
    }
}
