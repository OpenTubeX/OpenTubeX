package org.opentubex.app;

import static java.util.Arrays.asList;

import android.content.Context;
import android.os.SystemClock;
import com.yausername.ffmpeg.FFmpeg;
import com.yausername.youtubedl_android.YoutubeDL;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/** Bundled executables stay in nativeLibraryDir, as required by Android's W^X policy. */
final class YtDlpRuntime {
    private static final Pattern TIMEOUT_WARNING = Pattern.compile("(?m)^WARNING:.*(?:timed?\\s*out|time-?out)", Pattern.CASE_INSENSITIVE);
    private static final Pattern RETRY_WARNING = Pattern.compile("\\bRetrying \\(\\d+/\\d+\\)", Pattern.CASE_INSENSITIVE);
    private static final ExecutorService EXTRACTORS = Executors.newFixedThreadPool(2);
    private static final ReentrantReadWriteLock INSTALL_LOCK = new ReentrantReadWriteLock();
    private static final Map<String, RunningProcess> PROCESSES = new ConcurrentHashMap<>();
    private static boolean initialized;
    private static String mp3ThumbnailBootstrap;
    private static String rumbleHttpBootstrap;

    private static final class RunningProcess {
        final Process process;
        final AtomicInteger group = new AtomicInteger();
        volatile boolean stopped;
        RunningProcess(Process process) { this.process = process; }
        void stop() {
            // Python creates its own session before importing yt-dlp. Its FFmpeg children
            // belong to this group, so cancellation also stops merging and conversion.
            stopped = true;
            int pid = group.get();
            if (pid > 0) {
                try { android.system.Os.kill(-pid, android.system.OsConstants.SIGKILL); }
                catch (android.system.ErrnoException ignored) { /* Already exited. */ }
            }
            process.destroy();
        }
    }

    static final class ErrorOutput {
        final StringBuilder tail = new StringBuilder();
        boolean timedOut;

        void add(String line) {
            if (hasTimedOutWarning(line)) timedOut = true;
            tail.append(line).append('\n');
            if (tail.length() > 65536) tail.delete(0, tail.length() - 65536);
        }

        String message() { return tail.toString().trim(); }
    }

    static synchronized void initialize(Context context) throws Exception {
        if (initialized) return;
        // youtubedl-android only copies its bundled yt-dlp when none is installed,
        // so an APK with a newer pinned release must replace an older copy itself.
        String installed = installedVersion(context);
        boolean outdated;
        try { outdated = installed == null || YtDlpRelease.compare(installed, BuildConfig.YT_DLP_VERSION) < 0; }
        catch (NumberFormatException error) { outdated = true; }
        File installation = new File(context.getNoBackupFilesDir(), "youtubedl-android");
        if (outdated) YtDlpFiles.deleteTree(new File(installation, "yt-dlp"));
        YoutubeDL.getInstance().init(context);
        if (outdated) {
            YtDlpCodeCache.invalidate(new File(installation, "yt-dlp-code"));
            recordVersion(context, BuildConfig.YT_DLP_VERSION);
        }
        FFmpeg.getInstance().init(context);
        try (InputStream input = context.getAssets().open("opentubex_mp3_thumbnail.py")) {
            mp3ThumbnailBootstrap = new String(YtDlpFiles.read(input, 64 * 1024), StandardCharsets.UTF_8);
        }
        try (InputStream input = context.getAssets().open("opentubex_rumble_http.py")) {
            rumbleHttpBootstrap = new String(YtDlpFiles.read(input, 64 * 1024), StandardCharsets.UTF_8);
        }
        initialized = true;
    }

    private static ProcessBuilder command(Context context, List<String> args) {
        ProcessBuilder builder = new ProcessBuilder(args);
        File packages = new File(context.getNoBackupFilesDir(), "youtubedl-android/packages");
        String python = new File(packages, "python/usr").getAbsolutePath();
        builder.environment().put("LD_LIBRARY_PATH", python + "/lib:" + new File(packages, "ffmpeg/usr/lib").getAbsolutePath());
        builder.environment().put("SSL_CERT_FILE", python + "/etc/tls/cert.pem");
        builder.environment().put("PYTHONHOME", python);
        builder.environment().put("OPENTUBEX_RUMBLE_HTTP", new File(context.getApplicationInfo().nativeLibraryDir, "libopentubex_rumble_http.so").getAbsolutePath());
        builder.environment().put("HOME", context.getNoBackupFilesDir().getAbsolutePath());
        builder.environment().put("TMPDIR", context.getCacheDir().getAbsolutePath());
        builder.environment().put("PATH", System.getenv("PATH") + ":" + context.getApplicationInfo().nativeLibraryDir);
        // Also covers FFmpeg and any HTTP clients spawned by yt-dlp.
        builder.environment().put("http_proxy", AndroidProxy.authenticatedUrl());
        builder.environment().put("https_proxy", AndroidProxy.authenticatedUrl());
        builder.environment().put("all_proxy", AndroidProxy.authenticatedUrl());
        builder.environment().put("no_proxy", "");
        builder.environment().put("NO_PROXY", "");
        return builder;
    }

