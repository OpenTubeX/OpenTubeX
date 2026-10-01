const path = require('path')
const { readFileSync } = require('fs')

module.exports = () => ({
  styles: readFileSync(path.join(__dirname, '../src/renderer/startup/splash.css'), 'utf8'),
  script: readFileSync(path.join(__dirname, '../src/renderer/startup/boot.js'), 'utf8'),
  logo: readFileSync(path.join(__dirname, '../_icons/iconColorSmall.svg'), 'utf8').replaceAll('#212121', 'currentColor')
})
