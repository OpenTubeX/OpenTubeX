package org.opentubex.app;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.Key;
import java.security.KeyStore;
import java.util.Arrays;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Encrypts passwords and tokens with an AES key in the Android Keystore. The
 * key never leaves this installation, so restored or transferred app data
 * cannot be decrypted elsewhere.
 */
final class SecretStorage {
    private static final String KEYSTORE = "AndroidKeyStore";
    // Tests use a key of their own, so the app's saved secrets stay readable
    static volatile String alias = "settings-secrets";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_LENGTH = 12;
    private static final int TAG_BITS = 128;

    private SecretStorage() {}

    private static synchronized SecretKey key() throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        Key existing = store.getKey(alias, null);
        if (existing instanceof SecretKey key) return key;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    /** The IV followed by the ciphertext and its tag, in Base64. */
    static String encrypt(String text) throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        // The Keystore picks a random IV for each value.
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        byte[] sealed = cipher.doFinal(text.getBytes(StandardCharsets.UTF_8));
        if (iv.length != IV_LENGTH) throw new GeneralSecurityException("Unexpected IV length " + iv.length);
        byte[] result = Arrays.copyOf(iv, iv.length + sealed.length);
        System.arraycopy(sealed, 0, result, iv.length, sealed.length);
        return Base64.encodeToString(result, Base64.NO_WRAP);
    }

    /**
     * @return null when this installation's key cannot decrypt the value, such
     *     as one restored from another device
     * @throws GeneralSecurityException when the Keystore cannot be used
     */
    static String decrypt(String value) throws GeneralSecurityException, IOException {
        byte[] data;
        try {
            data = Base64.decode(value, Base64.NO_WRAP);
        } catch (IllegalArgumentException error) {
            return null;
        }
        if (data.length <= IV_LENGTH) return null;
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, data, 0, IV_LENGTH));
        try {
            return new String(cipher.doFinal(data, IV_LENGTH, data.length - IV_LENGTH), StandardCharsets.UTF_8);
        } catch (AEADBadTagException error) {
            return null;
        }
    }
}
