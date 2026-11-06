package org.opentubex.app;

import static java.util.Arrays.asList;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import java.io.*;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import static org.junit.Assert.*;

public class YtDlpRuntimeTest {
    @Test public void rumbleLinkPlaysInWebView() throws Exception {
        String url = InstrumentationRegistry.getArguments().getString("rumbleUrl");
        org.junit.Assume.assumeNotNull(url);
        try (var scenario = androidx.test.core.app.ActivityScenario.launch(MainActivity.class)) {
            java.util.concurrent.atomic.AtomicReference<android.webkit.WebView> reference = new java.util.concurrent.atomic.AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            android.webkit.WebView view = reference.get();
            awaitRumble(view, "!!document.querySelector('.app.capacitorTabs')");
            awaitRumble(view, "!document.getElementById('startup-splash')");
            evaluateRumble(view, "document.querySelector('.tutorialActions button')?.click()");
            awaitRumble(view, "!document.querySelector('.tutorialOverlay')");
            evaluateRumble(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({path:'/external-media',query:{url:" + JSONObject.quote(url) + "}})");
            awaitRumble(view, "document.querySelector('.externalMediaPlayer video')?.readyState >= 1");
            if ("true".equals(evaluateRumble(view, "document.querySelector('.externalMediaPlayer video').paused"))) {
                JSONObject point = new JSONObject((String) new org.json.JSONTokener(evaluateRumble(view,
                    "JSON.stringify((() => { const b = document.querySelector('.shaka-play-button') ?? document.querySelector('.externalMediaPlayer video'); const r = b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })())")).nextValue());
                int[] origin = new int[2];
                InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.getLocationOnScreen(origin));
                double scale = view.getWidth() / Double.parseDouble(evaluateRumble(view, "window.innerWidth"));
                float x = origin[0] + (float) (point.getDouble("x") * scale);
                float y = origin[1] + (float) (point.getDouble("y") * scale);
                long now = android.os.SystemClock.uptimeMillis();
                android.view.MotionEvent down = android.view.MotionEvent.obtain(now, now, android.view.MotionEvent.ACTION_DOWN, x, y, 0);
                android.view.MotionEvent up = android.view.MotionEvent.obtain(now, now + 50, android.view.MotionEvent.ACTION_UP, x, y, 0);
                try {
                    InstrumentationRegistry.getInstrumentation().sendPointerSync(down);
                    InstrumentationRegistry.getInstrumentation().sendPointerSync(up);
                } finally { down.recycle(); up.recycle(); }
            }
            awaitRumble(view, "document.querySelector('.externalMediaPlayer video')?.currentTime > 1");
            double before = Double.parseDouble(evaluateRumble(view, "document.querySelector('.externalMediaPlayer video').currentTime"));
            awaitRumble(view, "document.querySelector('.externalMediaPlayer video').currentTime > " + (before + 0.5));
            awaitRumble(view, "((v) => !('webkitAudioDecodedByteCount' in v) || v.webkitAudioDecodedByteCount > 0)(document.querySelector('.externalMediaPlayer video'))");
            evaluateRumble(view, "document.querySelector('.externalMediaPlayer video').pause()");
        }
    }

