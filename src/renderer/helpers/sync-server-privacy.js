const PRIVACY_VERSION = 1
const PBKDF2_ITERATIONS = 600_000
const PADDING_BLOCK_BYTES = 64 * 1024
const ADDITIONAL_DATA = new TextEncoder().encode('OpenTubeX encrypted sync v1')

function bytesToBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

async function importPrivacyKey(value) {
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(value),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
}

async function derivePrivacyKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
}

function parseEnvelope(payload) {
  try {
    const envelope = JSON.parse(payload)
    if (envelope.version !== PRIVACY_VERSION ||
        envelope.kdf?.name !== 'PBKDF2' ||
        envelope.kdf?.hash !== 'SHA-256' ||
        envelope.kdf?.iterations !== PBKDF2_ITERATIONS ||
        envelope.cipher?.name !== 'AES-GCM') {
      throw new Error()
    }
    return envelope
  } catch {
    throw new Error('Unsupported or invalid encrypted sync data')
  }
}

async function decryptWithKey(payload, key) {
  const envelope = parseEnvelope(payload)
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(envelope.cipher.iv),
        additionalData: ADDITIONAL_DATA,
      },
      key,
      base64ToBytes(envelope.ciphertext)
    )
    const document = JSON.parse(new TextDecoder().decode(plaintext))
    if (document.version !== PRIVACY_VERSION) throw new Error()
    return document
  } catch {
    throw new Error('Incorrect privacy passphrase or corrupted sync data')
  }
}

export async function preparePrivacyKey(payload, passphrase) {
  const salt = payload
    ? base64ToBytes(parseEnvelope(payload).kdf.salt)
    : crypto.getRandomValues(new Uint8Array(16))
  const key = await derivePrivacyKey(passphrase, salt)
  if (payload) await decryptWithKey(payload, key)
  const rawKey = await crypto.subtle.exportKey('raw', key)
  return {
    key: bytesToBase64(new Uint8Array(rawKey)),
    salt: bytesToBase64(salt),
  }
}

export async function decryptSyncDocument(payload, exportedKey) {
  if (!payload) return createEmptySyncDocument()
  return decryptWithKey(payload, await importPrivacyKey(exportedKey))
}

export async function encryptSyncDocument(document, exportedKey, salt) {
  const key = await importPrivacyKey(exportedKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify(document))
  const paddedLength = Math.ceil(encoded.length / PADDING_BLOCK_BYTES) * PADDING_BLOCK_BYTES
  const plaintext = new Uint8Array(Math.max(PADDING_BLOCK_BYTES, paddedLength))
  plaintext.fill(0x20)
  plaintext.set(encoded)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: ADDITIONAL_DATA },
    key,
    plaintext
  )
  return JSON.stringify({
    version: PRIVACY_VERSION,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt,
    },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  })
}

export function getPrivacySalt(payload) {
  return parseEnvelope(payload).kdf.salt
}

export function createEmptySyncDocument() {
  return {
    version: PRIVACY_VERSION,
    subscriptions: [],
    playlists: [],
    history: [],
    playbackSpeeds: [],
    subscriptionGroups: [],
    playlistBookmarks: [],
  }
}

export async function loadLegacySyncDocument(client) {
  const [subscriptions, playlistHeaders, history, playbackSpeeds, subscriptionGroups, playlistBookmarks] =
    await Promise.all([
      client.getSubscriptions(),
      client.getPlaylists(),
      client.getWatchHistory(),
      client.getChannelPlaybackSpeeds(),
      client.getSubscriptionGroups(),
      client.getPlaylistBookmarks(),
    ])
  const playlists = await Promise.all(
    playlistHeaders.map(playlist => client.getPlaylist(playlist.id))
  )

  return {
    version: PRIVACY_VERSION,
    subscriptions,
    playlists,
    history: history ?? [],
    playbackSpeeds: playbackSpeeds ?? [],
    subscriptionGroups,
    playlistBookmarks,
  }
}

export class EncryptedSyncAdapter {
  constructor(document) {
    this.document = document
    this.document.subscriptions ??= []
    this.document.playlists ??= []
    this.document.history ??= []
    this.document.playbackSpeeds ??= []
  }

  async getSubscriptions() { return structuredClone(this.document.subscriptions) }
  async subscribe(channel) { this.document.subscriptions.push(structuredClone(channel)) }
  async subscribeBulk(channels) { this.document.subscriptions.push(...structuredClone(channels)) }
  async unsubscribe(id) {
    this.document.subscriptions = this.document.subscriptions.filter(channel => channel.id !== id)
  }

  async getPlaylists() {
    return structuredClone(this.document.playlists.map(entry => entry.playlist))
  }

  async getPlaylist(id) {
    return structuredClone(this.document.playlists.find(entry => entry.playlist.id === id))
  }

  async createPlaylist(playlist) {
    this.document.playlists.push({ playlist: structuredClone(playlist), videos: [] })
    return structuredClone(playlist)
  }

  async updatePlaylist(id, playlist) {
    const entry = this.document.playlists.find(entry => entry.playlist.id === id)
    entry.playlist = { ...entry.playlist, ...structuredClone(playlist), id }
  }

  async deletePlaylist(id) {
    this.document.playlists = this.document.playlists.filter(entry => entry.playlist.id !== id)
  }

  async addPlaylistVideos(id, videos) {
    this.document.playlists.find(entry => entry.playlist.id === id).videos.push(...structuredClone(videos))
  }

  async removePlaylistVideo(playlistId, videoId) {
    const entry = this.document.playlists.find(entry => entry.playlist.id === playlistId)
    entry.videos = entry.videos.filter(video => video.id !== videoId)
  }

  async getWatchHistory() { return structuredClone(this.document.history) }

  async putWatchHistory(entry) {
    this.document.history = this.document.history.filter(item => item.video.id !== entry.video.id)
    this.document.history.push(structuredClone(entry))
  }

  async putWatchHistoryBulk(entries) {
    for (const entry of entries) await this.putWatchHistory(entry)
  }

  async deleteWatchHistory(id) {
    this.document.history = this.document.history.filter(entry => entry.video.id !== id)
  }

  async getChannelPlaybackSpeeds() { return structuredClone(this.document.playbackSpeeds) }

  async putChannelPlaybackSpeed(speed) {
    await this.deleteChannelPlaybackSpeed(speed.channel_id)
    this.document.playbackSpeeds.push(structuredClone(speed))
  }

  async deleteChannelPlaybackSpeed(id) {
    this.document.playbackSpeeds = this.document.playbackSpeeds
      .filter(entry => entry.channel_id !== id)
  }
}
