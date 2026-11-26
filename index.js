// The background push task must exist before the app renders (Android can
// start the JS only to run it), so it's defined here, ahead of the router.
import './lib/push-background';
import 'expo-router/entry';
