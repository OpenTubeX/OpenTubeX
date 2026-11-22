import { registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { watchEffect } from 'vue'
import { createAndroidBackGestureHandler } from './androidBackGesture'

const AndroidBack = process.env.IS_CAPACITOR && !process.env.IS_IOS ? registerPlugin('AndroidBack') : null

export async function initializeAndroidBack({ getPreview, back, shouldIntercept }) {
  if (!AndroidBack) return () => {}
  const handler = createAndroidBackGestureHandler({ getPreview, back })
  let lastEnabled = null
  const update = () => {
    const enabled = shouldIntercept()
    if (enabled === lastEnabled) return
    lastEnabled = enabled
    AndroidBack.setEnabled({ enabled }).catch(error => {
      lastEnabled = null
      console.error('Unable to update Android back handler', error)
    })
  }
  // Replace App's always-enabled callback so Android can preview Home at root.
  let listener
  try {
    ;[listener] = await Promise.all([
      AndroidBack.addListener('backGesture', event => {
        handler.handle(event).catch(error => console.error('Android back navigation failed', error))
      }),
      AndroidBack.setEnabled({ enabled: shouldIntercept() }),
      App.toggleBackButtonHandler({ enabled: false }),
    ])
  } catch (error) {
    listener?.remove()
    await AndroidBack.setEnabled({ enabled: false }).catch(() => {})
    throw error
  }
  const stop = watchEffect(update)
  const observer = new MutationObserver(update)
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['open', 'class', 'aria-expanded']
  })
  document.addEventListener('fullscreenchange', update)
  return () => {
    stop()
    observer.disconnect()
    document.removeEventListener('fullscreenchange', update)
    handler.dispose()
    listener.remove()
    AndroidBack.setEnabled({ enabled: false }).catch(console.error)
  }
}
