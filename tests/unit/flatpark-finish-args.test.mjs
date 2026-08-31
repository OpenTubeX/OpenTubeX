import assert from 'node:assert/strict'
import test from 'node:test'

import { syncFlatpakFinishArgs } from '../../_scripts/syncFlatpakFinishArgs.mjs'

const officialManifest = `app-id: org.opentubex.OpenTubeX
finish-args:
  - --device=dri
  - --own-name=org.mpris.MediaPlayer2.opentubex.*
  - --unset-env=ELECTRON_RUN_AS_NODE
modules: []
`

test('copies the official finish-args into the FlatPark manifest', () => {
  const flatparkManifest = `id: org.opentubex.OpenTubeX
finish-args:
  # Permission for the currently published package.
  - --own-name=org.mpris.MediaPlayer2.chromium.*
  - --own-name=org.mpris.MediaPlayer2.opentubex
  # This comment must not leave stale permission documentation behind.
modules: []
`

  assert.equal(
    syncFlatpakFinishArgs(officialManifest, flatparkManifest),
    `id: org.opentubex.OpenTubeX
finish-args:
  - --device=dri
  - --own-name=org.mpris.MediaPlayer2.opentubex.*
  - --unset-env=ELECTRON_RUN_AS_NODE
modules: []
`
  )
})

test('is idempotent when FlatPark already has the official permissions', () => {
  assert.equal(
    syncFlatpakFinishArgs(officialManifest, officialManifest),
    officialManifest
  )
})

test('rejects unsupported official finish-args structures', () => {
  assert.throws(
    () => syncFlatpakFinishArgs(
      'finish-args:\n  socket: wayland\nmodules: []\n',
      officialManifest
    ),
    /unsupported finish-args entry/
  )
})
