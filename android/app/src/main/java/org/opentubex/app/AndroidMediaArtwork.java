package org.opentubex.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.net.UnknownHostException;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Dns;
import okhttp3.HttpUrl;
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
        .dns(publicDns(Dns.SYSTEM))
        .followRedirects(false).followSslRedirects(false)
        .connectTimeout(5, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS).build();

    AndroidMediaArtwork(Executor delivery) { this.delivery = delivery; }

    void load(String url, Consumer<Bitmap> listener) {
        requests.replace(url.isEmpty() ? null : request -> download(request, url, 0, listener));
    }

    void cancel() { requests.cancel(); }
    @Override public void close() { requests.close(); }

    private void download(ArtworkRequestQueue.Request request, String source, int redirects, Consumer<Bitmap> listener) {
        try {
            URL url = new URL(source);
            if (request.isCancelled() || !isSafeArtworkUrl(url)) return;
            Call call = client.newCall(new Request.Builder().url(url).build());
            request.onCancel(call::cancel);
            // DNS runs on OkHttp's bounded dispatcher. Obsolete DNS cannot hold
            // the latest-only request queue, even when the OS resolver blocks.
            call.enqueue(new Callback() {
                @Override public void onFailure(Call call, IOException error) {}

                @Override public void onResponse(Call call, Response response) throws IOException {
                    try (response) {
                        if (request.isCancelled()) return;
                        if (isRedirectStatus(response.code())) {
                            String location = response.header("Location");
                            if (location != null && redirects < MAX_ARTWORK_REDIRECTS) {
                                download(request, new URL(url, location).toString(), redirects + 1, listener);
                            }
                            return;
                        }
                        ResponseBody body = response.body();
                        if (!response.isSuccessful() || body == null) return;
                        byte[] encoded = readArtworkBytes(body.byteStream(), body.contentLength());
                        if (encoded == null || request.isCancelled()) return;
                        Bitmap bitmap = decodeArtwork(encoded);
                        if (bitmap == null) return;
                        delivery.execute(() -> {
                            if (request.isCancelled()) bitmap.recycle();
                            else listener.accept(bitmap);
                        });
                    }
                }
            });
        } catch (Exception ignored) {
            // Artwork failure must not interrupt playback.
        }
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
        // OkHttp bypasses Dns for IP literals. Check those without resolving a
        // hostname; actual hostname answers are validated at connection time.
        HttpUrl parsed = HttpUrl.parse(url.toString());
        if (parsed == null) return false;
        String host = parsed.host();
        if (!host.contains(":") && !host.matches("[0-9.]+")) return true;
        try { return isPublicAddress(InetAddress.getByName(host)); }
        catch (UnknownHostException ignored) { return false; }
    }

    static Dns publicDns(Dns resolver) {
        return hostname -> {
            List<InetAddress> addresses = resolver.lookup(hostname);
            if (addresses.isEmpty()) throw new UnknownHostException("No artwork addresses");
            for (InetAddress address : addresses) {
                if (!isPublicAddress(address)) throw new UnknownHostException("Non-public artwork address");
            }
            return addresses;
        };
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
