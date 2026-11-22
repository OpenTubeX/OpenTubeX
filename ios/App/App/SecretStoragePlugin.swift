import Capacitor
import CryptoKit
import Foundation
import Security

/// Encrypts passwords and tokens with an AES key in the Keychain. The key is
/// available only on this device, so app data restored on another one cannot
/// be decrypted there.
enum SecretStorage {
    struct KeychainError: Error, CustomStringConvertible {
        let status: OSStatus
        var description: String { "Keychain error \(status)" }
    }

    private static let service = "org.opentubex.settings-secrets"
    private static let lock = NSLock()

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "key"]
    }

    private static func key() throws -> SymmetricKey {
        lock.lock()
        defer { lock.unlock() }
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, data.count == 32 { return SymmetricKey(data: data) }
        // Such as before the first unlock after a restart. Never replace the key then.
        guard status == errSecItemNotFound || status == errSecSuccess else { throw KeychainError(status: status) }
        if status == errSecSuccess { SecItemDelete(query as CFDictionary) }
        let key = SymmetricKey(size: .bits256)
        var entry = query
        entry[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        entry[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(entry as CFDictionary, nil)
        guard added == errSecSuccess else { throw KeychainError(status: added) }
        return key
    }

    /// The nonce, ciphertext and tag, in Base64.
    static func encrypt(_ text: String) throws -> String {
        guard let combined = try AES.GCM.seal(Data(text.utf8), using: key()).combined else { throw CryptoKitError.incorrectParameterSize }
        return combined.base64EncodedString()
    }

    /// Returns nil when this device's key cannot decrypt the value, such as one
    /// restored from another device. Throws when the Keychain cannot be used.
    static func decrypt(_ value: String) throws -> String? {
        guard let data = Data(base64Encoded: value), let box = try? AES.GCM.SealedBox(combined: data) else { return nil }
        let key = try key()
        guard let plain = try? AES.GCM.open(box, using: key) else { return nil }
        return String(data: plain, encoding: .utf8)
    }
}

@objc(SecretStoragePlugin)
public class SecretStoragePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecretStoragePlugin"
    public let jsName = "SecretStorage"
    public let pluginMethods: [CAPPluginMethod] = ["encrypt", "decrypt"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }

    @objc func encrypt(_ call: CAPPluginCall) {
        guard let values = call.getArray("values") as? [String] else { call.reject("Invalid values"); return }
        do {
            call.resolve(["values": try values.map(SecretStorage.encrypt)])
        } catch {
            call.reject("Unable to encrypt", nil, error)
        }
    }

    /// Resolves null for each value this device cannot decrypt.
    @objc func decrypt(_ call: CAPPluginCall) {
        guard let values = call.getArray("values") as? [String] else { call.reject("Invalid values"); return }
        do {
            let results: [Any] = try values.map { value in
                if let text = try SecretStorage.decrypt(value) { return text }
                return NSNull()
            }
            call.resolve(["values": results])
        } catch {
            call.reject("Unable to decrypt", nil, error)
        }
    }
}
