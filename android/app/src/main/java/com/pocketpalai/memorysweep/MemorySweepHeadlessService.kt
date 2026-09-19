package com.pocketpal.memorysweep

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.pocketpal.R

private const val FOREGROUND_NOTIFICATION_ID = 4821
private const val FOREGROUND_CHANNEL_ID = "memory-sweep-service"

// Generous enough for a model load plus a handful of small completions on
// a mid-range device; short enough that a stuck native call doesn't pin a
// wake lock and foreground notification indefinitely.
private const val JS_TASK_TIMEOUT_MS = 5 * 60 * 1000L

/**
 * Runs the 'MemorySweepTask' headless JS task (see
 * src/services/memory/MemorySweepHeadlessTask.ts) as an Android foreground
 * service — required because loading a GGUF model and running inference is
 * real, sustained work the OS should not treat as an idle background
 * service eligible for an early kill. Started by MemorySweepWorker on
 * WorkManager's own schedule.
 *
 * The foreground notification shown here is the "sweep is running" one;
 * SweepNotificationService posts a separate "sweep complete" notification
 * afterward if the user opted into that.
 */
class MemorySweepHeadlessService : HeadlessJsTaskService() {

  override fun onCreate() {
    super.onCreate()
    startForeground(FOREGROUND_NOTIFICATION_ID, buildRunningNotification())
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
    return HeadlessJsTaskConfig(
        "MemorySweepTask",
        Arguments.createMap(),
        JS_TASK_TIMEOUT_MS,
        false,
    )
  }

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    super.onHeadlessJsTaskFinish(taskId)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun buildRunningNotification(): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        manager?.getNotificationChannel(FOREGROUND_CHANNEL_ID) == null
    ) {
      manager?.createNotificationChannel(
          NotificationChannel(
              FOREGROUND_CHANNEL_ID,
              "Memory maintenance",
              NotificationManager.IMPORTANCE_LOW,
          ),
      )
    }
    return NotificationCompat.Builder(this, FOREGROUND_CHANNEL_ID)
        .setContentTitle(getString(R.string.memory_sweep_running_notification))
        .setSmallIcon(applicationInfo.icon)
        .setOngoing(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build()
  }
}
