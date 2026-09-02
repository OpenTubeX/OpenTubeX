import { app } from 'electron'
import { configureApplicationDataPaths } from './applicationDataPaths'

// Configure portable builds, E2E tests, and worktree development servers
// before any module resolves an Electron data path. This module must be
// imported before modules such as src/datastores/index.js, which resolve
// app.getPath('userData') during import.
configureApplicationDataPaths(app)
