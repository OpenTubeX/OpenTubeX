package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.webkit.WebView;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.junit.Test;

public class InterceptedMediaWebViewTest {
    @Test public void interceptedMediaHasOneContentTypeAndSupportsPlayback() throws Exception {
        byte[] media;
        try (var input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("demo.webm")) {
            media = YtDlpFiles.read(input, 1024 * 1024);
        }
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            String url = "https://media-test.invalid/media.webm";
            String rangeUrl = url + "?range=100-199";
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> {
                WebView view = activity.getBridge().getWebView();
                reference.set(view);
                view.setWebViewClient(new OpenTubeXWebViewClient(activity.getBridge()) {
                    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                        if (!"media-test.invalid".equals(request.getUrl().getHost())) {
                            return super.shouldInterceptRequest(view, request);
                        }
                        int offset = 0;
                        int end = media.length - 1;
                        String range = request.getUrl().getQueryParameter("range");
                        if (range == null) {
                            for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                                if ("Range".equalsIgnoreCase(header.getKey())) range = header.getValue().substring(6);
                            }
                        }
                        if (range != null) {
                            String[] bounds = range.split("-");
                            offset = Integer.parseInt(bounds[0]);
                            if (bounds.length > 1) end = Math.min(end, Integer.parseInt(bounds[1]));
                        }
                        Map<String, String> headers = new HashMap<>();
                        headers.put("Content-Type", "video/webm");
                        headers.put("Content-Length", Integer.toString(end - offset + 1));
                        headers.put("Content-Range", "bytes " + offset + "-" + end + "/" + media.length);
                        headers.put("Accept-Ranges", "bytes");
                        return mediaResponse(request, "video/webm", 206, "Partial Content", headers,
                            new ByteArrayInputStream(media, offset, end - offset + 1));
                    }
                });
                view.getSettings().setMediaPlaybackRequiresUserGesture(false);
                view.loadDataWithBaseURL("https://playback-test.invalid/", "<video id='video' muted></video><script>" +
                    "fetch('" + url + "').then(r => window.mediaType = r.headers.get('content-type'));" +
                    "</script>", "text/html", "UTF-8", null);
            });
            WebView view = reference.get();
            await(view, "typeof window.mediaType === 'string'");
            assertEquals("\"video/webm\"", evaluate(view, "window.mediaType"));
            evaluate(view, "document.querySelector('video').src = '" + url + "'; document.querySelector('video').play(); true");
            await(view, "document.querySelector('video').currentTime > 0.5");
            evaluate(view, "document.querySelector('video').currentTime = 20; true");
            await(view, "document.querySelector('video').currentTime > 20.5");
            evaluate(view, "fetch('" + rangeUrl + "')" +
                ".then(r => r.arrayBuffer()).then(b => window.rangeBytes = Array.from(new Uint8Array(b))); true");
            await(view, "Array.isArray(window.rangeBytes)");
            JSONArray expected = new JSONArray();
            for (int index = 100; index < 200; index++) expected.put(media[index] & 255);
            assertEquals(expected.toString(), evaluate(view, "window.rangeBytes"));
            evaluate(view, "fetch('" + url + "', {headers:{Range:'bytes=100-199'}})" +
                ".then(r => r.arrayBuffer()).then(b => window.headerRangeBytes = Array.from(new Uint8Array(b))); true");
            await(view, "Array.isArray(window.headerRangeBytes)");
            assertEquals(expected.toString(), evaluate(view, "window.headerRangeBytes"));
        }
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            done.countDown();
        }));
        assertTrue("WebView responds", done.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static void await(WebView view, String condition) throws Exception {
        long deadline = android.os.SystemClock.uptimeMillis() + 15000;
        while (android.os.SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, condition))) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Media condition failed: " + condition + "; " + evaluate(view,
            "JSON.stringify({type:window.mediaType,state:document.querySelector('video')?.readyState,network:document.querySelector('video')?.networkState,error:document.querySelector('video')?.error?.code,message:document.querySelector('video')?.error?.message})"));
    }
}
