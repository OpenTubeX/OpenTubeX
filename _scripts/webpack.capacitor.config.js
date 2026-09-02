process.env.IS_CAPACITOR = 'true'

const path = require('path')
const config = require('./webpack.web.config')
const botGuardConfig = require('./webpack.botGuardScript.config')

config.name = 'capacitor'
botGuardConfig.name = 'capacitorBotGuardScript'
botGuardConfig.output.path = path.join(__dirname, '../dist/capacitor')

module.exports = [config, botGuardConfig]
