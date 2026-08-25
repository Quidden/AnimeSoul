package com.animesoul.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Keeps the embedded Python downloader alive while AnimeSoul is backgrounded.
 *
 * <p>The actual transfer remains owned by OfflineLibraryService in the bundled
 * FastAPI runtime. This service only raises the Android process priority, keeps
 * the CPU awake while the queue is active, and mirrors progress to a system
 * notification. Polling localhost rather than the WebView keeps this working
 * when Android pauses JavaScript.</p>
 */
public final class DownloadForegroundService extends Service {
    private static final String CHANNEL_ID = "animesoul_downloads_v1";
    private static final int NOTIFICATION_ID = 2205;
    private static final int MOBILE_DATA_BLOCKED_NOTIFICATION_ID = 2206;
    private static final long POLL_INTERVAL_SECONDS = 1;
    private static final long INITIAL_QUEUE_GRACE_MS = 12_000;
    private static final long WAKE_LOCK_TIMEOUT_MS = 6 * 60 * 60 * 1000L;

    private final ScheduledExecutorService pollExecutor = Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean polling = new AtomicBoolean();
    private NotificationManager notificationManager;
    private PowerManager.WakeLock wakeLock;
    private long serviceStartedAt;
    private volatile boolean sawActiveQueue;
    private volatile boolean terminalNotificationPosted;
    private volatile boolean stopping;

    public static void start(Context context) {
        Intent intent = new Intent(context, DownloadForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void showMobileDataBlocked(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    context.getString(R.string.download_notification_channel_name),
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setSound(null, null);
            manager.createNotificationChannel(channel);
        }
        Intent openIntent = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                MOBILE_DATA_BLOCKED_NOTIFICATION_ID,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);
        Notification notification = builder
                .setSmallIcon(R.drawable.ic_download_notification)
                .setColor(Color.rgb(154, 120, 255))
                .setContentTitle("Скачивание не начато")
                .setContentText("Разрешите мобильную сеть в Настройки → Офлайн-библиотека.")
                .setStyle(new Notification.BigTextStyle().bigText(
                        "Скачивание через мобильную сеть отключено. Разрешите его в Настройки → Офлайн-библиотека."
                ))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_STATUS)
                .build();
        try {
            manager.notify(MOBILE_DATA_BLOCKED_NOTIFICATION_ID, notification);
        } catch (SecurityException ignored) {
            // The in-app toast still explains the blocked action.
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        serviceStartedAt = System.currentTimeMillis();
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        createNotificationChannel();
        startAsForeground(preparingNotification());

        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                getPackageName() + ":offline-download"
        );
        wakeLock.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (polling.compareAndSet(false, true)) {
            pollExecutor.scheduleWithFixedDelay(
                    this::pollQueue,
                    0,
                    POLL_INTERVAL_SECONDS,
                    TimeUnit.SECONDS
            );
        }
        // The Python queue isn't persisted across a killed process, so an
        // automatic service-only restart would display progress for no job.
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void pollQueue() {
        if (stopping) return;
        try {
            QueueSnapshot snapshot = readQueueSnapshot();
            if (snapshot.activeCount > 0) {
                sawActiveQueue = true;
                if (snapshot.pausedCount > 0 && snapshot.pausedCount == snapshot.activeCount) {
                    releaseWakeLock();
                } else {
                    acquireWakeLock();
                }
                notificationManager.notify(NOTIFICATION_ID, activeNotification(snapshot));
                return;
            }

            releaseWakeLock();
            if (sawActiveQueue || snapshot.isFreshTerminal(serviceStartedAt)) {
                finishQueue(snapshot);
                return;
            }
            if (System.currentTimeMillis() - serviceStartedAt >= INITIAL_QUEUE_GRACE_MS) {
                stopWithoutNotification();
            }
        } catch (Exception ignored) {
            // A localhost request can briefly fail while the bundled runtime
            // is starting. Keep monitoring; if a queue was already observed,
            // retaining the scoped wake lock lets its Python worker continue.
            if (sawActiveQueue && !stopping) {
                notificationManager.notify(
                        NOTIFICATION_ID,
                        ongoingNotification(
                                "Загрузка продолжается",
                                "Ожидаем обновление локальной очереди…",
                                0,
                                true
                        )
                );
            } else if (System.currentTimeMillis() - serviceStartedAt >= INITIAL_QUEUE_GRACE_MS) {
                releaseWakeLock();
                stopWithoutNotification();
            }
        }
    }

