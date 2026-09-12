package com.animesoul.mobile;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.view.WindowManager;

/** Owns Android media controls and mirrors their commands to the trusted WebView player. */
final class PlaybackSessionController {
    interface CommandDispatcher {
        void dispatch(String command, double position);
    }

    private static final String CHANNEL_ID = "animesoul_playback";
    private static final int NOTIFICATION_ID = 1702;

    private final Activity activity;
    private final CommandDispatcher commandDispatcher;
    private final Runnable notificationPermissionRequester;
    private final MediaSession mediaSession;
    private boolean active;
    private boolean playing;

    PlaybackSessionController(
            Activity activity,
            CommandDispatcher commandDispatcher,
            Runnable notificationPermissionRequester
    ) {
        this.activity = activity;
        this.commandDispatcher = commandDispatcher;
        this.notificationPermissionRequester = notificationPermissionRequester;
        createNotificationChannel();
        mediaSession = new MediaSession(activity, "AnimeSoulPlayback");
        mediaSession.setFlags(
                MediaSession.FLAG_HANDLES_MEDIA_BUTTONS
                        | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                commandDispatcher.dispatch("play", -1);
            }

            @Override
            public void onPause() {
                commandDispatcher.dispatch("pause", -1);
            }

            @Override
            public void onSeekTo(long positionMs) {
                commandDispatcher.dispatch("seek", positionMs / 1000d);
            }

            @Override
            public void onRewind() {
                commandDispatcher.dispatch("rewind", -1);
            }

            @Override
            public void onFastForward() {
                commandDispatcher.dispatch("forward", -1);
            }
        });
    }

    boolean isActive() {
        return active;
    }

    boolean isPlaying() {
        return playing;
    }

    void handleAction(String action) {
        if (PlaybackControlReceiver.ACTION_PLAY.equals(action)) commandDispatcher.dispatch("play", -1);
        else if (PlaybackControlReceiver.ACTION_PAUSE.equals(action)) commandDispatcher.dispatch("pause", -1);
        else if (PlaybackControlReceiver.ACTION_REWIND.equals(action)) commandDispatcher.dispatch("rewind", -1);
        else if (PlaybackControlReceiver.ACTION_FORWARD.equals(action)) commandDispatcher.dispatch("forward", -1);
    }

    void update(
            String title,
            String subtitle,
            boolean isPlaying,
            double position,
            double duration,
            boolean isActive
    ) {
        active = isActive;
        playing = isActive && isPlaying;
        if (playing) {
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        if (!isActive) {
            clear();
            return;
        }

        long positionMs = Math.max(0L, Math.round(position * 1000d));
        long durationMs = Math.max(0L, Math.round(duration * 1000d));
        long actions = PlaybackState.ACTION_PLAY
                | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SEEK_TO
                | PlaybackState.ACTION_REWIND
                | PlaybackState.ACTION_FAST_FORWARD;
        mediaSession.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, subtitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, subtitle)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)
                .build());
        mediaSession.setPlaybackState(new PlaybackState.Builder()
                .setActions(actions)
                .setState(
                        isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        positionMs,
                        isPlaying ? 1f : 0f
                )
                .build());
        mediaSession.setActive(true);
        showNotification(title, subtitle, isPlaying);
        if (isPlaying) notificationPermissionRequester.run();
    }

    void clear() {
        active = false;
        playing = false;
        activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        mediaSession.setActive(false);
        NotificationManager manager = (NotificationManager) activity.getSystemService(
                Activity.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(NOTIFICATION_ID);
    }

    void release() {
        clear();
        mediaSession.release();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                activity.getString(R.string.playback_notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(activity.getString(R.string.playback_notification_channel_description));
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);
        NotificationManager manager = activity.getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private PendingIntent playbackAction(String action, int requestCode) {
        Intent intent = new Intent(activity, PlaybackControlReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(
                activity,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void showNotification(String title, String subtitle, boolean isPlaying) {
        Intent openIntent = new Intent(activity, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                activity,
                1701,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(activity, CHANNEL_ID)
                : new Notification.Builder(activity);
        builder.setSmallIcon(R.drawable.animesoul_icon)
                .setContentTitle(title)
                .setContentText(subtitle)
                .setContentIntent(contentIntent)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setOngoing(isPlaying)
                .addAction(new Notification.Action.Builder(
                        android.R.drawable.ic_media_rew,
                        activity.getString(R.string.playback_rewind),
                        playbackAction(PlaybackControlReceiver.ACTION_REWIND, 1710)
                ).build())
                .addAction(new Notification.Action.Builder(
                        isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        activity.getString(isPlaying ? R.string.playback_pause : R.string.playback_play),
                        playbackAction(
                                isPlaying
                                        ? PlaybackControlReceiver.ACTION_PAUSE
                                        : PlaybackControlReceiver.ACTION_PLAY,
                                1711
                        )
                ).build())
                .addAction(new Notification.Action.Builder(
                        android.R.drawable.ic_media_ff,
                        activity.getString(R.string.playback_forward),
                        playbackAction(PlaybackControlReceiver.ACTION_FORWARD, 1712)
                ).build())
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(mediaSession.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));
        NotificationManager manager = (NotificationManager) activity.getSystemService(
                Activity.NOTIFICATION_SERVICE);
        if (manager == null) return;
        try {
            manager.notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) {
            // Playback and PiP remain available if notification access is denied.
        }
    }
}
