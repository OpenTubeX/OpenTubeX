import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyInvidiousMusicMediaType,
  classifyMusicMediaType,
  MUSIC_MEDIA_TYPE,
} from '../../src/renderer/helpers/player/musicMediaType.js'

test('classifies YouTube Music audio tracks separately from music videos', () => {
  assert.equal(classifyMusicMediaType('MUSIC_VIDEO_TYPE_ATV'), MUSIC_MEDIA_TYPE.AUDIO_TRACK)
  assert.equal(classifyMusicMediaType('MUSIC_VIDEO_TYPE_OMV'), MUSIC_MEDIA_TYPE.OFFICIAL_VIDEO)
  assert.equal(classifyMusicMediaType('MUSIC_VIDEO_TYPE_UGC'), MUSIC_MEDIA_TYPE.USER_VIDEO)
  assert.equal(classifyMusicMediaType('MUSIC_VIDEO_TYPE_PODCAST_EPISODE'), MUSIC_MEDIA_TYPE.PODCAST)
})

test('keeps missing and new YouTube music types unknown', () => {
  assert.equal(classifyMusicMediaType(undefined), MUSIC_MEDIA_TYPE.UNKNOWN)
  assert.equal(classifyMusicMediaType('MUSIC_VIDEO_TYPE_FUTURE'), MUSIC_MEDIA_TYPE.UNKNOWN)
  assert.equal(classifyMusicMediaType(''), MUSIC_MEDIA_TYPE.UNKNOWN)
})

test('classifies Invidious music from artist topic channels as audio tracks', () => {
  assert.equal(classifyInvidiousMusicMediaType({
    author: 'Example Artist - Topic',
    genre: 'Music',
  }), MUSIC_MEDIA_TYPE.AUDIO_TRACK)
})

test('keeps ambiguous Invidious music and non-music topic videos unknown', () => {
  assert.equal(classifyInvidiousMusicMediaType({
    author: 'Example Artist',
    genre: 'Music',
  }), MUSIC_MEDIA_TYPE.UNKNOWN)
  assert.equal(classifyInvidiousMusicMediaType({
    author: 'Example Game - Topic',
    genre: 'Gaming',
  }), MUSIC_MEDIA_TYPE.UNKNOWN)
  assert.equal(classifyInvidiousMusicMediaType({
    author: null,
    genre: 'Music',
  }), MUSIC_MEDIA_TYPE.UNKNOWN)
})
