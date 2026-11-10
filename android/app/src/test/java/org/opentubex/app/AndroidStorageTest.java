package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class AndroidStorageTest {
    @Rule
    public TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test
    public void separatesCacheFromOtherAppData() throws IOException {
        File dataDirectory = temporaryFolder.newFolder("data");
        File cacheDirectory = new File(dataDirectory, "cache");
        File codeCacheDirectory = new File(dataDirectory, "code_cache");
        assertTrue(cacheDirectory.mkdir());
        assertTrue(codeCacheDirectory.mkdir());

        writeBytes(new File(dataDirectory, "database"), 3);
        writeBytes(new File(cacheDirectory, "response"), 5);
        writeBytes(new File(codeCacheDirectory, "script"), 7);

        AndroidStorage.Usage usage = AndroidStorage.measure(
            dataDirectory,
            cacheDirectory,
            codeCacheDirectory
        );

        assertEquals(3, usage.appDataBytes);
        assertEquals(12, usage.cacheBytes);
        assertEquals(15, usage.totalBytes());
    }

    @Test
    public void clearsNestedCacheContentsWithoutRemovingTheCacheDirectory() throws IOException {
        File cacheDirectory = temporaryFolder.newFolder("cache");
        File nestedDirectory = new File(cacheDirectory, "nested");
        assertTrue(nestedDirectory.mkdir());
        writeBytes(new File(nestedDirectory, "response"), 4);

        assertTrue(AndroidStorage.clearDirectory(cacheDirectory));
        assertTrue(cacheDirectory.exists());
        assertEquals(0, AndroidStorage.size(cacheDirectory));
        assertFalse(nestedDirectory.exists());
    }

    private static void writeBytes(File file, int count) throws IOException {
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(new byte[count]);
        }
    }
}
