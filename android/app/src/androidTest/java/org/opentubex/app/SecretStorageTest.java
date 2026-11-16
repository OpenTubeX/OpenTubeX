package org.opentubex.app;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONArray;
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

    @Test
    public void savesTheBackgroundRefreshAuthorizationEncryptedAndMigratesOrDropsSavedOnes() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        SharedPreferences preferences = context.getSharedPreferences("subscription-refresh", Context.MODE_PRIVATE);
        String original = SubscriptionRefreshConfiguration.read(context);
        String authorization = "Basic YWxpY2U6c2VjcmV0";
        JSONObject configuration = new JSONObject()
            .put("instanceUrl", "https://invidious.example").put("authorization", authorization)
            .put("intervals", new JSONObject().put("videos", 1800000))
            .put("requests", new JSONObject().put("videos", new JSONArray().put(new JSONObject()
                .put("format", "rss").put("url", "https://invidious.example/feed/playlist/%PLAYLIST%").put("authorization", authorization))))
            .put("profiles", new JSONArray().put(new JSONObject().put("id", "allChannels")
                .put("channels", new JSONObject().put("videos", new JSONArray().put("UCa")))));
        try {
            SubscriptionRefreshConfiguration.save(context, configuration);
            assertFalse(preferences.contains("configuration"));
            assertFalse(preferences.getString("encryptedConfiguration", "").contains("YWxpY2U6c2VjcmV0"));
            SubscriptionRefreshConfiguration.Feed feed = SubscriptionRefreshConfiguration.findFeeds(context, "videos").get(0);
            assertEquals(authorization, feed.authorization);
            assertEquals(authorization, feed.requests.getJSONObject(0).getString("authorization"));

            preferences.edit().remove("encryptedConfiguration").putString("configuration", configuration.toString()).commit();
            assertEquals("An unencrypted configuration is read", configuration.toString(), SubscriptionRefreshConfiguration.read(context));
            assertFalse("and saved again encrypted", preferences.contains("configuration"));
            assertEquals(configuration.toString(), SubscriptionRefreshConfiguration.read(context));

            preferences.edit().putString("encryptedConfiguration", Base64.encodeToString(new byte[40], Base64.NO_WRAP)).commit();
            assertTrue("An undecryptable configuration is deleted", SubscriptionRefreshConfiguration.findFeeds(context, "videos").isEmpty());
            assertFalse(preferences.contains("encryptedConfiguration"));
        } finally {
            if (original == null) preferences.edit().remove("configuration").remove("encryptedConfiguration").commit();
            else SubscriptionRefreshConfiguration.save(context, new JSONObject(original));
        }
    }
}
