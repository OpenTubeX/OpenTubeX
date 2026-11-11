// Tells the web app that this extension's request rules are active.
// Bump the protocol when the app needs different rules.
Object.defineProperty(globalThis, 'opentubexExtension', {
  value: Object.freeze({ protocol: 1 })
})
