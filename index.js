/**
 * @format
 */

// Hermes/React Native ship no URL; it must exist before the app graph loads.
import 'react-native-url-polyfill/auto';

import {AppRegistry, LogBox} from 'react-native';

// Silence LogBox in E2E builds so the in-app warning toast doesn't cover
// chat-bottom controls Appium needs. Left active otherwise so warnings
// surface during development.
if (__E2E__) {
  LogBox.ignoreAllLogs(true);
}

import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);

// Android-only: runs the idle memory sweep from a HeadlessJsTaskService
// with no chat UI ever mounted, triggered by a periodic WorkManager job
// (see android/app/src/main/java/com/pocketpalai/memorysweep/). iOS has no
// equivalent background trigger, so this task simply never runs there.
AppRegistry.registerHeadlessTask(
  'MemorySweepTask',
  () => require('./src/services/memory/MemorySweepHeadlessTask').default,
);
