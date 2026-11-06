const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:gif|jpeg|png|webp);base64,(?=[A-Za-z0-9+/])(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/i

export function getCustomIconImageSource(icon) {
  if (icon?.type !== 'image' || typeof icon.value !== 'string') return ''

  return IMAGE_DATA_URL_PATTERN.test(icon.value) ? icon.value : ''
}
