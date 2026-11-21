package org.opentubex.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.ColorUtils;
import androidx.lifecycle.Lifecycle;

import com.getcapacitor.BridgeActivity;

/**
 * Covers the app with a native screen until the device's screen lock (biometrics,
 * PIN, pattern or password) confirms the user. The renderer keeps running behind it.
 */
final class AppLock {
    private static final String PREFERENCES = "app-lock";
    private static final String ENABLED = "enabled";
    private static final String TIMEOUT = "timeoutSeconds";
    private static final int AUTHENTICATORS =
        BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    // A new process starts locked. Both survive activity recreation.
    private static boolean unlocked;
    /** SystemClock.elapsedRealtime when the unlocked app was last hidden, or -1. */
    private static long hiddenAt = -1;

    private final BridgeActivity activity;
    private final BiometricPrompt prompt;
    private final OnBackPressedCallback backCallback = new OnBackPressedCallback(false) {
        @Override
        public void handleOnBackPressed() {
            activity.moveTaskToBack(true);
        }
    };
    private View overlay;
    private boolean locked;
    private boolean authenticating;

    AppLock(BridgeActivity activity) {
        this.activity = activity;
        // BiometricPrompt must exist before the activity starts so a prompt that
        // outlives a recreation reports back to it.
        prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity),
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    authenticating = false;
                    unlock();
                }

                @Override
                public void onAuthenticationError(int code, @NonNull CharSequence message) {
                    authenticating = false;
                    // Someone who knows the screen lock removed it; nothing can unlock the app anymore.
                    if (!isDeviceSecure(activity)) unlock();
                }
            });
        // Plugins register lifecycle-bound callbacks that move back on top on every
        // start. Registering the same way after them keeps this one above theirs.
        activity.getOnBackPressedDispatcher().addCallback(activity, backCallback);
        applyRecentsPreview(activity);
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    static boolean isEnabled(Context context) {
        return preferences(context).getBoolean(ENABLED, false);
    }

    static int getTimeoutSeconds(Context context) {
        return preferences(context).getInt(TIMEOUT, 0);
    }

    static boolean isDeviceSecure(Context context) {
        return context.getSystemService(KeyguardManager.class).isDeviceSecure();
    }

    /** Called from the settings, where the user has already got past the lock. */
    static void setEnabled(Context context, boolean enabled) {
        preferences(context).edit().putBoolean(ENABLED, enabled).apply();
        unlocked = true;
        hiddenAt = -1;
    }

    static void setTimeoutSeconds(Context context, int seconds) {
        preferences(context).edit().putInt(TIMEOUT, Math.max(0, seconds)).apply();
    }

    static boolean shouldLock(boolean enabled, boolean deviceSecure, boolean unlocked, long hiddenAt,
                              long now, long timeoutMillis) {
        if (!enabled || !deviceSecure) return false;
        return !unlocked || (hiddenAt >= 0 && now - hiddenAt >= timeoutMillis);
    }

    /** Recent apps would otherwise show the screen the app was left on. */
    static void applyRecentsPreview(Activity activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.setRecentsScreenshotEnabled(!isEnabled(activity));
        }
    }

    void onStart() {
        lockIfDue();
    }

    void onStop() {
        markHidden();
    }

    void onResume() {
        if (isCovering()) authenticate();
    }

    /** The app stays started in picture-in-picture, so leaving it counts as returning to the app. */
    void onPictureInPictureModeChanged(boolean inPictureInPicture) {
        if (inPictureInPicture) {
            markHidden();
            updateOverlay();
            return;
        }
        lockIfDue();
        updateOverlay();
        if (isCovering() && activity.getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
            authenticate();
        }
    }

    private void lockIfDue() {
        if (shouldLock(isEnabled(activity), isDeviceSecure(activity), unlocked, hiddenAt,
            SystemClock.elapsedRealtime(), getTimeoutSeconds(activity) * 1000L)) {
            lock();
        }
        hiddenAt = -1;
    }

    /** Keeps the time the app was first hidden, such as when picture-in-picture started. */
    private void markHidden() {
        if (unlocked && hiddenAt < 0 && !activity.isChangingConfigurations()) {
            hiddenAt = SystemClock.elapsedRealtime();
        }
    }

    private boolean isCovering() {
        return overlay != null && overlay.getVisibility() == View.VISIBLE;
    }

    /** Keeps hardware keys from reaching the page behind the lock screen. Returns whether the key was consumed. */
    boolean interceptKeyEvent(KeyEvent event) {
        if (!isCovering()) return false;
        int code = event.getKeyCode();
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_VOLUME_UP ||
            code == KeyEvent.KEYCODE_VOLUME_DOWN || code == KeyEvent.KEYCODE_VOLUME_MUTE) return false;
        if (event.getAction() == KeyEvent.ACTION_UP && (code == KeyEvent.KEYCODE_ENTER ||
            code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_SPACE ||
            code == KeyEvent.KEYCODE_DPAD_CENTER)) {
            authenticate();
        }
        return true;
    }

    private void lock() {
        unlocked = false;
        locked = true;
        // Back leaves the app instead of reaching the page.
        backCallback.setEnabled(true);
        updateOverlay();
    }

    private void unlock() {
        unlocked = true;
        locked = false;
        backCallback.setEnabled(false);
        updateOverlay();
    }

    private void authenticate() {
        if (authenticating || !locked || activity.isInPictureInPictureMode()) return;
        if (!isDeviceSecure(activity)) {
            unlock();
            return;
        }
        authenticating = true;
        try {
            prompt.authenticate(new BiometricPrompt.PromptInfo.Builder()
                .setTitle(activity.getString(R.string.app_lock_prompt_title))
                .setAllowedAuthenticators(AUTHENTICATORS)
                .setConfirmationRequired(false)
                .build());
        } catch (RuntimeException error) {
            authenticating = false;
            Log.e("AppLock", "Unable to show the unlock prompt", error);
        }
    }

    private void updateOverlay() {
        // Picture-in-picture shows only the video; the lock returns with the full app.
        boolean cover = locked && !activity.isInPictureInPictureMode();
        View webView = activity.getBridge() == null ? null : activity.getBridge().getWebView();
        if (cover) {
            if (overlay == null) overlay = createOverlay();
            overlay.setVisibility(View.VISIBLE);
            overlay.bringToFront();
            if (webView != null) {
                webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
                activity.getSystemService(InputMethodManager.class).hideSoftInputFromWindow(webView.getWindowToken(), 0);
            }
        } else if (overlay != null) {
            overlay.setVisibility(View.GONE);
            if (webView != null) webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);
        }
    }

    private View createOverlay() {
        int background = StartupBackground.getColor(activity);
        int foreground = ColorUtils.calculateLuminance(background) > 0.5 ? Color.rgb(31, 31, 31) : Color.rgb(242, 242, 242);

        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER);
        int padding = dp(24);
        content.setPadding(padding, padding, padding, padding);

        try {
            ImageView icon = new ImageView(activity);
            icon.setImageDrawable(AppIconPlugin.loadCurrentIcon(activity));
            icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(dp(96), dp(96));
            iconParams.bottomMargin = dp(16);
            content.addView(icon, iconParams);
        } catch (android.content.pm.PackageManager.NameNotFoundException | RuntimeException error) {
            Log.e("AppLock", "Unable to load the app icon", error);
        }

        TextView title = new TextView(activity);
        title.setText(R.string.app_lock_locked);
        title.setTextColor(foreground);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setGravity(Gravity.CENTER);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) title.setAccessibilityHeading(true);
        content.addView(title);

        Button unlockButton = new Button(activity);
        unlockButton.setText(R.string.app_lock_unlock);
        unlockButton.setAllCaps(false);
        unlockButton.setTextColor(foreground);
        unlockButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        unlockButton.setStateListAnimator(null);
        unlockButton.setMinHeight(dp(48));
        unlockButton.setPadding(dp(20), 0, dp(24), 0);
        Drawable unlockIcon = ContextCompat.getDrawable(activity, R.drawable.ic_app_lock_unlock);
        if (unlockIcon != null) {
            unlockIcon.mutate().setTint(foreground);
            unlockButton.setCompoundDrawablesRelativeWithIntrinsicBounds(unlockIcon, null, null, null);
            unlockButton.setCompoundDrawablePadding(dp(8));
        }
        GradientDrawable outline = new GradientDrawable();
        outline.setCornerRadius(dp(24));
        outline.setStroke(dp(1), foreground);
        unlockButton.setBackground(outline);
        unlockButton.setOnClickListener(view -> authenticate());
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        buttonParams.topMargin = dp(24);
        content.addView(unlockButton, buttonParams);

        FrameLayout root = new FrameLayout(activity);
        root.setBackgroundColor(background);
        // Touches must not reach the page behind the lock screen.
        root.setClickable(true);
        root.setElevation(dp(100));
        root.addView(content, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ((ViewGroup) activity.findViewById(android.R.id.content)).addView(root, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return root;
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}
