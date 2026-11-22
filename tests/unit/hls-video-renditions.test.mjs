import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ignoreLoneHlsVideoDefaults } from '../../src/renderer/helpers/player/hlsVideoRenditions.js'

test('ignores the default flag of HLS video renditions alone in their group', () => {
  const lone = '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p30",NAME="720p, URI=x",AUTOSELECT=YES,DEFAULT=YES'
  const main = '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="cam",NAME="Main",DEFAULT=YES'
  const alternative = '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="cam",NAME="Side",DEFAULT=NO,URI="side.m3u8"'
  const audio = '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="TYPE=VIDEO",DEFAULT=YES'
  const manifest = ['#EXTM3U', lone, main, alternative, audio, ''].join('\n')
  assert.equal(ignoreLoneHlsVideoDefaults(manifest), ['#EXTM3U', lone.replace('DEFAULT=YES', 'DEFAULT=NO'), main, alternative, audio, ''].join('\n'))
})
