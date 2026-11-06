package org.opentubex.app;

import java.util.Set;
import java.util.TreeSet;

final class AndroidMediaNotificationState {
    private AndroidMediaNotificationState() {}

    static String metadataSignature(
        String title,
        String artist,
        long durationMs,
        String artworkUrl,
        boolean hasArtwork
    ) {
        return String.join("\u0000",
            title,
            artist,
            String.valueOf(durationMs),
            hasArtwork ? artworkUrl : ""
        );
    }

    static String notificationSignature(
        String metadataSignature,
        String playbackState,
        Set<String> actions
    ) {
        return String.join("\u0000",
            metadataSignature,
            playbackState,
            new TreeSet<>(actions).toString()
        );
    }
}
