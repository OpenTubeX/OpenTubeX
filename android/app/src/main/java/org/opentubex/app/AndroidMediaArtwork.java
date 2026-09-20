package org.opentubex.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** Cancellable artwork loading, isolated from playback and notification state. */
final class AndroidMediaArtwork implements AutoCloseable {
    private static final int MAX_ARTWORK_REDIRECTS = 5;
    static final int MAX_ARTWORK_BYTES = 5 * 1024 * 1024;
    static final int MAX_ARTWORK_DIMENSION = 2048;
    static final long MAX_ARTWORK_PIXELS = 2048L * 2048L;
    static final long MAX_ARTWORK_DECODED_BYTES = MAX_ARTWORK_PIXELS * 4L;
    private final ArtworkRequestQueue requests = new ArtworkRequestQueue();
    private final Executor delivery;
    private final OkHttpClient client = new OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false)
        .connectTimeout(5, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS).build();

    AndroidMediaArtwork(Executor delivery) { this.delivery = delivery; }

    void load(String url, Consumer<Bitmap> listener) {
        requests.replace(url.isEmpty() ? null : request -> {
            Bitmap bitmap = download(request, url);
            if (bitmap == null) return;
            delivery.execute(() -> {
                if (request.isCancelled()) bitmap.recycle();
                else listener.accept(bitmap);
            });
        });
    }

    void cancel() { requests.cancel(); }
    @Override public void close() { requests.close(); }

    private Bitmap download(ArtworkRequestQueue.Request request, String source) {
        try {
            URL url = new URL(source);
            for (int redirects = 0; redirects <= MAX_ARTWORK_REDIRECTS; redirects++) {
                if (request.isCancelled() || !isSafeArtworkUrl(url)) return null;
                Call call = client.newCall(new Request.Builder().url(url).build());
                // Cancellation also interrupts a blocked socket read. A request
                // replaced while resolving DNS cancels its call before execution.
                request.onCancel(call::cancel);
                try (Response response = call.execute()) {
                    if (request.isCancelled()) return null;
                    if (isRedirectStatus(response.code())) {
                        String location = response.header("Location");
                        if (location == null || redirects == MAX_ARTWORK_REDIRECTS) return null;
                        url = new URL(url, location);
                        continue;
                    }
                    ResponseBody body = response.body();
                    if (!response.isSuccessful() || body == null) return null;
                    byte[] encoded = readArtworkBytes(body.byteStream(), body.contentLength());
                    return encoded == null || request.isCancelled() ? null : decodeArtwork(encoded);
                } finally {
                    request.onCancel(null);
                }
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    static byte[] readArtworkBytes(InputStream input, long contentLength) throws IOException {
        if (contentLength > MAX_ARTWORK_BYTES) return null;

        int initialSize = contentLength > 0 ? (int) contentLength : 8192;
        ByteArrayOutputStream output = new ByteArrayOutputStream(initialSize);
        byte[] buffer = new byte[8192];
        int read;
        while ((read = input.read(buffer)) != -1) {
            if (output.size() + read > MAX_ARTWORK_BYTES) return null;
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private static Bitmap decodeArtwork(byte[] encoded) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(encoded, 0, encoded.length, bounds);
        int sampleSize = calculateArtworkSampleSize(bounds.outWidth, bounds.outHeight);
        if (sampleSize == 0) return null;

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inScaled = false;
        options.inSampleSize = sampleSize;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap decoded = BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
        if (
            decoded != null &&
            (
                !hasSafeArtworkDimensions(decoded.getWidth(), decoded.getHeight()) ||
                decoded.getByteCount() > MAX_ARTWORK_DECODED_BYTES
            )
        ) {
            decoded.recycle();
            return null;
        }
        return decoded;
    }

    static int calculateArtworkSampleSize(int width, int height) {
        if (width <= 0 || height <= 0) return 0;

        int sampleSize = 1;
        while (!hasSafeArtworkDimensions(
            (int) (((long) width + sampleSize - 1) / sampleSize),
            (int) (((long) height + sampleSize - 1) / sampleSize)
        )) {
            sampleSize *= 2;
        }
        return sampleSize;
    }

    static boolean hasSafeArtworkDimensions(int width, int height) {
        return width > 0 &&
            height > 0 &&
            width <= MAX_ARTWORK_DIMENSION &&
            height <= MAX_ARTWORK_DIMENSION &&
            (long) width * height <= MAX_ARTWORK_PIXELS &&
            (long) width * height * 4L <= MAX_ARTWORK_DECODED_BYTES;
    }

    static boolean isSafeArtworkUrl(URL url) {
        if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getUserInfo() != null) return false;
        try {
            InetAddress[] addresses = InetAddress.getAllByName(url.getHost());
            if (addresses.length == 0) return false;
            for (InetAddress address : addresses) {
                if (!isPublicAddress(address)) return false;
            }
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean isPublicAddress(InetAddress address) {
        if (
            address.isAnyLocalAddress() ||
            address.isLoopbackAddress() ||
            address.isLinkLocalAddress() ||
            address.isSiteLocalAddress() ||
            address.isMulticastAddress()
        ) {
            return false;
        }

        byte[] bytes = address.getAddress();
        if (bytes.length == 4) {
            int first = Byte.toUnsignedInt(bytes[0]);
            int second = Byte.toUnsignedInt(bytes[1]);
            return first != 0 && !(first == 100 && second >= 64 && second <= 127);
        }
        return bytes.length != 16 || (Byte.toUnsignedInt(bytes[0]) & 0xfe) != 0xfc;
    }

    private static boolean isRedirectStatus(int status) {
        return status == HttpURLConnection.HTTP_MOVED_PERM ||
            status == HttpURLConnection.HTTP_MOVED_TEMP ||
            status == HttpURLConnection.HTTP_SEE_OTHER ||
            status == 307 ||
            status == 308;
    }

}
