package org.opentubex.app;

import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.HttpAuthHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/**
 * Shows a Rumble page in a normal browser, without Capacitor or any
 * JavaScript-to-native interface, so the user can pass Cloudflare's check.
 * Once the page itself loads, its cookies and user agent load Rumble's pages
 * for the app: Cloudflare ties its cookie to them, and only accepts it after
 * its check loaded the page again. The browser may only show Rumble pages.
 */
public final class RumbleChallengeActivity extends AppCompatActivity {
    private WebView browser;
    /** Whether the page that loads failed, as Cloudflare's check does with 403 */
    private boolean failed;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        String url = getIntent().getStringExtra("url");
        if (!RumblePages.isRumblePage(url)) {
            finish();
            return;
        }
        setTitle("rumble.com");
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        android.util.TypedValue background = new android.util.TypedValue();
        getTheme().resolveAttribute(android.R.attr.colorBackground, background, true);
        content.setBackgroundColor(background.data);
        androidx.appcompat.widget.Toolbar toolbar = new androidx.appcompat.widget.Toolbar(this);
        content.addView(toolbar);
        setSupportActionBar(toolbar);
        getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        browser = new WebView(this);
        AndroidProxy.protectWebView(browser);
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        // The check runs in a frame of Cloudflare's own site
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, true);
        browser.setWebViewClient(new WebViewClient() {
            @Override public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
                if (!AndroidProxy.answerProxyChallenge(handler, host, realm)) super.onReceivedHttpAuthRequest(view, handler, host, realm);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request.isForMainFrame() && !RumblePages.isRumblePage(request.getUrl().toString());
            }
            // Android reports a page's HTTP error before it starts the page, so
            // the error belongs to the next page that finishes
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) failed = true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) failed = true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                boolean pageFailed = failed;
                failed = false;
                if (pageFailed || !url.equals(view.getUrl()) || !RumblePages.isRumblePage(url)) return;
                // Unless Cloudflare's check still runs on the page
                view.evaluateJavascript("window._cf_chl_opt === undefined", passed -> {
                    if (!"true".equals(passed) || isFinishing() || !url.equals(view.getUrl())) return;
                    RumblePages.acceptBrowserSession(CookieManager.getInstance().getCookie(url), view.getSettings().getUserAgentString());
                    setResult(RESULT_OK);
                    finish();
                });
            }
        });
        content.addView(browser, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { finish(); }
        });
        browser.loadUrl(url);
    }

    @Override public boolean onSupportNavigateUp() { finish(); return true; }
    @Override protected void onDestroy() {
        if (browser != null) {
            browser.stopLoading();
            ((ViewGroup) browser.getParent()).removeView(browser);
            browser.destroy();
        }
        super.onDestroy();
    }
}
