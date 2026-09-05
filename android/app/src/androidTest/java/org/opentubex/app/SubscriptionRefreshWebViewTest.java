package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class SubscriptionRefreshWebViewTest {
    @Test
    public void hiddenWindowKeepsChromiumActiveOnlyForTheCurrentRefresh() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<SubscriptionRefreshWebView> view = new AtomicReference<>();
            CountDownLatch loaded = new CountDownLatch(1);
            SubscriptionRefreshState state = new SubscriptionRefreshState();
            scenario.onActivity(activity -> {
                SubscriptionRefreshWebView webView = new SubscriptionRefreshWebView(activity, null);
                view.set(webView);
                webView.getSettings().setJavaScriptEnabled(true);
                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView ignored, String url) {
                        loaded.countDown();
                    }
                });
                activity.addContentView(webView, new ViewGroup.LayoutParams(1, 1));
                state.observeActive(webView::setRefreshActive);
                webView.loadDataWithBaseURL("https://refresh-test.invalid", "<html></html>", "text/html", "UTF-8", null);
            });
            assertTrue("test page loaded", loaded.await(10, TimeUnit.SECONDS));
            try {
                onMain(() -> {
                    state.begin("refresh", "Refreshing", "Cancel");
                    view.get().onWindowVisibilityChanged(View.GONE);
                });
                assertVisibility(view.get(), "visible");
                onMain(() -> state.finish("stale"));
                assertVisibility(view.get(), "visible");
                onMain(() -> state.finish("refresh"));
                assertVisibility(view.get(), "hidden");

                // A refresh started while already hidden must reactivate it too.
                onMain(() -> state.begin("next", "Refreshing", "Cancel"));
                assertVisibility(view.get(), "visible");
                onMain(() -> state.finish("next"));
                assertVisibility(view.get(), "hidden");
                onMain(() -> view.get().onWindowVisibilityChanged(View.VISIBLE));
                assertVisibility(view.get(), "visible");
            } finally {
                onMain(() -> {
                    ((ViewGroup) view.get().getParent()).removeView(view.get());
                    view.get().destroy();
                });
            }
        }
    }

    private static void assertVisibility(WebView view, String expected) throws Exception {
        AtomicReference<String> actual = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        onMain(() -> view.evaluateJavascript("document.visibilityState", result -> {
            actual.set(result);
            evaluated.countDown();
        }));
        assertTrue("page responds", evaluated.await(5, TimeUnit.SECONDS));
        assertEquals("\"" + expected + "\"", actual.get());
    }

    private static void onMain(Runnable action) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(action);
    }
}
