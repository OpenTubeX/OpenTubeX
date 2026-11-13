import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'

// Native strings outside the renderer (permission prompts, home screen widgets) reuse the
// human translations, falling back to the AI overlays.
export const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

export const locales = JSON.parse(read('static/locales/activeLocales.json'))

export function loadTranslator(locale) {
  const human = load(read(`static/locales/${locale}.yaml`))
  let ai = {}
  try { ai = load(read(`static/locales/ai/${locale}.yaml`)) ?? {} } catch (error) { if (error.code !== 'ENOENT') throw error }
  return (...path) => {
    const message = path.reduce((value, key) => value?.[key], human) || path.reduce((value, key) => value?.[key], ai)
    if (!message) throw new Error(`Missing ${path.join(' > ')} translation: ${locale}`)
    return message
  }
}

// Android resource names mapped to their keys under "Home Widgets".
export const homeWidgetStrings = {
  widget_continue_watching_name: 'Continue Watching',
  widget_continue_watching_description: 'Continue Watching Description',
  widget_continue_watching_empty: 'Continue Watching Empty',
  widget_quick_access_name: 'Quick Access',
  widget_quick_access_description: 'Quick Access Description',
  widget_quick_access_choose: 'Choose Pages',
  widget_quick_access_pages: 'Pages',
  widget_search: 'Search',
  widget_subscriptions: 'Subscriptions',
  widget_watch_later: 'Watch Later',
  widget_history: 'History',
  widget_playlists: 'Playlists',
  widget_downloads: 'Downloads',
  widget_watch_time_name: 'Watch Time',
  widget_watch_time_description: 'Watch Time Description',
  widget_today: 'Today',
  widget_last_7_days: 'Last 7 Days',
  widget_recent_downloads_name: 'Recent Downloads',
  widget_recent_downloads_description: 'Recent Downloads Description',
  widget_recent_downloads_empty: 'Recent Downloads Empty'
}
