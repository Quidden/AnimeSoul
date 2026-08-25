package com.animesoul.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Routes notification transport buttons to the active trusted WebView player. */
public final class PlaybackControlReceiver extends BroadcastReceiver {
    public static final String ACTION_PLAY = "com.animesoul.mobile.playback.PLAY";
    public static final String ACTION_PAUSE = "com.animesoul.mobile.playback.PAUSE";
    public static final String ACTION_REWIND = "com.animesoul.mobile.playback.REWIND";
    public static final String ACTION_FORWARD = "com.animesoul.mobile.playback.FORWARD";

    @Override
    public void onReceive(Context context, Intent intent) {
        MainActivity.receivePlaybackAction(intent == null ? null : intent.getAction());
    }
}
