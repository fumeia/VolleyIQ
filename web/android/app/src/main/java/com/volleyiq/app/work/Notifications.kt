package com.volleyiq.app.work

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo
import com.volleyiq.app.MainActivity
import com.volleyiq.app.R

object Notifications {
    private const val CHANNEL = "background-work"

    private fun ensureChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Analysis & downloads", NotificationManager.IMPORTANCE_LOW))
        }
    }

    fun build(context: Context, title: String, text: String, progress: Double?, ongoing: Boolean = true) =
        builder(context, title, text, progress, ongoing).build()

    fun builder(context: Context, title: String, text: String, progress: Double?, ongoing: Boolean = true): NotificationCompat.Builder =
        NotificationCompat.Builder(context.also(::ensureChannel), CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setOnlyAlertOnce(true)
            .setOngoing(ongoing)
            .setContentIntent(
                PendingIntent.getActivity(
                    context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .apply { if (progress != null) setProgress(1000, (progress * 1000).toInt(), false) }

    fun foreground(context: Context, id: Int, title: String, text: String, progress: Double?): ForegroundInfo {
        val n = build(context, title, text, progress)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(id, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(id, n)
        }
    }

    fun done(context: Context, id: Int, title: String, text: String) {
        context.getSystemService(NotificationManager::class.java).notify(id + 1, build(context, title, text, null, ongoing = false))
    }
}
