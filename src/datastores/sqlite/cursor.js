export function createDeferredCursor(execute) {
  const options = { sort: {}, skip: 0, limit: null }
  const cursor = {
    sort: value => { options.sort = value; return cursor },
    skip: value => { options.skip = value; return cursor },
    limit: value => { options.limit = value; return cursor },
    then: (resolve, reject) => execute(options).then(resolve, reject),
  }
  return cursor
}
