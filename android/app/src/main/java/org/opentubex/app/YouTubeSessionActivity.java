package org.opentubex.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import java.io.File;
import java.nio.charset.StandardCharsets;

/** A normal browser without Capacitor or any JavaScript-to-native interface. */
public final class YouTubeSessionActivity extends AppCompatActivity {
    private static final String EXPORT_URL = "https://www.youtube.com/robots.txt";
    private WebView browser;
    private MenuItem save;
    private androidx.appcompat.widget.AppCompatButton saveButton;
    private boolean saving;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        saving = state != null && state.getBoolean("saving");
        setTitle("youtube.com");
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        android.util.TypedValue background = new android.util.TypedValue();
        getTheme().resolveAttribute(android.R.attr.colorBackground, background, true);
        content.setBackgroundColor(background.data);
        androidx.appcompat.widget.Toolbar toolbar = new androidx.appcompat.widget.Toolbar(this);
        toolbar.setPaddingRelative(0, 0, Math.round(12 * getResources().getDisplayMetrics().density), 0);
        content.addView(toolbar);
        setSupportActionBar(toolbar);
        getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        TextView hint = new TextView(this);
        int padding = Math.round(12 * getResources().getDisplayMetrics().density);
        hint.setPadding(padding, padding, padding, padding);
        hint.setText(getIntent().getStringExtra("hint"));
        content.addView(hint);
        browser = new WebView(this);
        AndroidProxy.protectWebView(browser);
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, true);
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                boolean blocked = request.isForMainFrame() && !YouTubeSessionCookies.canNavigate(request.getUrl().toString());
                if (blocked && saving) failSave();
                return blocked;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                setTitle(android.net.Uri.parse(url).getHost());
                setSaveEnabled(false);
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!url.equals(view.getUrl())) return;
                boolean youtube = YouTubeSessionCookies.isYouTube(url);
                if (saving) {
                    if (youtube && "/robots.txt".equals(android.net.Uri.parse(url).getPath())) saveCookies();
                    else failSave();
                } else if (save != null) {
                    setSaveEnabled(youtube && CookieManager.getInstance().getCookie("https://www.youtube.com") != null);
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (saving && request.isForMainFrame()) failSave();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (saving && request.isForMainFrame() && response.getStatusCode() >= 400) failSave();
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
            @Override public void handleOnBackPressed() {
                if (!saving && browser.canGoBack()) browser.goBack(); else finish();
            }
        });
        if (saving) browser.loadUrl(EXPORT_URL);
        else if (state == null || browser.restoreState(state) == null) browser.loadUrl("https://www.youtube.com");
    }

    @Override public boolean onCreateOptionsMenu(Menu menu) {
        save = menu.add(getIntent().getStringExtra("saveLabel"));
        saveButton = new androidx.appcompat.widget.AppCompatButton(this);
        saveButton.setText(getIntent().getStringExtra("saveLabel"));
        saveButton.setAllCaps(false);
        android.graphics.drawable.Drawable icon = androidx.appcompat.content.res.AppCompatResources.getDrawable(this, R.drawable.ic_session_save);
        icon.setTint(saveButton.getCurrentTextColor());
        saveButton.setCompoundDrawablesRelativeWithIntrinsicBounds(icon, null, null, null);
        saveButton.setCompoundDrawablePadding(Math.round(8 * getResources().getDisplayMetrics().density));
        saveButton.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        save.setActionView(saveButton);
        save.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
        setSaveEnabled(YouTubeSessionCookies.isYouTube(browser.getUrl()) &&
            CookieManager.getInstance().getCookie("https://www.youtube.com") != null);
        saveButton.setOnClickListener(view -> {
            saving = true;
            setSaveEnabled(false);
            // Leave the signed-in page before exporting so its scripts stop rotating cookies.
            browser.loadUrl(EXPORT_URL);
        });
        return true;
    }

    private void setSaveEnabled(boolean enabled) {
        if (save != null) save.setEnabled(enabled && !saving);
        if (saveButton != null) saveButton.setEnabled(enabled && !saving);
    }

    private void failSave() {
        saving = false;
        setSaveEnabled(YouTubeSessionCookies.isYouTube(browser.getUrl()) &&
            CookieManager.getInstance().getCookie("https://www.youtube.com") != null);
        Toast.makeText(this, getIntent().getStringExtra("errorLabel"), Toast.LENGTH_LONG).show();
    }

    private void saveCookies() {
        try {
            CookieManager manager = CookieManager.getInstance();
            manager.flush();
            String cookies = YouTubeSessionCookies.serialize(manager.getCookie("https://www.youtube.com"));
            File file = new File(getNoBackupFilesDir(), "yt-dlp-cookies.txt");
            YtDlpFiles.write(file, cookies.getBytes(StandardCharsets.UTF_8));
            saving = false;
            setResult(RESULT_OK, new Intent().putExtra("path", file.getAbsolutePath()));
            finish();
        } catch (Exception error) {
            failSave();
        }
    }

    @Override public boolean onSupportNavigateUp() { finish(); return true; }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("saving", saving);
        browser.saveState(state);
        super.onSaveInstanceState(state);
    }
    @Override protected void onDestroy() {
        if (browser != null) {
            browser.stopLoading();
            ((ViewGroup) browser.getParent()).removeView(browser);
            browser.destroy();
        }
        super.onDestroy();
    }
}
