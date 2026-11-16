package org.opentubex.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/** Encrypts the app's saved passwords and tokens with {@link SecretStorage}. */
@CapacitorPlugin(name = "SecretStorage")
public final class SecretStoragePlugin extends Plugin {
    @PluginMethod public void encrypt(PluginCall call) {
        try {
            JSONArray values = call.getArray("values", new JSArray());
            JSArray result = new JSArray();
            for (int index = 0; index < values.length(); index++) result.put(SecretStorage.encrypt(values.getString(index)));
            call.resolve(new JSObject().put("values", result));
        } catch (Exception error) {
            call.reject("Unable to encrypt", error);
        }
    }

    /** Resolves null for each value this installation cannot decrypt. */
    @PluginMethod public void decrypt(PluginCall call) {
        try {
            JSONArray values = call.getArray("values", new JSArray());
            JSArray result = new JSArray();
            for (int index = 0; index < values.length(); index++) {
                String text = SecretStorage.decrypt(values.getString(index));
                result.put(text == null ? JSONObject.NULL : text);
            }
            call.resolve(new JSObject().put("values", result));
        } catch (Exception error) {
            call.reject("Unable to decrypt", error);
        }
    }
}
