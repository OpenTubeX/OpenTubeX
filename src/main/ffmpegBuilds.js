import { createHash } from 'node:crypto'

/**
 * @typedef PinnedFfmpegArchive
 * @property {string} url
 * @property {string} sha256
 */

/**
 * The archives that contain FFmpeg and FFprobe. On Windows both point to the
 * same archive.
 * @typedef {{ ffmpeg: PinnedFfmpegArchive, ffprobe: PinnedFfmpegArchive }} PinnedFfmpegBuild
 */

/**
 * Picks the build for this system from the pins in ffmpegBuilds.json, which
 * .github/workflows/ffmpeg-builds.yml updates. Windows on Arm runs the x64
 * build through emulation.
 * @param {Record<string, PinnedFfmpegBuild>} pins
 * @param {NodeJS.Platform} platform
 * @param {NodeJS.Architecture} arch
 * @returns {PinnedFfmpegBuild}
 */
export function getPinnedFfmpegBuild(pins, platform, arch) {
  const key = `${platform}-${platform === 'win32' && arch === 'arm64' ? 'x64' : arch}`
  if (!Object.hasOwn(pins, key)) {
    throw new Error(`No FFmpeg build is available for ${platform} ${arch}`)
  }
  return pins[key]
}

/**
 * Checks a download against the hash pinned in the app, so a compromised
 * download host cannot serve a different build.
 * @param {Buffer} data
 * @param {PinnedFfmpegArchive} archive
 */
export function verifyPinnedFfmpegArchive(data, archive) {
  if (createHash('sha256').update(data).digest('hex') !== archive.sha256) {
    throw Object.assign(
      new Error(`The downloaded ${archive.url} does not match its pinned checksum`),
      { code: 'MANAGED_TOOL_VERIFICATION_FAILED' }
    )
  }
}