    private QueueSnapshot readQueueSnapshot() throws Exception {
        HttpURLConnection connection = null;
        try {
            URL url = new URL("http://127.0.0.1:" + BuildConfig.LOCAL_SERVER_PORT + "/api/downloads/jobs");
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(900);
            connection.setReadTimeout(1_500);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("Download queue HTTP " + connection.getResponseCode());
            }
            try (InputStream input = connection.getInputStream();
                 BufferedReader reader = new BufferedReader(
                         new InputStreamReader(input, StandardCharsets.UTF_8))) {
                StringBuilder body = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
                return QueueSnapshot.fromJson(new JSONObject(body.toString()));
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void finishQueue(QueueSnapshot snapshot) {
        if (stopping) return;
        stopping = true;
        releaseWakeLock();

        if ("error".equals(snapshot.terminalStatus)) {
            String title = snapshot.terminalTitle.isEmpty()
                    ? "Не удалось завершить загрузку"
                    : "Ошибка: " + snapshot.terminalTitle;
            String detail = snapshot.terminalError.isEmpty()
                    ? "Откройте AnimeSoul и повторите загрузку."
                    : snapshot.terminalError;
            postTerminalNotification(title, detail);
        } else if ("completed".equals(snapshot.terminalStatus)) {
            String detail = snapshot.terminalTitle.isEmpty()
                    ? "Серии доступны без интернета."
                    : snapshot.terminalTitle + " доступно без интернета.";
            postTerminalNotification("Загрузка завершена", detail);
        } else {
            stopForegroundAndSelf(true);
        }
    }

    private void postTerminalNotification(String title, String detail) {
        terminalNotificationPosted = true;
        Notification notification = baseBuilder()
                .setContentTitle(title)
                .setContentText(detail)
                .setStyle(new Notification.BigTextStyle().bigText(detail))
                .setOngoing(false)
                .setOnlyAlertOnce(false)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_STATUS)
                .setProgress(0, 0, false)
                .build();
        notificationManager.notify(NOTIFICATION_ID, notification);
        stopForegroundAndSelf(false);
    }

    private Notification preparingNotification() {
        return ongoingNotification(
                "Офлайн-загрузка",
                getString(R.string.download_notification_preparing),
                0,
                true
        );
    }

    private Notification activeNotification(QueueSnapshot snapshot) {
        if (snapshot.pausedCount > 0 && snapshot.pausedCount == snapshot.activeCount) {
            return baseBuilder()
                    .setContentTitle("Загрузка приостановлена")
                    .setContentText("Подключена мобильная сеть — разрешите её в настройках или включите Wi‑Fi.")
                    .setStyle(new Notification.BigTextStyle().bigText(
                            "Подключена мобильная сеть. Загрузка продолжится по Wi‑Fi или после разрешения мобильной сети в настройках AnimeSoul."
                    ))
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .setCategory(Notification.CATEGORY_STATUS)
                    .setProgress(0, 0, false)
                    .build();
        }
        String title = snapshot.activeCount == 1 && !snapshot.firstTitle.isEmpty()
                ? snapshot.firstTitle
                : String.format(Locale.ROOT, "Загружается аниме: %d", snapshot.activeCount);
        String detail;
        if (!snapshot.current.isEmpty()) {
            detail = snapshot.current + " · " + snapshot.completed + " из " + snapshot.total;
        } else if (snapshot.allQueued) {
            detail = "В очереди · " + snapshot.total + " серий";
        } else {
            detail = snapshot.completed + " из " + snapshot.total + " серий";
        }
        return ongoingNotification(title, detail, snapshot.percent, !snapshot.determinate);
    }

    private Notification ongoingNotification(String title, String detail, int progress, boolean indeterminate) {
        return baseBuilder()
                .setContentTitle(title)
                .setContentText(detail)
                .setStyle(new Notification.BigTextStyle().bigText(detail))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_PROGRESS)
                .setProgress(100, progress, indeterminate)
                .build();
    }

