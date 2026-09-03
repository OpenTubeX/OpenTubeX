package org.opentubex.app;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

final class AndroidMediaActions {
    static final String PLAY = "play";
    static final String PAUSE = "pause";
    static final String STOP = "stop";
    static final String SEEK_BACKWARD = "seekbackward";
    static final String SEEK_FORWARD = "seekforward";
    static final String SEEK_TO = "seekto";
    static final String PREVIOUS = "previoustrack";
    static final String NEXT = "nexttrack";

    private static final Set<String> SUPPORTED = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        PLAY,
        PAUSE,
        STOP,
        SEEK_BACKWARD,
        SEEK_FORWARD,
        SEEK_TO,
        PREVIOUS,
        NEXT
    )));

    private AndroidMediaActions() {}

    static boolean isSupported(String action) {
        return SUPPORTED.contains(action);
    }
}