    private static String evaluateRumble(android.webkit.WebView view, String script) throws Exception {
        java.util.concurrent.CompletableFuture<String> result = new java.util.concurrent.CompletableFuture<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, result::complete));
        return result.get(5, java.util.concurrent.TimeUnit.SECONDS);
    }

    private static void awaitRumble(android.webkit.WebView view, String condition) throws Exception {
        long deadline = System.currentTimeMillis() + 60000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(evaluateRumble(view, condition))) return;
            if (condition.contains("video") && "true".equals(evaluateRumble(view, "!!document.querySelector('.externalMediaDiagnostic')"))) break;
            Thread.sleep(100);
        }
        fail("Rumble UI condition failed: " + condition + "; " + evaluateRumble(view,
            "JSON.stringify({diagnostic:document.querySelector('.externalMediaDiagnostic')?.textContent,video:(() => {const v=document.querySelector('.externalMediaPlayer video');return v && {ready:v.readyState,paused:v.paused,time:v.currentTime,audio:v.webkitAudioDecodedByteCount,error:v.error?.message};})()})"));
    }

    @Test public void packagedRumbleTransportPreservesCookiesRedirectsAndHttpErrors() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        YtDlpRuntime.initialize(context);
        File directory = new File(context.getCacheDir(), "rumble-http-test-" + java.util.UUID.randomUUID());
        directory.mkdirs();
        File fixture = new File(directory, "smoke.py");
        File bootstrap = new File(directory, "bootstrap.py");
        File group = new File(directory, "group");
        try {
            try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("yt-dlp-rumble-http-smoke.py")) {
                YtDlpFiles.write(fixture, YtDlpFiles.read(input, 64 * 1024));
            }
            try (InputStream input = context.getAssets().open("opentubex_rumble_http.py")) {
                YtDlpFiles.write(bootstrap, YtDlpFiles.read(input, 64 * 1024));
            }
            File installation = new File(context.getNoBackupFilesDir(), "youtubedl-android");
            File entryPoint = YtDlpCodeCache.prepare(new File(installation, "yt-dlp/yt-dlp"), new File(installation, "yt-dlp-code"));
            var command = YtDlpRuntime.class.getDeclaredMethod("command", Context.class, List.class);
            command.setAccessible(true);
            ProcessBuilder builder = (ProcessBuilder) command.invoke(null, context, asList(
                context.getApplicationInfo().nativeLibraryDir + "/libpython.so", fixture.getPath(),
                entryPoint.getPath(), bootstrap.getPath(), group.getPath()));
            Process process = builder.redirectErrorStream(true).start();
            try {
                assertTrue("Rumble transport smoke test timed out", process.waitFor(20, java.util.concurrent.TimeUnit.SECONDS));
                String output = new String(YtDlpFiles.read(process.getInputStream(), 64 * 1024), java.nio.charset.StandardCharsets.UTF_8);
                assertEquals(output, 0, process.exitValue());
                assertTrue(output, output.contains("RUMBLE_HTTP_OK"));
            } finally {
                try {
                    if (group.isFile()) {
                        int pid = Integer.parseInt(new String(YtDlpFiles.readFile(group), java.nio.charset.StandardCharsets.US_ASCII));
                        try { android.system.Os.kill(-pid, android.system.OsConstants.SIGKILL); }
                        catch (android.system.ErrnoException ignored) { /* Already exited. */ }
                    }
                } finally { process.destroy(); }
            }
        } finally { YtDlpFiles.deleteTree(directory); }
    }

    @Test public void rumblePlaybackExtractsFormats() throws Exception {
        String url = InstrumentationRegistry.getArguments().getString("rumbleUrl");
        org.junit.Assume.assumeNotNull(url);
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        JSONObject info = new JSONObject(YtDlpRuntime.extract(context, asList(
            "--no-playlist", "--socket-timeout", "15", "--skip-download", "--dump-single-json", url)));
        assertFalse(info.getString("title").isEmpty());
        assertTrue("Rumble must return playable formats", info.getJSONArray("formats").length() > 0);
    }

    @Test public void bundledRuntimeReusesCompiledPythonBetweenOperations() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String version = YtDlpRuntime.extract(context, asList("--version"));
        File bytecode = new File(context.getNoBackupFilesDir(), "youtubedl-android/yt-dlp-code/yt_dlp/__pycache__");
        File[] compiled = bytecode.listFiles((directory, name) -> name.endsWith(".pyc"));
        assertNotNull("Repeated operations must reuse compiled Python rather than compile the archive again", compiled);
        assertTrue(compiled.length > 0);
        java.util.Map<File, Long> written = new java.util.HashMap<>();
        for (File file : compiled) written.put(file, file.lastModified());
        assertEquals(version, YtDlpRuntime.extract(context, asList("--version")));
        for (File file : compiled) assertEquals("Warm startup must reuse bytecode", written.get(file).longValue(), file.lastModified());
        File directory = new File(context.getNoBackupFilesDir(), "youtubedl-android/yt-dlp-code");
        YtDlpCodeCache.invalidate(directory);
        assertFalse(new File(directory, ".archive-version").exists());
        assertEquals(version, YtDlpRuntime.extract(context, asList("--version")));
        assertTrue(new File(directory, ".archive-version").isFile());
    }

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
            File installation = new File(context.getNoBackupFilesDir(), "youtubedl-android");
            File entryPoint = YtDlpCodeCache.prepare(new File(installation, "yt-dlp/yt-dlp"), new File(installation, "yt-dlp-code"));
            ProcessBuilder builder = (ProcessBuilder) command.invoke(null, context, asList(
                nativeDir + "/libpython.so", fixture.getPath(),
                entryPoint.getPath(),
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

    @Test public void mp3CoverArtDoesNotRemuxTheAudioAgain() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(context.getCacheDir(), "yt-dlp-mp3-tags-" + java.util.UUID.randomUUID());
        directory.mkdirs();
        File fixture = new File(directory, "source.mp3");
        File cover = new File(directory, "cover.png");
        File info = new File(directory, "info.json");
        List<String> log = new java.util.concurrent.CopyOnWriteArrayList<>();
        try {
            try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("demo-audio.mp3")) {
                YtDlpFiles.write(fixture, YtDlpFiles.read(input, 1024 * 1024));
            }
            byte[] picture = android.util.Base64.decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQSTkBAAHQAUHAZ3dkAAAAAElFTkSuQmCC", android.util.Base64.DEFAULT);
            YtDlpFiles.write(cover, picture);
            JSONObject metadata = new JSONObject().put("id", "mp3-tags").put("title", "Cover art – Qualität")
                .put("uploader", "OpenTubeX").put("ext", "mp3").put("extractor", "generic")
                .put("url", fixture.toURI().toString()).put("webpage_url", "https://example.com/mp3-tags")
                .put("thumbnails", new JSONArray().put(new JSONObject().put("url", cover.toURI().toString())));
            YtDlpFiles.write(info, metadata.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            for (boolean embedCover : new boolean[] { false, true }) {
                List<String> args = new java.util.ArrayList<>(asList("--enable-file-urls", "--load-info-json", info.getPath(),
                    "--extract-audio", "--audio-format", "mp3", "--embed-metadata", "--verbose", "--output",
                    new File(directory, (embedCover ? "covered" : "metadata") + ".%(ext)s").getPath()));
                if (embedCover) args.add("--embed-thumbnail");
                log.clear();
                YtDlpRuntime.execute(context, args, "mp3-tags-test", log::add);
                assertEquals("Cover art must not scan and remux every audio frame", 1,
                    log.stream().filter(line -> line.startsWith("[debug] ffmpeg command line:") && line.contains("/libffmpeg.so")).count());
            }
            File output = new File(directory, "covered.mp3");
            assertArrayEquals("Cover art must preserve the encoded audio frames",
                mp3Frames(new File(directory, "metadata.mp3")), mp3Frames(output));
            android.media.MediaMetadataRetriever media = new android.media.MediaMetadataRetriever();
            try {
                media.setDataSource(output.getPath());
                assertEquals("Cover art – Qualität", media.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_TITLE));
                assertEquals("OpenTubeX", media.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_ARTIST));
                assertArrayEquals(picture, media.getEmbeddedPicture());
                assertTrue(Long.parseLong(media.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)) > 0);
            } finally { media.release(); }
        } finally { YtDlpFiles.deleteTree(directory); }
    }

    private static byte[] mp3Frames(File file) throws IOException {
        byte[] bytes = YtDlpFiles.readFile(file);
        int start = 0, end = bytes.length;
        if (bytes.length >= 10 && bytes[0] == 'I' && bytes[1] == 'D' && bytes[2] == '3') {
            start = 10 + ((bytes[6] & 127) << 21) + ((bytes[7] & 127) << 14) + ((bytes[8] & 127) << 7) + (bytes[9] & 127);
        }
        if (end >= 128 && bytes[end - 128] == 'T' && bytes[end - 127] == 'A' && bytes[end - 126] == 'G') end -= 128;
        return java.util.Arrays.copyOfRange(bytes, start, end);
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
