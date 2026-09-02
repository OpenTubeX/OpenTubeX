package org.opentubex.app;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URL;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

@CapacitorPlugin(name = "SabrHttp")
public class SabrHttpPlugin extends Plugin {
    private final SabrRequestRegistry registry = SabrRequestRegistry.shared();

    @PluginMethod
    public void prepare(PluginCall call) {
        String urlString = call.getString("url");
        String encodedBody = call.getString("body");
        JSObject headers = call.getObject("headers", new JSObject());

        URL url;
        try {
            url = new URL(urlString == null ? "" : urlString);
        } catch (Exception exception) {
            call.reject("Invalid SABR URL");
            return;
        }

        if (encodedBody == null || !isAllowedUrl(url)) {
            call.reject("Invalid SABR request");
            return;
        }

        byte[] body;
        try {
            body = Base64.decode(encodedBody, Base64.DEFAULT);
        } catch (IllegalArgumentException exception) {
            call.reject("Invalid SABR request body");
            return;
        }

        Map<String, String> requestHeaders = new HashMap<>();
        Iterator<String> headerNames = headers.keys();
        while (headerNames.hasNext()) {
            String name = headerNames.next();
            String value = headers.getString(name);
            if (value != null) {
                requestHeaders.put(name, value);
            }
        }

        String requestId = registry.prepare(url, body, requestHeaders);

        JSObject result = new JSObject();
        result.put("requestId", requestId);
        call.resolve(result);
    }

    @PluginMethod
    public void abort(PluginCall call) {
        String requestId = call.getString("requestId");
        if (requestId != null) {
            registry.discard(requestId);
        }
        call.resolve();
    }

    static boolean isAllowedUrl(URL url) {
        return SabrRequestRegistry.isAllowedUrl(url);
    }

    @Override
    protected void handleOnDestroy() {
        registry.clear();
        super.handleOnDestroy();
    }
}
