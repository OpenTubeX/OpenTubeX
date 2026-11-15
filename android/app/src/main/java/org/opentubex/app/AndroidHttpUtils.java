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

    static InputStream alreadyRangedStream(InputStream stream, long start, long end) {
        if (start < 0 || end < start || end == Long.MAX_VALUE) return stream;
        // WebView treats intercepted streams as whole resources: it checks
        // available() for range bounds and calls skip(start) before reading.
        // The upstream 206 body is already sliced, so account for that prefix
        // without downloading or discarding the same bytes again.
        return new FilterInputStream(stream) {
            private long prefix = start;
            private long remaining = end - start + 1;

            @Override public int available() {
                long size = prefix + remaining;
                return size > Integer.MAX_VALUE ? 0 : (int) size;
            }

            @Override public long skip(long count) throws IOException {
                if (count <= 0) return 0;
                long virtual = Math.min(count, prefix);
                prefix -= virtual;
                long actual = count == virtual ? 0 : in.skip(count - virtual);
                remaining = Math.max(0, remaining - actual);
                return virtual + actual;
            }

            @Override public int read() throws IOException {
                int value = in.read();
                if (value >= 0) remaining = Math.max(0, remaining - 1);
                return value;
            }

            @Override public int read(byte[] bytes, int offset, int length) throws IOException {
                int count = in.read(bytes, offset, length);
                if (count > 0) remaining = Math.max(0, remaining - count);
                return count;
            }
        };
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
