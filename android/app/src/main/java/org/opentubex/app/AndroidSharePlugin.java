package org.opentubex.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidShare")
public class AndroidSharePlugin extends Plugin {
    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (!Intent.ACTION_SEND.equals(intent.getAction()) || !"text/plain".equals(intent.getType())) {
            return;
        }
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null || text.length() == 0) {
            return;
        }
        // Capacitor also delivers the initial launch intent here. Retain it until
        // the renderer subscribes, and prevent Activity recreation from replaying it.
        intent.removeExtra(Intent.EXTRA_TEXT);
        JSObject data = new JSObject();
        data.put("text", text.toString());
        notifyListeners("sharedText", data, true);
    }
}
