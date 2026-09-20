package org.opentubex.app;

import static java.util.Arrays.asList;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import java.io.*;
import java.util.List;
import static org.junit.Assert.*;

public class YtDlpRuntimeTest {
    @Test public void packagedQuickJsRunsTheBundledEjsSolverWithoutNetwork() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        YtDlpRuntime.initialize(context);
        File fixture = new File(context.getCacheDir(), "yt-dlp-ejs-smoke.py");
        File group = new File(context.getCacheDir(), "yt-dlp-ejs-group-" + java.util.UUID.randomUUID());
        try {
            try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("yt-dlp-ejs-smoke.py")) {
                YtDlpFiles.write(fixture, YtDlpFiles.read(input, 64 * 1024));
            }
            java.lang.reflect.Method command = YtDlpRuntime.class.getDeclaredMethod("command", Context.class, List.class);
            command.setAccessible(true);
            String nativeDir = context.getApplicationInfo().nativeLibraryDir;
            ProcessBuilder builder = (ProcessBuilder) command.invoke(null, context, asList(
                nativeDir + "/libpython.so", fixture.getPath(),
                new File(context.getNoBackupFilesDir(), "youtubedl-android/yt-dlp/yt-dlp").getPath(),
                nativeDir + "/libqjs.so", group.getPath()));
            Process process = builder.redirectErrorStream(true).start();
            try {
                assertTrue("EJS smoke test timed out", process.waitFor(30, java.util.concurrent.TimeUnit.SECONDS));
                String output = new String(YtDlpFiles.read(process.getInputStream(), 64 * 1024), java.nio.charset.StandardCharsets.UTF_8);
                assertEquals(output, 0, process.exitValue());
                assertTrue(output, output.contains("EJS_QUICKJS_OK"));
            } finally {
                // QuickJS is a child of Python; stopping only Python can leave the solver running.
                try {
                    if (group.isFile()) {
                        int pid = Integer.parseInt(new String(YtDlpFiles.readFile(group), java.nio.charset.StandardCharsets.US_ASCII));
                        try { android.system.Os.kill(-pid, android.system.OsConstants.SIGKILL); }
                        catch (android.system.ErrnoException ignored) { /* The session already exited. */ }
                    }
                } finally { process.destroy(); }
            }
        } finally { fixture.delete(); group.delete(); }
    }

    @Test public void bundledRuntimeDownloadsAndConvertsAudioWithoutNetwork() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context testContext = InstrumentationRegistry.getInstrumentation().getContext();
        File directory = new File(context.getCacheDir(), "yt-dlp-runtime-test");
        directory.mkdirs();
        File fixture = new File(directory, "demo.webm");
        try {
            try (InputStream input = testContext.getAssets().open("demo.webm")) {
                YtDlpFiles.write(fixture, YtDlpFiles.read(input, 1024 * 1024));
            }
            assertFalse(YtDlpRuntime.ffmpegVersion(context, "ffmpeg").isEmpty());
            assertFalse(YtDlpRuntime.ffmpegVersion(context, "ffprobe").isEmpty());
            assertTrue(YtDlpRuntime.extract(context, asList("--version")).matches("[0-9].*"));
            String metadata = YtDlpRuntime.extract(context, asList("--enable-file-urls", "--dump-single-json", fixture.toURI().toString()));
            assertTrue(metadata.contains("demo"));
            YtDlpRuntime.execute(context, asList("--enable-file-urls", "--extract-audio", "--audio-format", "mp3", "--output",
                new File(directory, "converted.%(ext)s").getAbsolutePath(), fixture.toURI().toString()), "runtime-test", null);
            assertTrue(new File(directory, "converted.mp3").length() > 0);
        } finally { YtDlpFiles.deleteTree(directory); }
    }

    @Test public void cancellationAlsoStopsPostprocessorChildren() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context testContext = InstrumentationRegistry.getInstrumentation().getContext();
        File directory = new File(context.getCacheDir(), "yt-dlp-cancel-test");
        directory.mkdirs();
        File fixture = new File(directory, "demo.webm");
        java.util.concurrent.atomic.AtomicReference<Throwable> failure = new java.util.concurrent.atomic.AtomicReference<>();
        try (InputStream input = testContext.getAssets().open("demo.webm")) {
            YtDlpFiles.write(fixture, YtDlpFiles.read(input, 1024 * 1024));
        }
        Thread download = new Thread(() -> {
            try {
                YtDlpRuntime.execute(context, asList("--enable-file-urls", "--output",
                    new File(directory, "copy.%(ext)s").getAbsolutePath(), "--extract-audio", "--audio-format", "mp3",
                    "--postprocessor-args", "ExtractAudio+ffmpeg_i:-re",
                    fixture.toURI().toString()), "download-987654321", null);
            } catch (Exception error) { failure.set(error); }
        });
        try {
            download.start();
            long deadline = System.currentTimeMillis() + 15000;
            int pid = 0;
            while (pid == 0 && download.isAlive() && System.currentTimeMillis() < deadline) {
                for (File process : new File("/proc").listFiles()) {
                    try {
                        if (android.system.Os.readlink(new File(process, "exe").getPath()).endsWith("/libffmpeg.so") &&
                            new String(YtDlpFiles.readFile(new File(process, "cmdline"))).contains(directory.getAbsolutePath())) {
                            pid = Integer.parseInt(process.getName());
                            break;
                        }
                    } catch (Exception ignored) { }
                }
                if (pid == 0) Thread.sleep(20);
            }
            assertTrue("Postprocessor did not start: " + failure.get(), pid > 0);
            YtDlpRuntime.cancel(987654321);
            download.join(5000);
            assertFalse("Cancellation left the download running", download.isAlive());
            boolean alive = true;
            deadline = System.currentTimeMillis() + 3000;
            while (alive && System.currentTimeMillis() < deadline) {
                try { android.system.Os.kill(pid, 0); Thread.sleep(50); }
                catch (android.system.ErrnoException gone) { alive = false; }
            }
            assertFalse("Cancellation left a postprocessor running", alive);
        } finally {
            YtDlpRuntime.cancel(987654321);
            download.interrupt();
            download.join(5000);
            YtDlpFiles.deleteTree(directory);
        }
    }
}
