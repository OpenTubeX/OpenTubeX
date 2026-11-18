// Runs the Rspack CLI for a production build. Its --node-env option keeps an
// inherited NODE_ENV, so a shell with NODE_ENV=development would build dev assets.
import { RspackCLI } from '@rspack/cli'

process.env.NODE_ENV = 'production'
await new RspackCLI().run(process.argv)
