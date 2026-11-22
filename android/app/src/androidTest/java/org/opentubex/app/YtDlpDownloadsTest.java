package org.opentubex.app;

import static java.util.Arrays.asList;

import android.content.Context;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.documentfile.provider.DocumentFile;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class YtDlpDownloadsTest {
    @Test public void queueResumesPersistsExportsAndDeletesPlayableMedia() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context test = InstrumentationRegistry.getInstrumentation().getContext();
        File state = new File(context.getCacheDir(), "yt-dlp-queue-" + UUID.randomUUID());
        state.mkdirs();
        YtDlpFiles.write(new File(state, "yt-dlp-downloads.json"), new JSONObject().put("counter", System.currentTimeMillis()).toString().getBytes(StandardCharsets.UTF_8));
        DocumentFile tree = tree(context);
        DocumentFile folder = tree.createDirectory(UUID.randomUUID().toString());
        assertNotNull(folder);
        String folderUri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", DocumentsContract.getDocumentId(folder.getUri())).toString();
        grant(context, Uri.parse(folderUri));
        YtDlpDownloads queue = new YtDlpDownloads(context, state, () -> {});
        Thread running = null;
        try (FixtureServer server = new FixtureServer(test)) {
            JSONObject config = new JSONObject().put("enabled", true).put("folder", folderUri).put("concurrency", 1);
            JSONObject payload = new JSONObject().put("mode", "video").put("videoId", "___________").put("title", "Queue test");
            JSONArray args = new JSONArray(asList("--output", "demo.%(ext)s", "--write-info-json", "--limit-rate", "20K", server.url()));
            long id = queue.add(payload, args, config, -1).getLong("id");
            long second = queue.add(payload, args, config, -1).getLong("id");
            assertEquals(asList(id), queue.claim());
            running = new Thread(() -> queue.run(id));
            running.start();
            long deadline = System.currentTimeMillis() + 15000;
            while (queue.list().getJSONObject(0).optDouble("percent") < 1 && running.isAlive() && System.currentTimeMillis() < deadline) Thread.sleep(50);
            assertTrue("Download failed before pause: " + queue.list(), running.isAlive());
            assertTrue(queue.control(id, "pause", 0));
            running.join(5000);
            assertFalse(running.isAlive());
            assertEquals("paused", queue.list().getJSONObject(0).getString("status"));
            assertTrue(queue.control(second, "cancel", 0));
            assertTrue(queue.control(id, "resume", 0));
            // Reconstruct ownership as after an Android process restart; the same partial file remains.
            YtDlpDownloads resumed = new YtDlpDownloads(context, state, () -> {});
            assertEquals(asList(id), resumed.claim());
            resumed.run(id);
            JSONObject completed = resumed.list().getJSONObject(0);
            assertEquals(completed.toString(), "completed", completed.getString("status"));
            assertTrue("Resume did not use the partial file", server.rangeRequests.get() > 0);
            assertEquals(1, completed.getJSONArray("files").length());
            Uri uri = Uri.parse(completed.getJSONArray("files").getJSONObject(0).getString("path"));
            assertEquals("Open the media rather than its JSON sidecar", uri, resumed.firstFile(id));
            MediaMetadataRetriever media = new MediaMetadataRetriever();
            try {
                media.setDataSource(context, uri);
                assertTrue(Long.parseLong(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)) > 0);
            } finally { media.release(); }
            YtDlpDownloads persisted = new YtDlpDownloads(context, state, () -> {});
            assertEquals("available", persisted.list().getJSONObject(0).getString("availability"));
            assertEquals(2, folder.listFiles().length);
            assertTrue(persisted.remove(id));
            assertEquals(0, folder.listFiles().length);
            assertEquals(1, persisted.list().length());
        } finally {
            queue.cancelAll();
            if (running != null) { running.interrupt(); running.join(5000); }
            folder.delete();
            YtDlpFiles.deleteTree(state);
        }
    }

    @Test public void failedPlaylistExportsSuccessfulEntriesAndRetryDoesNotDuplicateThem() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File state = new File(context.getCacheDir(), "yt-dlp-partial-" + UUID.randomUUID());
        state.mkdirs();
        DocumentFile folder = tree(context).createDirectory(UUID.randomUUID().toString());
        assertNotNull(folder);
        String folderUri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", DocumentsContract.getDocumentId(folder.getUri())).toString();
        grant(context, Uri.parse(folderUri));
        YtDlpDownloads queue = new YtDlpDownloads(context, state, () -> {});
        try (FixtureServer server = new FixtureServer(InstrumentationRegistry.getInstrumentation().getContext())) {
            JSONObject config = new JSONObject().put("enabled", true).put("folder", folderUri);
            JSONObject payload = new JSONObject().put("mode", "video").put("videoId", "___________");
            JSONArray args = new JSONArray(asList("--output", "%(id)s.%(ext)s", server.url(), server.url().replace("demo.webm", "missing.webm")));
            long id = queue.add(payload, args, config, -1).getLong("id");
            assertEquals(asList(id), queue.claim());
            queue.run(id);
            JSONObject failed = queue.list().getJSONObject(0);
            assertEquals("failed", failed.getString("status"));
            assertEquals("Completed entries must remain playable after a playlist error", 1, failed.getJSONArray("files").length());
            assertNotNull(queue.firstFile(id));
            assertEquals(1, folder.listFiles().length);
            assertEquals(id, queue.add(payload, args, config, id).getLong("id"));
            assertEquals(asList(id), queue.claim());
            queue.run(id);
            assertEquals(1, queue.list().getJSONObject(0).getJSONArray("files").length());
            assertEquals("Retry must reuse exported entries", 1, folder.listFiles().length);
            long size = queue.list().getJSONObject(0).getLong("sizeBytes");
            assertTrue(folder.listFiles()[0].delete());
            assertEquals(id, queue.add(payload, args, config, id).getLong("id"));
            assertEquals(asList(id), queue.claim());
            queue.run(id);
            JSONObject replaced = queue.list().getJSONObject(0);
            assertEquals("Retry must replace a deleted export", "available", replaced.getString("availability"));
            assertEquals(1, replaced.getJSONArray("destinations").length());
            assertEquals(1, replaced.getJSONArray("files").length());
            assertEquals("Replacement must not double-count bytes", size, replaced.getLong("sizeBytes"));
            assertNotNull(queue.firstFile(id));
            assertTrue(queue.remove(id));
            assertEquals(0, folder.listFiles().length);
        } finally { queue.cancelAll(); folder.delete(); YtDlpFiles.deleteTree(state); }
    }

    @Test public void retriedLocalPlaylistKeepsTheFileNamesOfEntriesAfterAFailedOne() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File state = new File(context.getCacheDir(), "yt-dlp-renumbered-" + UUID.randomUUID());
        state.mkdirs();
        DocumentFile folder = tree(context).createDirectory(UUID.randomUUID().toString());
        assertNotNull(folder);
        String folderUri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", DocumentsContract.getDocumentId(folder.getUri())).toString();
        grant(context, Uri.parse(folderUri));
        YtDlpDownloads queue = new YtDlpDownloads(context, state, () -> {});
        try (FixtureServer server = new FixtureServer(InstrumentationRegistry.getInstrumentation().getContext())) {
            JSONObject config = new JSONObject().put("enabled", true).put("folder", folderUri);
            JSONObject payload = new JSONObject().put("mode", "video").put("videoId", "").put("isPlaylist", true)
                .put("videoIds", new JSONArray(asList("aaaaaaaaaaa", "bbbbbbbbbbb")));
            // Like a local playlist's arguments from src/ytDlpArguments.js, whose first video fails at first.
            JSONArray args = new JSONArray(asList("--output", "%(opentubex_playlist_index)03d.%(ext)s",
                "--parse-metadata", YtDlpArguments.LOCAL_PLAYLIST_INDEX_METADATA,
                server.url().replace("demo.webm", "missing.webm") + "?index=1", server.url() + "?index=2"));
            long id = queue.add(payload, args, config, -1).getLong("id");
            assertEquals(asList(id), queue.claim());
            queue.run(id);
            assertEquals(1, queue.list().getJSONObject(0).getJSONArray("files").length());
            server.missingAvailable = true;
            assertEquals(id, queue.add(payload, args, config, id).getLong("id"));
            assertEquals(asList(id), queue.claim());
            queue.run(id);
            JSONObject completed = queue.list().getJSONObject(0);
            assertEquals(completed.toString(), "completed", completed.getString("status"));
            assertEquals(completed.toString(), 2, completed.getJSONArray("files").length());
            // The fixture serves the same media for both, so compare which entry each file holds.
            java.util.Map<String, String> names = new java.util.TreeMap<>();
            JSONArray files = completed.getJSONArray("files");
            for (int i = 0; i < files.length(); i++) {
                JSONObject file = files.getJSONObject(i);
                names.put(DocumentFile.fromSingleUri(context, Uri.parse(file.getString("path"))).getName(), file.getString("videoId"));
            }
            assertEquals(2, folder.listFiles().length);
            java.util.Map<String, String> expected = new java.util.TreeMap<>();
            expected.put("001.webm", "missing");
            expected.put("002.webm", "demo");
            assertEquals("The first video must not take the second one's file name", expected, names);
            assertTrue(queue.remove(id));
        } finally { queue.cancelAll(); folder.delete(); YtDlpFiles.deleteTree(state); }
    }

    @Test public void concurrentProcessesKeepTheCookiesEachOfThemReceived() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(context.getCacheDir(), "yt-dlp-cookie-merge-" + UUID.randomUUID());
        directory.mkdirs();
        File cookies = new File(directory, "cookies.txt");
        try (FixtureServer server = new FixtureServer(InstrumentationRegistry.getInstrumentation().getContext())) {
            YtDlpFiles.write(cookies, ("# Netscape HTTP Cookie File\n" + server.host() + "\tFALSE\t/\tFALSE\t4102444800\tsession\tbefore\n").getBytes(StandardCharsets.UTF_8));
            // Both processes load the cookies when they extract, before either saves them. The one
            // that exits last used to replace the file with its own cookies, losing the other's.
            Exception[] errors = new Exception[2];
            List<Thread> processes = new java.util.ArrayList<>();
            for (int index = 0; index < 2; index++) {
                int part = index;
                Thread process = new Thread(() -> {
                    try {
                        YtDlpRuntime.execute(context, asList("--paths", directory.getAbsolutePath(), "--output", part + ".%(ext)s",
                            "--sleep-interval", part == 0 ? "1" : "5", "--cookies", cookies.getAbsolutePath(), server.url() + "?cookie=part" + part), null, null);
                    } catch (Exception error) { errors[part] = error; }
                });
                processes.add(process);
                process.start();
            }
            for (Thread process : processes) process.join();
            for (Exception error : errors) if (error != null) throw error;
            String saved = new String(YtDlpFiles.readFile(cookies), StandardCharsets.UTF_8);
            for (String cookie : asList("\tsession\tbefore\n", "\tpart0\trotated\n", "\tpart1\trotated\n")) assertTrue(saved, saved.contains(cookie));
            assertEquals("Private cookie copies must be removed", 0, context.getCacheDir().listFiles((dir, name) -> name.startsWith("yt-dlp-cookies-") && name.endsWith(".txt")).length);
        } finally { YtDlpFiles.deleteTree(directory); }
    }

    @Test public void playlistWithUnavailableEntriesCompletesWithTheirErrors() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File state = new File(context.getCacheDir(), "yt-dlp-skipped-" + UUID.randomUUID());
        state.mkdirs();
        DocumentFile folder = tree(context).createDirectory(UUID.randomUUID().toString());
        assertNotNull(folder);
        String folderUri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", DocumentsContract.getDocumentId(folder.getUri())).toString();
        grant(context, Uri.parse(folderUri));
        YtDlpDownloads queue = new YtDlpDownloads(context, state, () -> {});
        try (FixtureServer server = new FixtureServer(InstrumentationRegistry.getInstrumentation().getContext())) {
            JSONObject config = new JSONObject().put("enabled", true).put("folder", folderUri);
            JSONObject payload = new JSONObject().put("mode", "video").put("videoId", "").put("isPlaylist", true);
            JSONArray args = new JSONArray(asList("--output", "%(id)s.%(ext)s", server.url().replace("demo.webm", "missing.webm"), server.url()));
            long id = queue.add(payload, args, config, -1).getLong("id");
            assertEquals(asList(id), queue.claim());
            queue.run(id);
            JSONObject completed = queue.list().getJSONObject(0);
            assertEquals(completed.toString(), "completed", completed.getString("status"));
            assertEquals(1, completed.getJSONArray("files").length());
            String error = completed.getString("errorMessage");
            assertTrue(error, error.startsWith("ERROR:") && error.contains("404"));
            assertFalse("Progress lines must not hide the skipped entries", error.contains("[download]"));
            assertFalse("Completed playlists must not keep staging data", new File(new File(state, "yt-dlp-downloads"), Long.toString(id)).exists());
            assertTrue(queue.remove(id));
        } finally { queue.cancelAll(); folder.delete(); YtDlpFiles.deleteTree(state); }
    }

    @Test public void playlistPartsDownloadInParallelWithinTheQueueLimit() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File state = new File(context.getCacheDir(), "yt-dlp-parallel-" + UUID.randomUUID());
        state.mkdirs();
        DocumentFile folder = tree(context).createDirectory(UUID.randomUUID().toString());
        assertNotNull(folder);
        String folderUri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", DocumentsContract.getDocumentId(folder.getUri())).toString();
        grant(context, Uri.parse(folderUri));
        YtDlpDownloads queue = new YtDlpDownloads(context, state, () -> {});
        try (FixtureServer server = new FixtureServer(InstrumentationRegistry.getInstrumentation().getContext())) {
            JSONObject config = new JSONObject().put("enabled", true).put("folder", folderUri).put("concurrency", 2);
            JSONObject payload = new JSONObject().put("mode", "video").put("videoId", "").put("isPlaylist", true)
                .put("videoIds", new JSONArray(asList("aaaaaaaaaaa", "bbbbbbbbbbb")));
            // Like src/ytDlpArguments.js, each part names the video it works on.
            JSONArray args = new JSONArray(asList("--output", "%(autonumber)s.%(ext)s", "--no-simulate", "--print",
                "video:__OPENTUBEX_PREPARING__:%(id)s\t%(playlist_index|)s\t%(playlist_count,n_entries|)s\t%(title)j",
                server.url(), server.url() + "?second"));
            List<JSONObject> published = new java.util.concurrent.CopyOnWriteArrayList<>();
            queue.observe(published::add);
            long id = queue.add(payload, args, config, -1, 2).getLong("id");
            JSONObject single = new JSONObject().put("mode", "video").put("videoId", "___________");
            long next = queue.add(single, new JSONArray(asList("--output", "single.%(ext)s", server.url())), config, -1).getLong("id");
            assertEquals(asList(id), queue.claim());
            assertEquals("The playlist parts must hold both slots", asList(), queue.claim());
            queue.run(id);
            JSONObject completed = null;
            for (int i = 0; i < queue.list().length(); i++) {
                if (queue.list().getJSONObject(i).getLong("id") == id) completed = queue.list().getJSONObject(i);
            }
            assertNotNull(completed);
            assertEquals(completed.toString(), "completed", completed.getString("status"));
            assertEquals("Each part must keep its own autonumber", 2, completed.getJSONArray("files").length());
            boolean listedVideos = false;
            for (JSONObject record : published) {
                JSONArray videos = record.optJSONArray("activeVideos");
                for (int i = 0; videos != null && i < videos.length(); i++) {
                    listedVideos = true;
                    assertFalse(record.toString(), videos.getJSONObject(i).getString("title").isEmpty());
                }
            }
            assertTrue("Split playlists must list the video of each running part", listedVideos);
            assertFalse("Finished downloads must not list running videos", completed.has("activeVideos"));
            assertEquals(2, folder.listFiles().length);
            assertEquals("Finished parts must free their slots", asList(next), queue.claim());
        } finally { queue.cancelAll(); folder.delete(); YtDlpFiles.deleteTree(state); }
    }

    @Test public void interruptedExportReusesItsAllocatedDocument() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File root = new File(context.getCacheDir(), "yt-dlp-export-" + UUID.randomUUID());
        root.mkdirs();
        File source = new File(root, "video.webm");
        byte[] content = new byte[1024];
        YtDlpFiles.write(source, content);
        DocumentFile tree = tree(context);
        DocumentFile folder = tree.createDirectory(UUID.randomUUID().toString());
        String folderUri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", DocumentsContract.getDocumentId(folder.getUri())).toString();
        grant(context, Uri.parse(folderUri));
        try {
            Uri existing = folder.createFile("video/webm", source.getName()).getUri();
            Uri result = YtDlpFiles.export(context, root, source, folderUri, existing.toString(), allocated -> assertEquals(existing, allocated));
            assertEquals(existing, result);
            assertEquals(1, folder.listFiles().length);
            try (InputStream input = context.getContentResolver().openInputStream(result)) { assertArrayEquals(content, YtDlpFiles.read(input, 2048)); }
        } finally { folder.delete(); YtDlpFiles.deleteTree(root); }
    }

    @Test public void externalDownloadsDoNotUseConfiguredCookies() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File state = new File(context.getCacheDir(), "yt-dlp-external-cookies-" + UUID.randomUUID());
        state.mkdirs();
        DocumentFile folder = tree(context).createDirectory(UUID.randomUUID().toString());
        assertNotNull(folder);
        String folderUri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", DocumentsContract.getDocumentId(folder.getUri())).toString();
        grant(context, Uri.parse(folderUri));
        try {
            YtDlpDownloads queue = new YtDlpDownloads(context, state, () -> {});
            JSONObject config = new JSONObject().put("enabled", true).put("folder", folderUri)
                .put("useCookies", true).put("cookies", "/private/session.txt");
            JSONObject payload = new JSONObject().put("mode", "video").put("externalUrl", "http://example.org/video.mp4");
            JSONArray args = new JSONArray(asList("--output", "%(id)s.%(ext)s", "http://example.org/video.mp4"));
            queue.add(payload, args, config, -1);
            JSONObject record = queue.list().getJSONObject(0);
            assertFalse(record.optBoolean("useCookies"));
            assertEquals("", record.optString("cookies"));
        } finally { folder.delete(); YtDlpFiles.deleteTree(state); }
    }

    @Test public void automaticDownloadsWaitForChargingAndUnmeteredNetwork() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File state = new File(context.getCacheDir(), "yt-dlp-conditions-" + UUID.randomUUID());
        state.mkdirs();
        DocumentFile folder = tree(context).createDirectory(UUID.randomUUID().toString());
        assertNotNull(folder);
        String folderUri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", DocumentsContract.getDocumentId(folder.getUri())).toString();
        grant(context, Uri.parse(folderUri));
        boolean[] met = {false, false};
        List<String> wakes = new java.util.ArrayList<>();
        YtDlpDownloads queue = new YtDlpDownloads(context, state, () -> {});
        queue.conditions = new YtDlpDownloads.Conditions() {
            @Override public boolean unmetered() { return met[0]; }
            @Override public boolean charging() { return met[1]; }
            @Override public void wakeWhen(boolean unmetered, boolean charging) { wakes.add(unmetered + "/" + charging); }
        };
        try {
            JSONObject config = new JSONObject().put("enabled", true).put("folder", folderUri).put("concurrency", 2)
                .put("automaticRequireUnmetered", true).put("automaticRequireCharging", true);
            JSONArray args = new JSONArray(asList("--output", "%(id)s.%(ext)s", "http://example.org/video.mp4"));
            long automatic = queue.add(new JSONObject().put("mode", "video").put("videoId", "aaaaaaaaaaa").put("automatic", true), args, config, -1).getLong("id");
            long manual = queue.add(new JSONObject().put("mode", "video").put("videoId", "bbbbbbbbbbb"), args, config, -1).getLong("id");
            assertEquals("Manual downloads ignore automatic download requirements", asList(manual), queue.claim());
            assertEquals("unmetered", queue.list().getJSONObject(0).getString("waitingFor"));
            assertFalse(queue.hasQueued());
            assertEquals(asList("true/false"), wakes);
            assertTrue(queue.claim().isEmpty());
            assertEquals("A pending wake-up is not scheduled again", 1, wakes.size());
            met[0] = true;
            assertTrue(queue.claim().isEmpty());
            assertEquals("charging", queue.list().getJSONObject(0).getString("waitingFor"));
            assertEquals("The next unmet requirement gets its own wake-up", asList("true/false", "false/true"), wakes);
            met[1] = true;
            assertTrue(queue.hasQueued());
            assertFalse(queue.list().getJSONObject(0).has("waitingFor"));
            assertFalse("Waiting state changes are saved", new YtDlpDownloads(context, state, () -> {}).list().getJSONObject(0).has("waitingFor"));
            assertEquals(asList(automatic), queue.claim());
        } finally { queue.cancelAll(); folder.delete(); YtDlpFiles.deleteTree(state); }
    }

    @Test public void savedCookiesAreUsedOnlyWhenDownloadsOptInAndSurviveQueueRestart() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File cookies = new File(context.getNoBackupFilesDir(), "yt-dlp-cookies.txt");
        org.junit.Assume.assumeFalse("Cookie regression requires a test profile without a saved session", cookies.exists());
        File state = new File(context.getCacheDir(), "yt-dlp-cookies-" + UUID.randomUUID());
        state.mkdirs();
        DocumentFile folder = tree(context).createDirectory(UUID.randomUUID().toString());
        assertNotNull(folder);
        String folderUri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", DocumentsContract.getDocumentId(folder.getUri())).toString();
        grant(context, Uri.parse(folderUri));
        String fixtureCookie = null;
        boolean fixtureCreated = false;
        try (FixtureServer server = new FixtureServer(InstrumentationRegistry.getInstrumentation().getContext())) {
            server.requireCookie = true;
            org.junit.Assume.assumeTrue("A session was saved before the fixture started", cookies.createNewFile());
            fixtureCreated = true;
            fixtureCookie = server.host() + "\tFALSE\t/\tFALSE\t0\ttest_session\tfixture";
            YtDlpFiles.write(cookies, ("# Netscape HTTP Cookie File\n" + fixtureCookie + "\n").getBytes(StandardCharsets.UTF_8));
            JSONObject config = new JSONObject().put("enabled", true).put("folder", folderUri)
                .put("cookies", cookies.getAbsolutePath()).put("useCookies", false);
            JSONObject payload = new JSONObject().put("mode", "video").put("videoId", "___________");
            JSONArray args = new JSONArray(asList("--output", "%(id)s.%(ext)s", "--retries", "0", server.url()));
            YtDlpDownloads queue = new YtDlpDownloads(context, state, () -> {});
            long anonymous = queue.add(payload, args, config, -1).getLong("id");
            long authenticated = queue.add(payload, args, config.put("useCookies", true), -1).getLong("id");
            YtDlpDownloads restored = new YtDlpDownloads(context, state, () -> {});
            restored.claim();
            restored.run(anonymous);
            assertEquals("Later cookie opt-in must not change a pending anonymous download", "failed", restored.list().getJSONObject(0).getString("status"));
            restored.configure(config.put("useCookies", false).put("cookies", ""));
            restored.run(authenticated);
            JSONObject result = restored.list().getJSONObject(1);
            assertEquals(result.toString(), "completed", result.getString("status"));
            config.put("useCookies", true).put("cookies", new File(state, "unapproved-cookies.txt").getAbsolutePath());
            long invalidCookies = restored.add(payload, args, config, -1).getLong("id");
            restored.claim();
            restored.run(invalidCookies);
            JSONObject invalid = restored.list().getJSONObject(2);
            assertEquals("failed", invalid.getString("status"));
            assertTrue(invalid.getString("errorMessage").contains("Cookie file is unavailable"));
            config.put("cookies", cookies.getAbsolutePath());
            long missingCookies = restored.add(payload, args, config, -1).getLong("id");
            assertTrue(cookies.delete());
            restored.claim();
            restored.run(missingCookies);
            JSONObject missing = restored.list().getJSONObject(3);
            assertEquals("failed", missing.getString("status"));
            assertTrue(missing.getString("errorMessage").contains("Cookie file is unavailable"));
            JSONObject automaticRule = new JSONObject().put("rule", new JSONObject().put("includeVideos", true).put("enabledAt", 1))
                .put("payload", new JSONObject(payload.toString()).put("automatic", true)).put("args", args);
            restored.configure(config.put("rules", new JSONObject().put("channel", automaticRule)));
            restored.discover("channel", "videos", new JSONObject().put("videos", new JSONArray().put(new JSONObject()
                .put("videoId", "__________2").put("published", System.currentTimeMillis() / 1000))));
            JSONObject discovered = restored.list().getJSONObject(4);
            assertEquals("queued", discovered.getString("status"));
            restored.claim();
            restored.run(discovered.getLong("id"));
            JSONObject failedAutomatic = restored.list().getJSONObject(4);
            assertEquals("failed", failedAutomatic.getString("status"));
            assertTrue(failedAutomatic.getString("errorMessage").contains("Cookie file is unavailable"));
        } finally {
            // yt-dlp may rewrite its header. Never remove a newer session saved while testing.
            if (fixtureCreated) removeFixtureCookies(cookies, fixtureCookie);
            folder.delete();
            YtDlpFiles.deleteTree(state);
        }
    }

    @Test public void emptyHistoryStartsAnEmptyQueueButCorruptHistoryIsPreserved() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File state = new File(context.getCacheDir(), "yt-dlp-empty-history-" + UUID.randomUUID());
        state.mkdirs();
        File history = new File(state, "yt-dlp-downloads.json");
        try {
            assertTrue(history.createNewFile());
            assertEquals(0, new YtDlpDownloads(context, state, () -> {}).list().length());
            YtDlpFiles.write(history, "{".getBytes(StandardCharsets.UTF_8));
            assertThrows(IllegalStateException.class, () -> new YtDlpDownloads(context, state, () -> {}));
            assertArrayEquals("{".getBytes(StandardCharsets.UTF_8), YtDlpFiles.readFile(history));
        } finally {
            YtDlpFiles.deleteTree(state);
        }
    }

    @Test public void cookieFixtureCleanupRemovesEmptyReservationButPreservesNewSession() throws Exception {
        File cookies = File.createTempFile("cookie-cleanup-", ".txt", InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir());
        try {
            removeFixtureCookies(cookies, "fixture");
            assertFalse("A failed fixture write must not leave its empty reservation", cookies.exists());
            byte[] session = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tnew-session\n".getBytes(StandardCharsets.UTF_8);
            YtDlpFiles.write(cookies, session);
            removeFixtureCookies(cookies, "fixture");
            assertArrayEquals(session, YtDlpFiles.readFile(cookies));
        } finally { cookies.delete(); }
    }

    private static void removeFixtureCookies(File cookies, String fixtureCookie) throws IOException {
        if (!cookies.isFile()) return;
        String current = new String(YtDlpFiles.readFile(cookies), StandardCharsets.UTF_8);
        if (current.isEmpty() || current.contains(fixtureCookie) && java.util.Arrays.stream(current.split("\n"))
            .filter(line -> !line.isBlank() && (!line.startsWith("#") || line.startsWith("#HttpOnly_")))
            .allMatch(fixtureCookie::equals)) cookies.delete();
    }

    private static DocumentFile tree(Context context) throws Exception {
        Uri uri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", "root");
        grant(context, uri);
        return DocumentFile.fromTreeUri(context, uri);
    }

    static void grant(Context context, Uri uri) throws Exception {
        context.sendBroadcast(new android.content.Intent().setComponent(new android.content.ComponentName(InstrumentationRegistry.getInstrumentation().getContext().getPackageName(), YtDlpTestDocumentsProvider.GrantReceiver.class.getName()))
            .addFlags(android.content.Intent.FLAG_INCLUDE_STOPPED_PACKAGES | android.content.Intent.FLAG_RECEIVER_FOREGROUND).putExtra("uri", uri.toString()).putExtra("targetPackage", context.getPackageName()));
        long deadline = System.currentTimeMillis() + 5000;
        while (context.checkCallingOrSelfUriPermission(uri, android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != android.content.pm.PackageManager.PERMISSION_GRANTED && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertEquals("Test folder grant", android.content.pm.PackageManager.PERMISSION_GRANTED,
            context.checkCallingOrSelfUriPermission(uri, android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
    }

    private static final class FixtureServer implements AutoCloseable {
        // yt-dlp runs through the proxy relay, which refuses loopback destinations.
        final ServerSocket server = new ServerSocket(0, 10, interfaceAddress());
        final AtomicInteger rangeRequests = new AtomicInteger();
        volatile boolean requireCookie;
        volatile boolean missingAvailable;
        final byte[] media;
        final Thread thread;
        FixtureServer(Context context) throws Exception {
            try (InputStream input = context.getAssets().open("demo.webm")) { media = YtDlpFiles.read(input, 1024 * 1024); }
            thread = new Thread(() -> {
                while (!server.isClosed()) {
                    try (Socket client = server.accept()) {
                        client.setSoTimeout(5000);
                        BufferedReader reader = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.US_ASCII));
                        String request = reader.readLine(), header;
                        int offset = 0;
                        boolean cookie = false;
                        while ((header = reader.readLine()) != null && !header.isEmpty()) {
                            if (header.toLowerCase().startsWith("cookie:") && header.contains("test_session=fixture")) cookie = true;
                            if (header.toLowerCase().startsWith("range: bytes=")) {
                                offset = Integer.parseInt(header.substring(13).split("-")[0]);
                                rangeRequests.incrementAndGet();
                            }
                        }
                        if (requireCookie && !cookie) {
                            client.getOutputStream().write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                            continue;
                        }
                        if (request != null && request.contains("/missing.webm") && !missingAvailable) {
                            client.getOutputStream().write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                            continue;
                        }
                        String headers = "HTTP/1.1 " + (offset > 0 ? "206 Partial Content" : "200 OK") + "\r\nContent-Type: video/webm\r\nContent-Length: " + (media.length - offset) + "\r\nAccept-Ranges: bytes\r\nConnection: close\r\n";
                        if (offset > 0) headers += "Content-Range: bytes " + offset + "-" + (media.length - 1) + "/" + media.length + "\r\n";
                        java.util.regex.Matcher setCookie = java.util.regex.Pattern.compile("[?&]cookie=(\\w+)").matcher(request == null ? "" : request);
                        if (setCookie.find()) headers += "Set-Cookie: " + setCookie.group(1) + "=rotated; Path=/; Max-Age=86400\r\n";
                        client.getOutputStream().write((headers + "\r\n").getBytes(StandardCharsets.US_ASCII));
                        if (request != null && !request.startsWith("HEAD ")) client.getOutputStream().write(media, offset, media.length - offset);
                    } catch (IOException ignored) { }
                }
            });
            thread.start();
        }
        String host() { return server.getInetAddress().getHostAddress(); }
        String url() { return "http://" + host() + ":" + server.getLocalPort() + "/demo.webm"; }
        private static InetAddress interfaceAddress() throws SocketException {
            for (NetworkInterface network : java.util.Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (InetAddress address : java.util.Collections.list(network.getInetAddresses())) {
                    if (address instanceof Inet4Address) return address;
                }
            }
            throw new SocketException("No non-loopback IPv4 address for the fixture server");
        }
        @Override public void close() throws Exception { server.close(); thread.join(5000); }
    }
}
