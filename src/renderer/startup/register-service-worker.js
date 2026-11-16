// Registers the browser build's service worker. index.ejs passes the build's
// version, so each build's worker replaces the previous build's cache.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(`pwabuilder-sw.js?v=${document.currentScript.dataset.version}`, { scope: './' })
}
