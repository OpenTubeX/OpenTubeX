package org.opentubex.app;

/** A receiver connection whose local address serves the shared Cast relay. */
interface CastConnection extends AutoCloseable {
    String localAddress();

    /** Stops receiver playback before teardown, for the notification's Stop action. */
    void stopMedia();

    @Override void close();
}
