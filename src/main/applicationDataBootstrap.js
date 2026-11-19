import { app, crashReporter } from 'electron'
import path from 'node:path'
import {
  configureApplicationDataPaths,
  configurePortableEnvironment
} from './applicationDataPaths'

// Configure process-wide paths before modules such as src/datastores/index.js
// resolve app.getPath('userData') during import.
configurePortableEnvironment()
configureApplicationDataPaths(app)

// E2E tests keep minidumps of crashed processes in their profile, so a rare
// renderer crash on CI can be traced to its cause. They are never uploaded.
// Processes started before this call are not covered, so it runs first.
if (process.env.OPENTUBEX_E2E_USER_DATA_DIR) {
  app.setPath('crashDumps', path.join(app.getPath('userData'), 'Crashpad'))
  crashReporter.start({ uploadToServer: false })
}
