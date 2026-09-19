package com.pocketpal.memorysweep

import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.pocketpal.specs.NativeMemorySweepSchedulerSpec
import java.util.concurrent.TimeUnit

private const val WORK_NAME = "memory-sweep-periodic"

/**
 * JS-callable control surface for the periodic background memory sweep.
 * The actual sweep work happens in MemorySweepHeadlessService, started by
 * MemorySweepWorker on WorkManager's own schedule — this module only
 * enqueues/cancels that schedule.
 */
@ReactModule(name = NativeMemorySweepSchedulerSpec.NAME)
class MemorySweepModule(reactContext: ReactApplicationContext) :
    NativeMemorySweepSchedulerSpec(reactContext) {

  override fun getName(): String = NativeMemorySweepSchedulerSpec.NAME

  override fun schedulePeriodicSweep(intervalHours: Double, promise: Promise) {
    try {
      val request = PeriodicWorkRequestBuilder<MemorySweepWorker>(
          intervalHours.toLong(),
          TimeUnit.HOURS,
      )
          .setConstraints(
              Constraints.Builder()
                  .setRequiresBatteryNotLow(true)
                  .build(),
          )
          .build()
      WorkManager.getInstance(reactApplicationContext)
          .enqueueUniquePeriodicWork(
              WORK_NAME,
              ExistingPeriodicWorkPolicy.UPDATE,
              request,
          )
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("schedule_failed", e)
    }
  }

  override fun cancelPeriodicSweep(promise: Promise) {
    try {
      WorkManager.getInstance(reactApplicationContext).cancelUniqueWork(WORK_NAME)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("cancel_failed", e)
    }
  }
}
