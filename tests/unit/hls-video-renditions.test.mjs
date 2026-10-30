import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ignoreMuxedHlsVideoDefaults } from '../../src/renderer/helpers/player/hlsVideoRenditions.js'

test('ignores the default flag of HLS video renditions without their own playlist', () => {
  const muxed = '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p30",NAME="720p",AUTOSELECT=YES,DEFAULT=YES'
  const alternative = '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="cam",NAME="Main",DEFAULT=YES,URI="main.m3u8"'
  const audio = '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",DEFAULT=YES'
  const manifest = ['#EXTM3U', muxed, alternative, audio, ''].join('\n')
  assert.equal(ignoreMuxedHlsVideoDefaults(manifest), ['#EXTM3U', muxed.replace('DEFAULT=YES', 'DEFAULT=NO'), alternative, audio, ''].join('\n'))
})
