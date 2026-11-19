// Runs the Rspack CLI for a production build. Its --node-env option keeps an
// inherited NODE_ENV, so a shell with NODE_ENV=development would build dev assets.
// --persistent-cache reuses earlier results, see persistentCache.js.
import { RspackCLI } from '@rspack/cli'

process.env.NODE_ENV = 'production'
const args = process.argv.filter(arg => arg !== '--persistent-cache')
if (args.length !== process.argv.length) {
  process.env.OTX_PERSISTENT_CACHE = 'true'
}
await new RspackCLI().run(args)
