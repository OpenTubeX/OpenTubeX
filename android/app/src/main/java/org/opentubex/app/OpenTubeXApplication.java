package org.opentubex.app;

import android.app.Application;

public final class OpenTubeXApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        // The restart process never renders content or makes network requests.
        String processName = null;
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            processName = Application.getProcessName();
        } else {
            android.app.ActivityManager manager = getSystemService(android.app.ActivityManager.class);
            java.util.List<android.app.ActivityManager.RunningAppProcessInfo> processes =
                manager == null ? null : manager.getRunningAppProcesses();
            if (processes != null) {
                for (android.app.ActivityManager.RunningAppProcessInfo process : processes) {
                    if (process.pid == android.os.Process.myPid()) {
                        processName = process.processName;
                        break;
                    }
                }
            }
        }
        if ((getPackageName() + ":restart").equals(processName)) {
            return;
        }
        if (android.os.Build.VERSION.SDK_INT == 35) {
            prepareWebViewResources();
        }
        AndroidProxy.initialize(this);
    }

    private void prepareWebViewResources() {
        android.content.pm.PackageInfo provider = android.webkit.WebView.getCurrentWebViewPackage();
        if (provider == null) return;
        try {
            android.content.pm.ApplicationInfo installed = getPackageManager().getApplicationInfo(
                provider.packageName, android.content.pm.PackageManager.GET_SHARED_LIBRARY_FILES);
            android.content.pm.ApplicationInfo resources = new android.content.pm.ApplicationInfo();
            resources.sourceDir = installed.sourceDir;
            resources.splitSourceDirs = installed.splitSourceDirs;
            resources.sharedLibraryFiles = installed.sharedLibraryFiles;
            // Android 15 otherwise pins the provider's current Monet overlays in
            // every Resources instance. Android 16 filters shared overlays itself.
            android.content.res.Resources.registerResourcePaths(provider.packageName, resources);
        } catch (android.content.pm.PackageManager.NameNotFoundException | UnsupportedOperationException error) {
            android.util.Log.w("DynamicColors", "Unable to prepare WebView resources", error);
        }
    }

}
