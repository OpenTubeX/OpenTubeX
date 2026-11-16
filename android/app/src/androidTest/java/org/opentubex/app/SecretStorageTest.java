package org.opentubex.app;

import static org.junit.Assert.*;

import android.content.Context;
import android.util.Base64;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONObject;
import org.junit.Test;

public class SecretStorageTest {
    @Test
    public void encryptsWithTheKeystoreKeyAndRejectsOtherValues() throws Exception {
        String encrypted = SecretStorage.encrypt("token ä中");
        assertFalse(encrypted.contains("token"));
        assertNotEquals("Each value gets its own IV", encrypted, SecretStorage.encrypt("token ä中"));
        assertEquals("token ä中", SecretStorage.decrypt(encrypted));

        byte[] tampered = Base64.decode(encrypted, Base64.NO_WRAP);
        tampered[tampered.length - 1] ^= 1;
        assertNull(SecretStorage.decrypt(Base64.encodeToString(tampered, Base64.NO_WRAP)));
        // Like a value restored from another device, encrypted with its key.
        assertNull(SecretStorage.decrypt(Base64.encodeToString(new byte[40], Base64.NO_WRAP)));
        assertNull(SecretStorage.decrypt("not base64!"));
    }

    @Test
    public void savesTheProxyPasswordEncryptedAndMigratesOrDropsSavedOnes() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File file = new File(context.getNoBackupFilesDir(), "proxy.json");
        JSONObject original = AndroidProxy.getConfiguration();
        try {
            AndroidProxy.configure(new JSONObject().put("enabled", false).put("protocol", "http")
                .put("hostname", "127.0.0.1").put("port", "8080").put("username", "alice").put("password", "proxy-secret"));
            String saved = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
            assertFalse(saved, saved.contains("proxy-secret"));
            assertEquals("proxy-secret", AndroidProxy.getConfiguration().getString("password"));

            JSONObject restored = new JSONObject(saved);
            assertFalse(AndroidProxy.decryptPassword(restored));
            assertEquals("proxy-secret", restored.getString("password"));

            JSONObject plaintext = new JSONObject().put("enabled", false).put("password", "proxy-secret");
            assertTrue("An unencrypted password is saved again", AndroidProxy.decryptPassword(plaintext));
            assertEquals("proxy-secret", plaintext.getString("password"));

            JSONObject foreign = new JSONObject().put("enabled", false)
                .put("encryptedPassword", Base64.encodeToString(new byte[40], Base64.NO_WRAP));
            assertTrue("An undecryptable password is deleted", AndroidProxy.decryptPassword(foreign));
            assertEquals("", foreign.getString("password"));
        } finally {
            AndroidProxy.configure(original);
        }
    }
}
