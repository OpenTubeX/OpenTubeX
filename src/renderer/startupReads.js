// Imported first by the renderer entry and without imports of its own, so the
// main process reads the settings and the library while the modules that make
// up the app are evaluated.
if (process.env.IS_ELECTRON) {
  window.ftElectron.startStartupReads()
}
