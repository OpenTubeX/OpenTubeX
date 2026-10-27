import { createHash, createPublicKey, verify } from 'node:crypto'

/**
 * yt-dlp's release signing key, which signs the checksum files of the stable,
 * nightly and master channels.
 * OpenPGP fingerprint AC0C BBE6 848D 6A87 3464 AF4E 57CF 6593 3B5A 7581,
 * converted from https://github.com/yt-dlp/yt-dlp/blob/master/public.key
 */
const YT_DLP_SIGNING_KEY = createPublicKey(`-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA9Kxfc4xjwLdLYZbeQtXm
83HAFV+zW9b/nqkI5PlhGXUxE1QoN1gDOZ4AK5R3Zv32as1IDvqQGKwetBinoO33
1A3/ktFxShGXXkS2HgGqqioUom1WpQ47zgTs7bt1utOxyxE0AKgO8Ez7iLdlqpqS
+tDSHMq9uy8apoHTd5jb2doizvmz9Jykfwvj4BPR+MrcsA2tdszMej5mQp1Tjjru
l2RBZnVMcXUPXxQ6nfS3ASmNiwznEmKNbGmNGFomVh7c1aGbtZDs450uRY6v8gRy
SyJgx+6TcR5u7Pz52rq6ZkBbQxa7pLftpYQ56SlJhq/yP9yB6h/1/vZz6EuLoqkO
R6W5QfASvuFn6WohIO+S577jj32SDymMl2v9AO0KIzMIDqw/PKM0/lQpCpJCfoo1
2e4BzY5nAWlHSiu3wyBDmCOty8nOkFpBkE4oBX30lF1hwwjvWlzYT93o6hVoBjLQ
lLK25HCZFrlmO6uQEcv9OR20jNyuA1PXqrZ8ZoldVkPJ17iPSYCUEb4eT05J8uS7
cas3Jqr1jvU4xwW67NeATxDvX3F8Si/whQW81w0r7wIAK3aqpTKJ3EP8onE5Xy+q
syfBChYqlteEDE3QJ+krrmU6HVwk4iJ8KE+1o47hTyinb3x9Rj+G56nc058y8Qkg
yBLX8nz7CF/vRiOyZJP82Y0CAwEAAQ==
-----END PUBLIC KEY-----`)

const OPENPGP_HASH_ALGORITHMS = { 8: 'sha256', 10: 'sha512' }

/**
 * Reads the signature creation time, which RFC 4880 requires in the hashed subpackets.
 * @param {Buffer} subpackets
 * @returns {number | null} seconds since the Unix epoch
 */
function getSignatureCreationTime(subpackets) {
  let offset = 0
  while (offset < subpackets.length) {
    let length = subpackets[offset++]
    if (length === 255) {
      length = subpackets.readUInt32BE(offset)
      offset += 4
    } else if (length >= 192) {
      length = ((length - 192) << 8) + subpackets[offset++] + 192
    }
    if ((subpackets[offset] & 0x7f) === 2 && length === 5) {
      return subpackets.readUInt32BE(offset + 1)
    }
    offset += length
  }
  return null
}

/**
 * Verifies a detached binary OpenPGP v4 RSA signature (RFC 4880 section 5.2.4).
 * Anything else is rejected rather than parsed.
 * @param {Buffer} data
 * @param {Buffer} signature
 * @param {import('node:crypto').KeyObject} key
 * @returns {number | null} the signed creation time of a valid signature
 */
