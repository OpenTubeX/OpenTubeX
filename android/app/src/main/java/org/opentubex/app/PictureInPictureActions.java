package org.opentubex.app;

import android.app.RemoteAction;

import java.util.Collections;
import java.util.List;

/**
 * Playback controls for the Picture-in-Picture menu, used on the main thread only.
 *
 * Without app actions, System UI builds the menu from the media session, but it
 * only looks up sessions of the current user. An app in a work profile or
 * another profile gets no controls then, so the playback service publishes them.
 */
final class PictureInPictureActions {
    private static List<RemoteAction> actions = Collections.emptyList();
    private static Runnable listener;

    private PictureInPictureActions() {}

    static List<RemoteAction> get() {
        return actions;
    }

    static void set(List<RemoteAction> next) {
        actions = next;
        if (listener != null) listener.run();
    }

    static void setListener(Runnable next) {
        listener = next;
    }

    static void clearListener(Runnable current) {
        if (listener == current) listener = null;
    }
}
