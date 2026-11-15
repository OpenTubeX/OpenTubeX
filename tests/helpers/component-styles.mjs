import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Joins a component's scoped stylesheets in the order its `<style scoped src>`
 * blocks load them, so tests see the same cascade as the app.
 * @param {string | URL} component path or file URL of the `.vue` file
 * @returns {Promise<string>}
 */
export async function readScopedStyles (component) {
  const file = component instanceof URL ? fileURLToPath(component) : component
  const source = await readFile(file, 'utf8')
  const styles = [...source.matchAll(/<style scoped src="([^"]+)"/g)]
    .map(([, src]) => readFile(path.resolve(path.dirname(file), src), 'utf8'))
  return (await Promise.all(styles)).join('\n')
}
