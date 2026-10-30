// Learn more https://docs.expo.io/guides/customizing-metro
// getSentryExpoConfig = Expo's default config + Sentry debug IDs in the bundle
// and its source map, so crash stack traces resolve to our sources.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
