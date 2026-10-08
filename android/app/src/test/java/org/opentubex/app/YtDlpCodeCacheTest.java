package org.opentubex.app;

import static org.junit.Assert.*;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class YtDlpCodeCacheTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    private File archive(String name, String contents) throws Exception {
        File archive = new File(temporary.getRoot(), "yt-dlp");
        try (OutputStream file = new FileOutputStream(archive)) {
            file.write("#!/usr/bin/env python3\n".getBytes(StandardCharsets.UTF_8));
            try (ZipOutputStream zip = new ZipOutputStream(file)) {
                zip.putNextEntry(new ZipEntry(name));
                zip.write(contents.getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
        }
        return archive;
    }

    @Test public void reusesAnUnpackedExecutableZipAndPreservesBytecode() throws Exception {
        File archive = archive("__main__.py", "print('version')");
        File directory = new File(temporary.getRoot(), "code");
        assertEquals(directory, YtDlpCodeCache.prepare(archive, directory));
        assertEquals("print('version')", new String(Files.readAllBytes(new File(directory, "__main__.py").toPath()), StandardCharsets.UTF_8));
        File bytecode = new File(directory, "cached.pyc");
        Files.write(bytecode.toPath(), new byte[] {1, 2, 3});
        assertEquals(directory, YtDlpCodeCache.prepare(archive, directory));
        assertTrue(bytecode.exists());
    }

    @Test public void archiveUpdatesReplaceCodeAndDiscardStaleBytecode() throws Exception {
        File archive = archive("__main__.py", "old");
        File directory = new File(temporary.getRoot(), "code");
        YtDlpCodeCache.prepare(archive, directory);
        File bytecode = new File(directory, "cached.pyc");
        Files.write(bytecode.toPath(), new byte[] {1});
        long previousModified = archive.lastModified();
        archive = archive("__main__.py", "new");
        assertTrue(archive.setLastModified(previousModified + 2000));
        assertEquals(directory, YtDlpCodeCache.prepare(archive, directory));
        assertEquals("new", new String(Files.readAllBytes(new File(directory, "__main__.py").toPath()), StandardCharsets.UTF_8));
        assertFalse(bytecode.exists());
    }

    @Test public void repairsAnIncompleteInstallationAndInterruptedStaging() throws Exception {
        File archive = archive("__main__.py", "complete");
        File directory = new File(temporary.getRoot(), "code");
        YtDlpCodeCache.prepare(archive, directory);
        Files.delete(new File(directory, "__main__.py").toPath());
        File staging = new File(directory.getPath() + ".tmp");
        assertTrue(staging.mkdir());
        Files.write(new File(staging, "partial.py").toPath(), new byte[] {1});
        assertEquals(directory, YtDlpCodeCache.prepare(archive, directory));
        assertTrue(new File(directory, "__main__.py").isFile());
        assertFalse(new File(directory, "partial.py").exists());
        assertFalse(staging.exists());
    }

    @Test public void invalidArchivePathsFallBackWithoutWritingOutsideTheDirectory() throws Exception {
        File archive = archive("../escaped.py", "bad");
        File directory = new File(temporary.getRoot(), "code");
        assertEquals(archive, YtDlpCodeCache.prepare(archive, directory));
        assertFalse(new File(temporary.getRoot(), "escaped.py").exists());
        assertFalse(directory.exists());
        assertFalse(new File(directory.getPath() + ".tmp").exists());
    }

    @Test public void unavailableStorageFallsBackToTheOriginalArchive() throws Exception {
        File archive = archive("__main__.py", "version");
        File blocked = temporary.newFile("blocked");
        assertEquals(archive, YtDlpCodeCache.prepare(archive, new File(blocked, "code")));
    }

    @Test public void archivesWithoutAnEntryPointAreNotInstalled() throws Exception {
        File archive = archive("yt_dlp/__init__.py", "version");
        File directory = new File(temporary.getRoot(), "code");
        assertEquals(archive, YtDlpCodeCache.prepare(archive, directory));
        assertFalse(directory.exists());
    }
}
