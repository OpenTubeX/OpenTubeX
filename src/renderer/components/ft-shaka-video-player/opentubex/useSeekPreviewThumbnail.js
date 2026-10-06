import { onUnmounted, ref, watch } from 'vue'

export function useSeekPreviewThumbnail({ preview, getPlayer, getVideoId, loadImageDimensions }) {
  const thumbnailStyle = ref(null)
  const images = new Map()
  let generation = 0

  watch(() => [preview.value?.time, getVideoId()], async ([time]) => {
    const request = ++generation
    thumbnailStyle.value = null
    if (time === undefined) {
      images.clear()
      return
    }
    const player = getPlayer()
    if (!player || player.getImageTracks().length === 0) return
    try {
      const thumbnail = await player.getThumbnails(null, time)
      const uri = thumbnail?.uris[0]
      if (!uri || thumbnail.codecs === 'mjpg' || uri.startsWith('offline:') || request !== generation) return
      const url = uri.split('#xywh=')[0]
      if (!images.has(url)) images.set(url, loadImageDimensions(url))
      const dimensions = await images.get(url)
      if (!dimensions || request !== generation || player !== getPlayer()) return
      const width = thumbnail.width || dimensions.width
      const height = thumbnail.height || dimensions.height
      const imageWidth = dimensions.width
      const imageHeight = dimensions.height
      thumbnailStyle.value = {
        '--seek-thumbnail-aspect-ratio': width / height,
        aspectRatio: `${width} / ${height}`,
        backgroundImage: `url(${JSON.stringify(url)})`,
        backgroundSize: `${imageWidth / width * 100}% ${imageHeight / height * 100}%`,
        backgroundPosition: `${imageWidth > width ? (thumbnail.positionX || 0) / (imageWidth - width) * 100 : 0}% ${imageHeight > height ? (thumbnail.positionY || 0) / (imageHeight - height) * 100 : 0}%`,
      }
    } catch {
      // Time feedback still works when a storyboard is unavailable or broken.
    }
  })

  onUnmounted(() => {
    generation++
    images.clear()
  })
  return thumbnailStyle
}
