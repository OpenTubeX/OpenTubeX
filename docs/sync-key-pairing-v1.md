# Sync key pairing protocol v1

This protocol authorizes a new OpenTubeX device for an existing sync account and transfers its enhanced-privacy key. The receiving device needs only the sync-server URL. It does not need the account name, account password, or privacy passphrase.

The sync server creates a fresh account token when an authenticated device approves the request. The approving device sends that token, the account name, and the privacy key to the receiver inside one HPKE ciphertext. The server relays the ciphertext but cannot open or replace it because it never receives the QR-only pairing secret.

The protocol uses HPKE from RFC 9180 in PSK mode:

- KEM: DHKEM(X25519, HKDF-SHA256), identifier `0x0020`
- KDF: HKDF-SHA256, identifier `0x0001`
- AEAD: AES-256-GCM, identifier `0x0002`
- `info`: UTF-8 `OpenTubeX key pairing v1`
- PSK: 32 random bytes included only in the QR or manually transferred text code
- PSK ID: the UTF-8 session ID

## Flow

1. The receiving device creates a random 32-byte session ID, random 16-byte device ID, ephemeral X25519 key pair, 32-byte QR secret, and an independent 32-byte recipient token.
2. It anonymously sends the session metadata and SHA-256 hash of the recipient token to `POST /v1/pairing`. The raw token, QR secret, and recipient private key remain only in runtime memory and pairing requests. They do not enter persistent app state.
3. It renders the QR payload below. The user can display the same payload as selectable text. The recipient token is not part of either form.
4. An already connected device scans or pastes the code. Before any server request, it checks the origin against its configured server and shows the server, current account name, and requested device name.
5. After explicit approval, that device encrypts the requested display name with the account privacy key and authenticates to `POST /v1/pairing/{id}/claim`. The server atomically binds the pending pairing session to its account, creates an account session for the receiving device, and returns its JWT.
6. The approving device generates a six-digit verification code and uses its persistent device ID. It HPKE-seals the account name, fresh JWT, AES-256 privacy key, 16-byte privacy salt, privacy format version, and verification code, then uploads the ciphertext through authenticated `PUT /v1/pairing/{id}`.
7. The receiver polls and atomically consumes the ciphertext with its raw recipient token in the `X-Pairing-Token` header. It decrypts the transfer and verifies the privacy key by opening an existing encrypted sync collection with the transferred JWT.
8. Both devices display the six-digit verification code. The receiver saves the account token and privacy key only after the users confirm that the codes match.

Sessions expire after two minutes. Consumption deletes the session atomically. Cancellation also deletes it. A claimed session cannot be claimed by another account, and approval accepts only an identical retry after the first success.

## Serialization

All binary values use canonical unpadded base64url. JSON parsers reject missing and unknown fields. Writers use the field order shown here.

The QR and text code contain `opentubex-pairing:` followed by the unpadded base64url encoding of this UTF-8 JSON object:

```json
{
  "version": 1,
  "origin": "https://sync.example.com",
  "sessionId": "43 base64url characters",
  "recipientPublicKey": "43 base64url characters",
  "recipientDeviceId": "22 base64url characters",
  "recipientDeviceName": "1 to 80 Unicode scalar values",
  "pairingSecret": "43 base64url characters"
}
```

The anonymous create request also sends `recipient_token_hash`, the unpadded base64url SHA-256 digest of the raw 32-byte recipient token. The authenticated claim repeats the four public recipient fields and adds `encrypted_device_info`, an opaque AES-GCM envelope containing the device name and system details under the account privacy key. Poll, consume, and cancel requests send the raw recipient token only in the `X-Pairing-Token` header.

The HPKE additional authenticated data is the UTF-8 encoding of this compact JSON object:

```json
{"version":1,"origin":"https://sync.example.com","accountId":"0198e2d4-8ad2-7f73-8d6e-4f076707ce25","sessionId":"...","recipientPublicKey":"...","recipientDeviceId":"...","approvingDeviceId":"..."}
```

The sealed plaintext is compact JSON with exactly these fields:

```json
{"version":1,"username":"sync-user","token":"fresh JWT","privacyKey":"43 base64url characters","privacySalt":"22 base64url characters","privacyFormat":1,"verificationCode":"042731"}
```

The relay payload is one version byte set to `0x01`, the 32-byte HPKE encapsulated key, and the HPKE ciphertext, encoded together as unpadded base64url.

## Test vector

The vector uses deterministic key material only for interoperability tests. Implementations must use a cryptographically secure random source in production.

```text
recipient IKM: AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8
sender IKM: gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8
session ID: ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8
recipient public key: sfG4QN56MkGwJ0jPmwW3TcjF6EUSmHOIF712qo6-jCs
recipient device ID: MDEyMzQ1Njc4OTo7PD0-Pw
recipient device name: Vector laptop
approving device ID: QEFCQ0RFRkdISUpLTE1OTw
pairing secret: oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8
account ID: 0198e2d4-8ad2-7f73-8d6e-4f076707ce25
username: sync-user
token: header.payload.signature
privacy key: AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8
privacy salt: AAECAwQFBgcICQoLDA0ODw
privacy format: 1
verification code: 042731
relay payload: AXrwPfFZ4tdXUcGojrWp6HmI8Tjc51luvaOtfwuwSoc02gY_WD6GVfCyLGKwYSuknzs_H11knturZTqjsTJrRcQt8oshhSYeR5zmADfHjlxtUOUtbFjE4FXS_YonTthVfWHiloh8tvG4Azunpwg9xCbRkx_yUqT1hHt-x2LNH8YqrdE6i019RuzpbRiUhwqd6mURrvdyDl5nuDJz5GnrrYCE2J4yf74i0V-6Ji-_WLGK2NH_L8apZxPQoshh0sYNiddX75ZcxWVcbAYGLHYdxAZNKR4M9qciId_PomIm4Op2SCCw2NH98YqJ7jD6YDLzHXEpx3K2qFlwCL0IjqzbG5rQbXg6a62l
```

## Threat model

The sync server sees the account ID after claim, session ID, public key, token hash, device IDs, display name, expiry, ciphertext size, and request timing. It also stores the encrypted device name with the resulting account session. It receives the raw recipient token in poll, consume, and cancel request headers but stores only its hash. It also creates the fresh JWT carried in the ciphertext. It cannot decrypt or replace the transfer because the QR secret never reaches it. It can drop, delay, reorder, replay, or delete requests. Replacing any bound context or ciphertext fails HPKE authentication.

A person who copies the QR learns its metadata and HPKE secret. They do not learn the recipient token or private key, so they cannot poll, consume, or cancel the session. They can race the intended approving device and claim the session with another account. The verification code exposes that substitution before the receiver saves credentials or uploads local data. Users must compare the codes through a channel they trust, normally by viewing both devices together.

A compromised device that is already connected to the intended account can authorize another device and disclose the account token and privacy key. Clipboard managers may retain a manually copied text code, so users should clear it after pairing.

The protocol does not protect a device compromised before or during pairing, an approving device that already has the privacy key, a camera or screen-capture process that records the QR, or application code running with renderer privileges. TLS remains mandatory for remote servers. Local development may use loopback HTTP, but the production pairing UI accepts HTTPS origins only.

Before changing an algorithm, field, size limit, context binding, expiry, or capability version, obtain a focused security review and publish new test vectors under a new protocol version.
