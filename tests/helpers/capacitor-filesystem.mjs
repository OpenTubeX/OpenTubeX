import assert from 'node:assert/strict'

export const filesystemPluginHeader = {
  name: 'Filesystem',
  methods: ['readdir', 'readFile', 'writeFile', 'deleteFile', 'rmdir'].map(name => ({ name, rtype: 'promise' })),
}

const missing = () => Object.assign(new Error('File does not exist.'), { code: 'OS-PLUG-FILE-0008' })

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
          if (names.length === 0) throw missing()
          return { files: names.map(name => ({ name: name.slice(options.path.length + 1), type: 'file', size: files.get(name).length })) }
        }
        case 'readFile':
          if (!files.has(options.path)) throw missing()
          return { data: files.get(options.path) }
        case 'writeFile':
          files.set(options.path, options.data)
          return { uri: options.path }
        case 'deleteFile':
          await remove(options)
          files.delete(options.path)
          return
        case 'rmdir':
          if (list(options.path).length === 0) throw missing()
          for (const name of list(options.path)) files.delete(name)
          return
      }
      assert.fail(`Unexpected filesystem call: ${method}`)
    },
  }
}