function verifyOpenPgpSignature(data, signature, key) {
  try {
    const header = signature[0]
    let offset = 1
    let length

    if ((header & 0x80) === 0) {
      return null
    }

    if (header & 0x40) {
      if ((header & 0x3f) !== 2) {
        return null
      }
      const first = signature[offset++]
      if (first < 192) {
        length = first
      } else if (first < 224) {
        length = ((first - 192) << 8) + signature[offset++] + 192
      } else if (first === 255) {
        length = signature.readUInt32BE(offset)
        offset += 4
      } else {
        return null
      }
    } else {
      if (((header >> 2) & 0x0f) !== 2) {
        return null
      }
      const lengthBytes = [1, 2, 4][header & 0x03]
      if (lengthBytes === undefined) {
        return null
      }
      length = signature.readUIntBE(offset, lengthBytes)
      offset += lengthBytes
    }

    const body = signature.subarray(offset)
    const hashAlgorithm = OPENPGP_HASH_ALGORITHMS[body[3]]

    // a single version 4, binary document signature made with RSA
    if (body.length !== length || body[0] !== 4 || body[1] !== 0x00 || body[2] !== 1 || hashAlgorithm === undefined) {
      return null
    }

    const hashedLength = 6 + body.readUInt16BE(4)
    const unhashedLength = body.readUInt16BE(hashedLength)
    // skip the unhashed subpackets and the left 16 bits of the hash
    const mpiOffset = hashedLength + 2 + unhashedLength + 2
    const mpiBytes = Math.ceil(body.readUInt16BE(mpiOffset) / 8)
    const modulusBytes = key.asymmetricKeyDetails.modulusLength / 8
    const value = body.subarray(mpiOffset + 2, mpiOffset + 2 + mpiBytes)

    if (value.length !== mpiBytes || mpiOffset + 2 + mpiBytes !== body.length || mpiBytes > modulusBytes) {
      return null
    }

    const trailer = Buffer.alloc(6)
    trailer.writeUInt16BE(0x04ff, 0)
    trailer.writeUInt32BE(hashedLength, 2)

    const signedAt = getSignatureCreationTime(body.subarray(6, hashedLength))
    const valid = verify(
      hashAlgorithm,
      Buffer.concat([data, body.subarray(0, hashedLength), trailer]),
      key,
      // OpenPGP strips leading zero bytes from the MPI
      Buffer.concat([Buffer.alloc(modulusBytes - mpiBytes), value])
    )
    return valid ? signedAt : null
  } catch {
    return null
  }
}

/**
 * @param {string} message
 * @returns {Error} an error the renderer translates by its code
 */
function verificationError(message) {
  return Object.assign(new Error(message), { code: 'MANAGED_TOOL_VERIFICATION_FAILED' })
}

/**
 * Checks a downloaded yt-dlp release asset against the release's SHA2-256SUMS
 * file and its signature, so a compromised connection cannot substitute the
 * executable or roll it back to an older signed release.
 * @param {Buffer} data
 * @param {string} assetName
 * @param {Buffer} checksums
 * @param {Buffer} signature
 * @param {number} [minimumSignedAt] signing time of the installed release, in seconds
 * @returns {number} signing time of the downloaded release, in seconds
 */
export function verifyYtDlpReleaseAsset(data, assetName, checksums, signature, minimumSignedAt = 0) {
  const signedAt = verifyOpenPgpSignature(checksums, signature, YT_DLP_SIGNING_KEY)
  if (signedAt === null) {
    throw verificationError('The yt-dlp checksum file is not signed by the yt-dlp release key')
  }
  if (signedAt < minimumSignedAt) {
    throw Object.assign(new Error('The downloaded yt-dlp release is older than the installed one'), { code: 'MANAGED_TOOL_DOWNGRADE' })
  }

  const expected = checksums.toString('utf8').split('\n')
    .map(line => /^([\da-f]{64}) [ *](.+?)\r?$/i.exec(line))
    .find(match => match?.[2] === assetName)?.[1]
    .toLowerCase()

  if (expected === undefined) {
    throw verificationError(`The signed yt-dlp checksum file has no entry for ${assetName}`)
  }

  if (createHash('sha256').update(data).digest('hex') !== expected) {
    throw verificationError('The downloaded yt-dlp binary does not match its signed checksum')
  }

  return signedAt
}
