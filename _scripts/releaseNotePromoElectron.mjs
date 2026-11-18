import { app, BrowserWindow } from 'electron'

const htmlPath = process.env.OPENTUBEX_RELEASE_PROMO_HTML

if (!htmlPath) {
  throw new Error('OPENTUBEX_RELEASE_PROMO_HTML is required.')
}

app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('force-color-profile', 'srgb')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

let mainWindow

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    backgroundColor: '#060713',
    webPreferences: {
      sandbox: true,
    },
  })

  await mainWindow.loadFile(htmlPath)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})

app.on('window-all-closed', () => app.quit())