    private Notification.Builder baseBuilder() {
        Intent launchIntent = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return builder
                .setSmallIcon(R.drawable.ic_download_notification)
                .setColor(Color.rgb(154, 120, 255))
                .setSubText(getString(R.string.app_name))
                .setContentIntent(contentIntent)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setShowWhen(false);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.download_notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.download_notification_channel_description));
        channel.setShowBadge(false);
        channel.setSound(null, null);
        notificationManager.createNotificationChannel(channel);
    }

    private void startAsForeground(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void acquireWakeLock() {
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    private void stopWithoutNotification() {
        if (stopping) return;
        stopping = true;
        releaseWakeLock();
        stopForegroundAndSelf(true);
    }

    private void stopForegroundAndSelf(boolean removeNotification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(removeNotification
                    ? STOP_FOREGROUND_REMOVE
                    : STOP_FOREGROUND_DETACH);
        } else {
            stopForeground(removeNotification);
        }
        stopSelf();
    }

    @Override
    public void onTimeout(int startId, int foregroundServiceType) {
        releaseWakeLock();
        stopping = true;
        postTerminalNotification(
                "Фоновая загрузка остановлена Android",
                "Откройте AnimeSoul, чтобы продолжить загрузку."
        );
    }

    @Override
    public void onDestroy() {
        stopping = true;
        pollExecutor.shutdownNow();
        releaseWakeLock();
        if (!terminalNotificationPosted && notificationManager != null) {
            notificationManager.cancel(NOTIFICATION_ID);
        }
        super.onDestroy();
    }

    private static final class QueueSnapshot {
        int activeCount;
        int pausedCount;
        int total;
        int completed;
        int percent;
        boolean determinate;
        boolean allQueued = true;
        String firstTitle = "";
        String current = "";
        String terminalStatus = "";
        String terminalTitle = "";
        String terminalError = "";
        long terminalCreatedAt;

        static QueueSnapshot fromJson(JSONObject root) {
            QueueSnapshot result = new QueueSnapshot();
            JSONArray jobs = root.optJSONArray("jobs");
            if (jobs == null) return result;

            double weightedProgress = 0;
            for (int index = 0; index < jobs.length(); index++) {
                JSONObject job = jobs.optJSONObject(index);
                if (job == null) continue;
                String status = job.optString("status", "");
                if ("queued".equals(status) || "downloading".equals(status) || "paused".equals(status)) {
                    int jobTotal = Math.max(0, job.optInt("total", 0));
                    double jobProgress = Math.max(0, Math.min(1, job.optDouble("progress", 0)));
                    result.activeCount += 1;
                    result.total += jobTotal;
                    result.completed += Math.max(0, job.optInt("completed", 0));
                    weightedProgress += jobProgress * jobTotal;
                    if (result.firstTitle.isEmpty()) result.firstTitle = job.optString("title", "");
                    if (result.current.isEmpty() && !job.optString("current", "").isEmpty()) {
                        result.current = job.optString("current", "");
                    }
                    if (!"queued".equals(status)) result.allQueued = false;
                    if ("paused".equals(status)) result.pausedCount += 1;
                    continue;
                }

                if (("completed".equals(status) || "cancelled".equals(status) || "error".equals(status))
                        && job.optLong("createdAt", 0) >= result.terminalCreatedAt) {
                    result.terminalCreatedAt = job.optLong("createdAt", 0);
                    result.terminalStatus = status;
                    result.terminalTitle = job.optString("title", "");
                    result.terminalError = job.optString("error", "");
                }
            }
            result.determinate = result.total > 0;
            if (result.determinate) {
                result.percent = (int) Math.round(Math.max(0, Math.min(100, weightedProgress * 100 / result.total)));
            }
            return result;
        }

        boolean isFreshTerminal(long startedAt) {
            return terminalCreatedAt >= startedAt - 5_000;
        }
    }
}
