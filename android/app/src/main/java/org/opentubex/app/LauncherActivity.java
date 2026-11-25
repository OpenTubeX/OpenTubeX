package org.opentubex.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;

/** Keeps the running task independent of launcher aliases that can be disabled. */
public class LauncherActivity extends Activity {
    private static long returnDeadline;

    static synchronized void beginReturn() {
        returnDeadline = SystemClock.elapsedRealtime() + 10_000;
    }

    static synchronized boolean isReturningToApp() {
        return returnDeadline > SystemClock.elapsedRealtime();
    }

    static synchronized void finishReturn() {
        returnDeadline = 0;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        beginReturn();
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        finish();
    }
}
