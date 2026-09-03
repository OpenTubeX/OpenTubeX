package org.opentubex.app;

final class AppVisibility {
    private static boolean visible;

    private AppVisibility() {}

    static synchronized void setVisible(boolean nextVisible) {
        visible = nextVisible;
    }

    static synchronized boolean isVisible() {
        return visible;
    }
}
