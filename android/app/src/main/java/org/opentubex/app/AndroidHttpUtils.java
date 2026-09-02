package org.opentubex.app;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

final class AndroidHttpUtils {
    private AndroidHttpUtils() {}

    static Map<String, String> flattenHeaders(Map<String, List<String>> source) {
        Map<String, String> headers = new HashMap<>();
        for (Map.Entry<String, List<String>> header : source.entrySet()) {
            if (header.getKey() != null && header.getValue() != null) {
                headers.put(header.getKey(), String.join(", ", header.getValue()));
            }
        }
        return headers;
    }

    static String mimeType(String contentType, String fallback) {
        return contentType == null ? fallback : contentType.split(";", 2)[0];
    }

    static InputStream disconnectOnClose(InputStream stream, HttpURLConnection connection) {
        return disconnectOnClose(stream, connection, () -> {});
    }

    static InputStream disconnectOnClose(
        InputStream stream,
        HttpURLConnection connection,
        Runnable onClose
    ) {
        return new DisconnectingInputStream(stream, connection, onClose);
    }

    private static final class DisconnectingInputStream extends FilterInputStream {
        private final HttpURLConnection connection;
        private final Runnable onClose;
        private boolean closed;

        DisconnectingInputStream(
            InputStream stream,
            HttpURLConnection connection,
            Runnable onClose
        ) {
            super(stream);
            this.connection = connection;
            this.onClose = onClose;
        }

        @Override
        public synchronized void close() throws IOException {
            if (closed) {
                return;
            }
            closed = true;

            try {
                super.close();
            } finally {
                try {
                    connection.disconnect();
                } finally {
                    onClose.run();
                }
            }
        }
    }
}
