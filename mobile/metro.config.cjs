const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
// The web app and native app deliberately use independent package installs.
// Only this dependency-free helper is shared; do not resolve web React in native.
config.watchFolders = [path.resolve(__dirname, '../shared')];
module.exports = config;
