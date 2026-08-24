import { app } from 'electron'

// Allows E2E tests and worktree development servers to isolate their data from
// the user's real profile.
// This lives in its own module imported first by main/index.js, because it
// must run before any module that resolves app.getPath('userData') at import
// time (e.g. src/datastores/index.js).
const userDataPath = process.env.OPENTUBEX_E2E_USER_DATA_DIR ?? process.env.OPENTUBEX_DEV_USER_DATA_DIR
if (userDataPath) {
  app.setPath('userData', userDataPath)
  app.setPath('sessionData', userDataPath)
}
