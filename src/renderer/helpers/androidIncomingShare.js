import { registerPlugin } from '@capacitor/core'

const AndroidShare = process.env.IS_CAPACITOR && !process.env.IS_IOS ? registerPlugin('AndroidShare') : null

export async function initializeAndroidIncomingShare(handleShare) {
  if (!AndroidShare) return () => {}
  const listener = await AndroidShare.addListener('sharedText', ({ text }) => {
    handleShare(text).catch(error => console.error('Unable to handle shared text', error))
  })
  return () => listener.remove()
}
