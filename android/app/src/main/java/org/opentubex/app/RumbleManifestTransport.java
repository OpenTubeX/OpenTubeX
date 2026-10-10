package org.opentubex.app;

import android.content.Context;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import okhttp3.Headers;
import okhttp3.Interceptor;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.json.JSONObject;

/** Rumble's small HLS manifests need the same Chrome transport as extraction. */
final class RumbleManifestTransport implements Interceptor {
    private final Context context;

    RumbleManifestTransport(Context context) { this.context = context.getApplicationContext(); }

    @Override public Response intercept(Chain chain) throws IOException {
        var request = chain.request();
        String host = request.url().host();
        if (!(host.equals("rumble.com") || host.endsWith(".rumble.com")) ||
            !request.url().encodedPath().endsWith(".m3u8")) return chain.proceed(request);
        Process process = null;
        try {
            var headers = new HashMap<String, String>();
            for (String name : request.headers().names()) {
                // Use the helper's Chrome identity, matching the metadata request.
                if (!name.equalsIgnoreCase("User-Agent")) headers.put(name, request.header(name));
            }
            JSONObject payload = new JSONObject().put("url", request.url().toString())
                .put("method", request.method()).put("headers", new JSONObject(headers)).put("timeout", 30000);
            process = YtDlpRuntime.rumbleHttpCommand(context)
                .redirectError(ProcessBuilder.Redirect.to(new File("/dev/null"))).start();
            Process running = process;
            FutureTask<byte[]> output = new FutureTask<>(() -> {
                try (var input = running.getInputStream()) { return YtDlpFiles.read(input, 24 * 1024 * 1024); }
            });
            new Thread(output, "rumble-manifest").start();
            try (var input = process.getOutputStream()) { input.write(payload.toString().getBytes(StandardCharsets.UTF_8)); }
            if (!process.waitFor(35, TimeUnit.SECONDS) || process.exitValue() != 0) throw new IOException("Rumble manifest request failed");
            JSONObject result = new JSONObject(new String(output.get(1, TimeUnit.SECONDS), StandardCharsets.UTF_8));
            Headers.Builder responseHeaders = new Headers.Builder();
            JSONObject rawHeaders = result.getJSONObject("headers");
            for (var names = rawHeaders.keys(); names.hasNext();) {
                String name = names.next();
                JSONArray values = rawHeaders.getJSONArray(name);
                for (int index = 0; index < values.length(); index++) responseHeaders.add(name, values.getString(index));
            }
            int status = result.getInt("status");
            return new Response.Builder().request(request).protocol(Protocol.HTTP_2).code(status)
                .message("HTTP " + status).headers(responseHeaders.build())
                .body(ResponseBody.create(Base64.getDecoder().decode(result.getString("body")), null)).build();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IOException("Rumble manifest request interrupted", error);
        } catch (Exception error) {
            throw new IOException("Rumble manifest request failed", error);
        } finally { if (process != null) process.destroy(); }
    }
}
