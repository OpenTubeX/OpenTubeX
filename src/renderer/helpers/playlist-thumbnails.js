const MAX_THUMBNAIL_DATA_URL_LENGTH = 2_000_000

/**
 * Decode an image before storing it, limiting its dimensions and portable data size.
 * @param {Blob|string} source A selected image file or an imported raster data URL.
 * @returns {Promise<string>}
 */
export async function normalizePlaylistThumbnail(source) {
  const isFile = source instanceof Blob
  if (!isFile && (typeof source !== 'string' || source.length > MAX_THUMBNAIL_DATA_URL_LENGTH ||
    !/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(source))) {
    throw new Error('Invalid playlist thumbnail data')
  }

  const url = isFile ? URL.createObjectURL(source) : source
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Image has no dimensions')
    const scale = Math.min(1, 1280 / image.naturalWidth, 720 / image.naturalHeight)
    // Keep an already bounded import intact, avoiding another lossy encoding.
    if (!isFile && scale === 1) return source

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    const thumbnail = canvas.toDataURL('image/webp', 0.9)
    if (thumbnail.length > MAX_THUMBNAIL_DATA_URL_LENGTH) throw new Error('Playlist thumbnail is too large')
    return thumbnail
  } finally {
    if (isFile) URL.revokeObjectURL(url)
  }
}