    static ProcessBuilder rumbleHttpCommand(Context context) throws Exception {
        initialize(context);
        return command(context, asList(context.getApplicationInfo().nativeLibraryDir + "/libopentubex_rumble_http.so"));
    }

    static Process startDlnaFfmpeg(Context context, List<String> args) throws Exception {
        initialize(context);
        List<String> command = new java.util.ArrayList<>();
        command.add(new File(context.getApplicationInfo().nativeLibraryDir, "libffmpeg.so").getAbsolutePath());
        command.addAll(args);
        ProcessBuilder builder = command(context, command);
        // The inputs are private local relays; their native HTTP clients handle proxying.
        builder.environment().put("no_proxy", "127.0.0.1");
        builder.environment().put("NO_PROXY", "127.0.0.1");
        builder.redirectError(new File("/dev/null"));
        return builder.start();
    }

    static String execute(Context context, List<String> args, String id, Consumer<String> progress) throws Exception {
        return execute(context, args, id, progress, null);
    }

    static String execute(Context context, List<String> args, String id, Consumer<String> progress, AtomicBoolean incomplete) throws Exception {
        initialize(context);
        INSTALL_LOCK.readLock().lockInterruptibly();
        RunningProcess running = null;
        boolean completed = false;
        try {
            File installation = new File(context.getNoBackupFilesDir(), "youtubedl-android");
            File entryPoint = YtDlpCodeCache.prepare(new File(installation, "yt-dlp/yt-dlp"), new File(installation, "yt-dlp-code"));
            String nativeDir = context.getApplicationInfo().nativeLibraryDir;
            String marker = "__OPENTUBEX_PROCESS_" + UUID.randomUUID() + "__:";
            String bootstrap = "import os,sys,runpy\nos.setsid()\nprint('" + marker + "'+str(os.getpid()),flush=True)\nsys.argv=sys.argv[1:]\nsys.path.insert(0,sys.argv[0])\n"
                + mp3ThumbnailBootstrap + "\ninstall_mp3_thumbnail_writer()\n"
                + rumbleHttpBootstrap + "\ninstall_rumble_http()\nrunpy.run_path(sys.argv[0],run_name='__main__')";
            List<String> command = new ArrayList<>(asList(nativeDir + "/libpython.so", "-u", "-c", bootstrap,
                entryPoint.getAbsolutePath(),
                "--ignore-config", "--no-plugin-dirs", "--no-cache-dir", "--js-runtimes", "quickjs:" + nativeDir + "/libqjs.so",
                "--ffmpeg-location", nativeDir + "/libffmpeg.so"));
            command.addAll(args);
            // Last option wins over custom arguments; --geo-verification-proxy must
            // follow the same policy instead of escaping through a second proxy.
            command.addAll(asList("--proxy", AndroidProxy.authenticatedUrl(), "--geo-verification-proxy", AndroidProxy.authenticatedUrl()));
            running = new RunningProcess(command(context, command).start());
            RunningProcess current = running;
            if (id != null) PROCESSES.put(id, current);
            StringBuilder output = new StringBuilder();
            ErrorOutput errors = new ErrorOutput();
            FutureTask<Void> stdout = new FutureTask<>(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(current.process.getInputStream(), StandardCharsets.UTF_8))) {
                    String first = reader.readLine();
                    if (first == null || !first.startsWith(marker)) throw new IOException("Unable to start yt-dlp process group");
                    current.group.set(Integer.parseInt(first.substring(marker.length())));
                    if (current.stopped) current.stop();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (progress != null) progress.accept(line);
                        if (progress == null || line.startsWith("__OPENTUBEX_FILE__:")) {
                            if (output.length() + line.length() > 32 * 1024 * 1024) {
                                current.stop();
                                throw new IOException("yt-dlp returned too much metadata");
                            }
                            output.append(line).append('\n');
                        }
                    }
                }
                return null;
            });
            FutureTask<Void> stderr = new FutureTask<>(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(current.process.getErrorStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (progress != null) progress.accept(line);
                        errors.add(line);
                    }
                }
                return null;
            });
            new Thread(stdout, "yt-dlp-output").start();
            new Thread(stderr, "yt-dlp-errors").start();
            int exit = current.process.waitFor();
            stderr.get();
            stdout.get();
            if (exit != 0) throw new IOException(errors.message());
            if (incomplete != null) incomplete.set(errors.timedOut);
            completed = true;
            return output.toString();
        } finally {
            if (running != null) {
                if (!completed) running.stop();
                if (id != null) PROCESSES.remove(id, running);
            }
            INSTALL_LOCK.readLock().unlock();
        }
    }

    static String extract(Context context, List<String> args) throws Exception {
        return extract(context, args, null);
    }

    static String extract(Context context, List<String> args, AtomicBoolean incomplete) throws Exception {
        return extract(() -> execute(context, args, null, null, incomplete), 60, TimeUnit.SECONDS);
    }

    static boolean hasTimedOutWarning(String stderr) {
        return TIMEOUT_WARNING.matcher(stderr).find() && !RETRY_WARNING.matcher(stderr).find();
    }

    static String extract(Callable<String> operation, long timeout, TimeUnit unit) throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        Future<String> future = EXTRACTORS.submit(() -> {
            started.countDown();
            return operation.call();
        });
        try {
            started.await();
            return future.get(timeout, unit).trim();
        }
        finally { future.cancel(true); }
    }

    static String extractBeforeDeadline(Callable<String> operation, long deadline) throws Exception {
        if (SystemClock.elapsedRealtime() >= deadline) throw new TimeoutException("Extraction deadline expired");
        Future<String> future = EXTRACTORS.submit(() -> {
            if (SystemClock.elapsedRealtime() >= deadline) throw new TimeoutException("Extraction deadline expired");
            return operation.call();
        });
        try {
            return future.get(Math.max(0, deadline - SystemClock.elapsedRealtime()), TimeUnit.MILLISECONDS).trim();
        } finally {
            // Interrupting execute stops its process group in its finally block.
            future.cancel(true);
        }
    }

    /** youtubedl-android records the release its updater installed under this key. */
    static String installedVersion(Context context) {
        return context.getSharedPreferences("youtubedl-android", Context.MODE_PRIVATE).getString("dlpVersion", null);
    }

    private static void recordVersion(Context context, String version) {
        context.getSharedPreferences("youtubedl-android", Context.MODE_PRIVATE).edit().putString("dlpVersion", version).commit();
    }

    /** Installs the latest release of the repository unless it is already installed. */
    static boolean update(Context context, String repository) throws Exception {
        initialize(context);
        String tag = YtDlpRelease.latestTag("https://github.com", repository);
        if (tag.equals(installedVersion(context))) return false;
        File installation = new File(context.getNoBackupFilesDir(), "youtubedl-android");
        File download = File.createTempFile("yt-dlp", null, context.getCacheDir());
        try {
            // Release downloads, unlike the REST API, have no rate limit for unauthenticated clients.
            HttpURLConnection connection = (HttpURLConnection) new URL("https://github.com/" + repository + "/releases/download/" + tag + "/yt-dlp").openConnection();
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(15_000);
            try (InputStream input = connection.getInputStream(); OutputStream output = new FileOutputStream(download)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            } finally { connection.disconnect(); }
            // Running processes keep the previous release until the download completes.
            INSTALL_LOCK.writeLock().lockInterruptibly();
            try {
                File binary = new File(installation, "yt-dlp/yt-dlp");
                Files.createDirectories(binary.getParentFile().toPath());
                Files.move(download.toPath(), binary.toPath(), StandardCopyOption.REPLACE_EXISTING);
                YtDlpCodeCache.invalidate(new File(installation, "yt-dlp-code"));
                recordVersion(context, tag);
            }
            finally { INSTALL_LOCK.writeLock().unlock(); }
            return true;
        } finally { download.delete(); }
    }

    static String ffmpegVersion(Context context, String binary) throws Exception {
        initialize(context);
        Process process = command(context, asList(new File(context.getApplicationInfo().nativeLibraryDir, "lib" + binary + ".so").getAbsolutePath(), "-version"))
            .redirectErrorStream(true).start();
        try {
            String line;
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) { line = reader.readLine(); }
            if (line == null || !line.startsWith(binary + " version ")) throw new IOException("Unable to read " + binary + " version: " + line);
            return line.split(" ")[2];
        } finally { process.destroy(); }
    }

    static void cancel(long id) {
        RunningProcess process = PROCESSES.get("download-" + id);
        if (process != null) process.stop();
    }

}
