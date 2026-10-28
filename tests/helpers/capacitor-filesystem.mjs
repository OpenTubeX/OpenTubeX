import assert from 'node:assert/strict'

export const filesystemPluginHeader = {
  name: 'Filesystem',
  methods: ['readdir', 'readFile', 'writeFile', 'deleteFile', 'rmdir', 'stat'].map(name => ({ name, rtype: 'promise' })),
}

/** An in-memory stand-in for the app's files directory. */
export function createFilesystem (remove = async () => {}) {
  const files = new Map()
  const list = path => [...files.keys()].filter(file => file.startsWith(`${path}/`))
  return {
    files,
    async call (method, options) {
      switch (method) {
        case 'readdir': {
          const names = list(options.path)
          if (names.length === 0) throw new Error('Folder does not exist.')
          return { files: names.map(name => ({ name: name.slice(options.path.length + 1), type: 'file', size: files.get(name).length })) }
        }
        case 'readFile':
          if (!files.has(options.path)) throw new Error('File does not exist.')
          return { data: files.get(options.path) }
        case 'writeFile':
          files.set(options.path, options.data)
          return { uri: options.path }
        case 'deleteFile':
          await remove(options)
          files.delete(options.path)
          return
        case 'stat':
          if (list(options.path).length === 0) throw new Error('File does not exist.')
          return { type: 'directory' }
        case 'rmdir':
          for (const name of list(options.path)) files.delete(name)
          return
      }
      assert.fail(`Unexpected filesystem call: ${method}`)
    },
  }
}
