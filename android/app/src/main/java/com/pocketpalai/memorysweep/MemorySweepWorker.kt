package com.pocketpal.memorysweep

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters

/**
 * WorkManager's entry point for a periodic idle-memory sweep. Kept
 * trivial and synchronous — it only starts MemorySweepHeadlessService,
 * which owns the actual JS/model work and its own foreground-service
 * lifetime, and returns immediately rather than blocking WorkManager's
 * own worker thread for however long a model load plus a handful of
 * completions takes.
 */
class MemorySweepWorker(context: Context, params: WorkerParameters) :
    Worker(context, params) {

  override fun doWork(): Result {
    return try {
      val intent = Intent(applicationContext, MemorySweepHeadlessService::class.java)
      ContextCompat.startForegroundService(applicationContext, intent)
      Result.success()
    } catch (e: Exception) {
      Result.failure()
    }
  }
}
