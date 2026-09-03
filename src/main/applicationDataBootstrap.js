import { app } from 'electron'
import {
  configureApplicationDataPaths,
  configurePortableEnvironment
} from './applicationDataPaths'

// Configure process-wide paths before modules such as src/datastores/index.js
// resolve app.getPath('userData') during import.
configurePortableEnvironment()
configureApplicationDataPaths(app)
