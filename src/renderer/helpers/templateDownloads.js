import store from '../store/index'
import { ytDlp } from './ytDlp'
import { showToast } from './utils'
import {
  baseDownloadOptions,
  DEFAULT_DOWNLOAD_TEMPLATES,
  getDownloadTemplateOptions,
  normalizeDownloadOptions,
  parseCustomDownloadTemplates
} from './downloadTemplates'

const ACTIVE_DOWNLOAD_STATUSES = new Set(['queued', 'preparing', 'downloading', 'processing', 'pausing', 'paused'])

/**
 * What to download, described like the download prompt's props.
 * @typedef DownloadTarget
 * @property {string} title
 * @property {string} [thumbnail]
 * @property {string} [videoId]
 * @property {string} [externalUrl]
 * @property {string[]} [videoIds] the videos of a user playlist
 * @property {string} [playlistId] a YouTube playlist's ID
 * @property {string} [playlistKey] identifies the playlist's downloads
 * @property {boolean} [isPlaylist]
 * @property {number} [videoCount]
 */

/**
 * @param {Record<string, object>} downloads
 * @param {DownloadTarget} target
 * @returns {object | undefined} the latest download of the target that hasn't finished
 */
export function findActiveDownload(downloads, target) {
  return Object.values(downloads).filter(download => {
    if (!ACTIVE_DOWNLOAD_STATUSES.has(download.status)) return false
    if (target.externalUrl) return download.retryPayload?.externalUrl === target.externalUrl
    if (!target.isPlaylist) return download.videoId === target.videoId
    return !!target.playlistKey && download.playlistKey === target.playlistKey
  }).at(-1)
}

/** @type {Set<string>} keys of the targets whose template downloads are starting */
const startingTargets = new Set()

/**
 * @param {DownloadTarget} target
 * @returns {string | null} the same identity {@link findActiveDownload} matches on
 */
function targetKey(target) {
  if (target.externalUrl) return `url:${target.externalUrl}`
  if (!target.isPlaylist) return `video:${target.videoId}`
  return target.playlistKey ? `playlist:${target.playlistKey}` : null
}

function openDownloadsButton(t) {
  return {
    label: t('Downloads.Open Downloads'),
    icon: ['fas', 'download'],
    action: () => store.dispatch('showSettingsWindow', 'downloads')
  }
}

/**
 * Starts a download with a template's options, without the download prompt.
 * @param {string} templateValue
 * @param {DownloadTarget} target
 * @param {{ t: Function, locale: string }} i18n
 */
export async function startTemplateDownload(templateValue, target, { t, locale }) {
  const key = targetKey(target)
  if ((key !== null && startingTargets.has(key)) || findActiveDownload(store.getters.getYtDlpDownloads, target)) {
    showToast({
      message: t('Downloads.Already Downloading', { title: target.title }),
      icon: ['fas', 'download'],
      buttons: [openDownloadsButton(t)]
    })
    return
  }

  if (key !== null) startingTargets.add(key)
  try {
    await requestTemplateDownload(templateValue, target, { t, locale })
  } finally {
    if (key !== null) startingTargets.delete(key)
  }
}

/**
 * @param {string} templateValue
 * @param {DownloadTarget} target
 * @param {{ t: Function, locale: string }} i18n
 */
async function requestTemplateDownload(templateValue, target, { t, locale }) {
  const folderRequired = (process.env.IS_CAPACITOR || window.ftElectron?.isFlatpak) &&
    store.getters.getYtDlpDownloadFolderPath === ''
  if (folderRequired) {
    let folder = null
    try {
      folder = await ytDlp.ytDlpChooseDownloadFolder()
    } catch (error) {
      showToast({ message: error?.message || t('Settings.Data Settings.Unable to write file'), icon: ['fas', 'circle-exclamation'] })
    }
    if (!folder) return
  }

  const templateOptions = getDownloadTemplateOptions(templateValue, parseCustomDownloadTemplates(store.getters.getYtDlpDownloadTemplates))
  if (templateOptions === null) return

  let result
  try {
    result = await ytDlp.ytDlpDownload({
      ...normalizeDownloadOptions(templateOptions, baseDownloadOptions(locale)),
      videoId: target.videoId ?? '',
      ...(target.externalUrl ? { externalUrl: target.externalUrl } : {}),
      videoIds: [...(target.videoIds ?? [])],
      playlistId: target.playlistId ?? '',
      playlistKey: target.playlistKey ?? '',
      isPlaylist: target.isPlaylist === true,
      ...(target.isPlaylist && target.videoCount > 0 ? { videoCount: target.videoCount } : {}),
      title: target.title,
      thumbnail: target.thumbnail ?? '',
      template: templateValue
    })
  } catch {
    result = null
  }

  if (result != null && 'id' in result) {
    showToast({
      message: t('Downloads.Download Started', { title: target.title }),
      icon: ['fas', 'download'],
      buttons: [openDownloadsButton(t)]
    })
  } else {
    showToast({ message: t('Downloads.Download Failed'), icon: ['fas', 'circle-exclamation'] })
  }
}

function templateIcon(mode) {
  if (mode === 'audio') return ['fas', 'music']
  if (mode === 'subtitles') return ['fas', 'closed-captioning']
  return ['fas', 'film']
}

/**
 * @typedef DownloadMenu
 * @property {() => DownloadTarget} target
 * @property {() => void} customize opens the download prompt
 * @property {Function} t
 * @property {import('vue').Ref<string>} locale
 */

/**
 * Menu entries that start a download with any template, below an entry that
 * opens the download prompt to customize it first.
 * @param {DownloadMenu} menu
 */
export function downloadTemplateMenuItems({ target, customize, t, locale }) {
  const start = value => startTemplateDownload(value, target(), { t, locale: locale.value })
  const customTemplates = parseCustomDownloadTemplates(store.getters.getYtDlpDownloadTemplates)
  return [
    {
      label: t('Downloads.Customize Download'),
      icon: ['fas', 'sliders'],
      enabled: true,
      nearAnchor: true,
      run: customize
    },
    { type: 'separator' },
    ...DEFAULT_DOWNLOAD_TEMPLATES.map(template => ({
      label: template.label(t),
      icon: templateIcon(template.options.mode),
      enabled: true,
      run: () => start(template.value)
    })),
    ...(customTemplates.length > 0 ? [{ type: 'separator' }] : []),
    ...customTemplates.map(template => ({
      label: template.name,
      icon: templateIcon(template.options?.mode),
      enabled: true,
      run: () => start(`template:${template.name}`)
    }))
  ]
}

/**
 * A menu entry with {@link downloadTemplateMenuItems} as its submenu.
 * @param {DownloadMenu & { label: string, actionId?: string }} menu Shortcuts
 *   such as swipe actions run the entry itself, which opens the prompt.
 *   `actionId` identifies it for them.
 */
export function downloadMenuItem({ label, actionId, ...menu }) {
  return {
    label,
    ...(actionId ? { actionId } : {}),
    icon: ['fas', 'download'],
    enabled: true,
    run: menu.customize,
    submenu: downloadTemplateMenuItems(menu)
  }
}
