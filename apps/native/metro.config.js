const { withVarlockMetroConfig } = require("@varlock/expo-integration/metro-config");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Alchemy writes runtime state here; block it to avoid Metro refresh loops.
const blockList = config.resolver.blockList ?? [];
const blockListPatterns = Array.isArray(blockList) ? blockList : [blockList];

config.resolver.blockList = [
  ...blockListPatterns,
  /[/\\]packages[/\\]infra[/\\]\.alchemy(?:[/\\]|$)/,
];

module.exports = withVarlockMetroConfig(config);
