import notifee, {
  AndroidImportance,
  AuthorizationStatus,
} from '@notifee/react-native';

import {uiStore} from '../../store';

// Android needs a channel before a notification can post to it (API 26+);
// notifee's createChannel is idempotent by id, but skipping the repeat call
// once made avoids an awaited native round trip on every sweep.
const ANDROID_CHANNEL_ID = 'memory-sweeps';
let androidChannelCreated = false;

async function ensureAndroidChannel(): Promise<void> {
  if (androidChannelCreated) {
    return;
  }
  await notifee.createChannel({
    id: ANDROID_CHANNEL_ID,
    name: 'Memory sweeps',
    importance: AndroidImportance.LOW,
  });
  androidChannelCreated = true;
}

/**
 * Requests OS notification permission, prompting the user if they haven't
 * already decided. Returns whether notifications are actually authorized —
 * callers should not turn the "notify on sweep" setting on when this
 * resolves false.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const settings = await notifee.requestPermission();
    return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
  } catch (error) {
    console.error(
      'SweepNotificationService: permission request failed:',
      error,
    );
    return false;
  }
}

/**
 * Shows a quiet, local notification announcing a completed idle sweep.
 * Deliberately generic text, never the worldview summary or any other
 * memory content itself — a notification can sit on a lock screen visible
 * to anyone nearby, which is the wrong place for private facts about the
 * user to surface. Never throws: a sweep has already committed its changes
 * by the time this runs, so a failed notification must not look like a
 * failed sweep.
 */
export async function notifySweepComplete(): Promise<void> {
  try {
    const settings = await notifee.getNotificationSettings();
    if (settings.authorizationStatus < AuthorizationStatus.AUTHORIZED) {
      return;
    }
    await ensureAndroidChannel();
    const l10n = uiStore.l10n;
    await notifee.displayNotification({
      title: l10n.notifications.sweepCompleteTitle,
      body: l10n.notifications.sweepCompleteBody,
      android: {
        channelId: ANDROID_CHANNEL_ID,
        importance: AndroidImportance.LOW,
        smallIcon: 'ic_launcher',
      },
    });
  } catch (error) {
    console.error(
      'SweepNotificationService: failed to display notification:',
      error,
    );
  }
}
