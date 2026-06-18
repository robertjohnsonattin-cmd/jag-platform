package com.jagcorporate.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        "jag-quick-entry", "Quick Entry",
        NotificationManager.IMPORTANCE_LOW
      ).apply { enableVibration(false) }
      nm.createNotificationChannel(channel)
    }

    val openIntent = Intent(context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    val tap = PendingIntent.getActivity(context, 0, openIntent, pendingFlags)
    val action = PendingIntent.getActivity(context, 1, openIntent, pendingFlags)

    val notification = NotificationCompat.Builder(context, "jag-quick-entry")
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle("JAG Mobile")
      .setContentText("Tap + to log an expense instantly")
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(tap)
      .addAction(0, "+ New Expense", action)
      .build()

    nm.notify("jag-boot", 1, notification)
  }
}
