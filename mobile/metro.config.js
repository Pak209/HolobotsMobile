const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'glb'])];
// babel-preset-expo inlines EXPO_PUBLIC_HOLOCITY_* at transform time, but Metro's
// transform cache key ignores env values: a warm cache built with the gate off
// reproduced `isLiteEnabled(){return!0}` (lite-release-prep-1). Key the cache on them.
const holoCityEnv = Object.keys(process.env).filter((k) => k.startsWith('EXPO_PUBLIC_HOLOCITY_')).sort().map((k) => `${k}=${process.env[k]}`);
config.cacheVersion = [config.cacheVersion ?? '', ...holoCityEnv].join('|');
module.exports = config;
