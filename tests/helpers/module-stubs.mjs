import { registerHooks } from 'node:module'

let nextStubSet = 0

/**
 * Imports modules through their real interfaces while replacing some of their
 * dependencies, such as the store or Electron, with stand-ins. Like webpack,
 * it resolves extensionless relative imports.
 *
 * Modules are cached, so each test file should import them once and change
 * the stand-ins' behavior through shared state.
 * @param {string[]} urls Absolute URLs of the modules to import
 * @param {Record<string, Record<string, unknown>>} stubs Exports by bare
 *   specifier (`electron`) or absolute module URL
 * @param {Record<string, string[]>} [extraExports] More export names per stub
 *   that are undefined, for modules that import names a test doesn't need
 */
export async function importWithStubs(urls, stubs, extraExports = {}) {
  const key = `__opentubexStubs${nextStubSet++}`
  globalThis[key] = stubs
  const stubUrl = target => {
    const names = [...new Set([...Object.keys(stubs[target]), ...(extraExports[target] ?? [])])]
    const source = names
      .map(name => `export const ${name} = globalThis.${key}[${JSON.stringify(target)}].${name}`)
      .join('\n')
    return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` }
  }
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return stubUrl(specifier)
      let resolved
      if (specifier.startsWith('.') && !/\.(?:m?js|json)$/.test(specifier)) {
        try {
          resolved = nextResolve(`${specifier}.js`, context)
        } catch {
          resolved = nextResolve(`${specifier}/index.js`, context)
        }
      } else {
        resolved = nextResolve(specifier, context)
      }
      return Object.hasOwn(stubs, resolved.url) ? stubUrl(resolved.url) : resolved
    },
  })
  try {
    return await Promise.all(urls.map(url => import(url)))
  } finally {
    hooks.deregister()
  }
}

/**
 * The absolute URL of a source file.
 * @param {string} path relative to the repository root
 */
export function sourceUrl(path) {
  return new URL(`../../${path}`, import.meta.url).href
}
