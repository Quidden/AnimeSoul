package com.animesoul.mobile;

import android.net.Uri;
import android.webkit.WebView;
import android.view.View;
import android.view.ViewGroup;
import androidx.appcompat.app.AppCompatActivity;
import androidx.mediarouter.app.MediaRouteButton;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaSeekOptions;
import com.google.android.gms.cast.MediaStatus;
import com.google.android.gms.cast.framework.CastButtonFactory;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.CastStateListener;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Main-thread Cast adapter. The bridge is restricted to our top-level loopback origin. */
public final class CastController implements AutoCloseable {
    private final AppCompatActivity activity;
    private final WebView webView;
    private final String origin;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private CastContext context;
    private RemoteMediaClient client;
    private MediaRouteButton routeButton;
    private String error = "";
    private String pendingId = "";
    private boolean closed;

    private final CastStateListener castStateListener = state -> publish();
    private final RemoteMediaClient.ProgressListener progressListener = (position, duration) -> publish();
    private final RemoteMediaClient.Callback mediaCallback = new RemoteMediaClient.Callback() {
        @Override public void onStatusUpdated() { publish(); }
        @Override public void onMetadataUpdated() { publish(); }
    };
    private final SessionManagerListener<CastSession> sessionListener = new SessionManagerListener<CastSession>() {
        @Override public void onSessionStarting(CastSession session) { publish(); }
        @Override public void onSessionStarted(CastSession session, String id) { bindClient(); publish(); }
        @Override public void onSessionStartFailed(CastSession session, int code) { fail("Не удалось подключиться к телевизору (" + code + ")."); }
        @Override public void onSessionEnding(CastSession session) { publish(); }
        @Override public void onSessionEnded(CastSession session, int code) { pendingId = ""; unbindClient(); publish(); }
        @Override public void onSessionResuming(CastSession session, String id) { publish(); }
        @Override public void onSessionResumed(CastSession session, boolean suspended) { bindClient(); publish(); }
        @Override public void onSessionResumeFailed(CastSession session, int code) { pendingId = ""; unbindClient(); fail("Связь с телевизором потеряна (" + code + ")."); }
        @Override public void onSessionSuspended(CastSession session, int reason) { publish(); }
    };

    public CastController(AppCompatActivity activity, WebView webView, String baseUrl) {
        this.activity = activity;
        this.webView = webView;
        this.origin = baseUrl.replaceAll("/+$", "");
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(webView, "AnimeSoulCast", Collections.singleton(origin),
                (view, message, sourceOrigin, isMainFrame, reply) -> {
                    if (!closed && isMainFrame && origin.equals(sourceOrigin.toString())) handle(message.getData());
                });
        try {
            CastContext.getSharedInstance(activity, executor).addOnSuccessListener(value -> {
                if (closed) return;
                context = value;
                routeButton = new MediaRouteButton(activity);
                // MediaRouteButton.showDialog requires an attached view. React
                // draws the visible button; this native anchor owns its dialog.
                routeButton.setAlpha(0f);
                routeButton.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                ((ViewGroup) webView.getParent()).addView(routeButton, new ViewGroup.LayoutParams(1, 1));
                CastButtonFactory.setUpMediaRouteButton(activity, routeButton);
                context.addCastStateListener(castStateListener);
                context.getSessionManager().addSessionManagerListener(sessionListener, CastSession.class);
                bindClient();
                publish();
            }).addOnFailureListener(reason -> fail("Google Cast недоступен. Проверьте сервисы Google Play."));
        } catch (RuntimeException reason) {
            fail("Google Cast недоступен. Проверьте сервисы Google Play.");
        }
    }

    private CastSession session() {
        return context == null ? null : context.getSessionManager().getCurrentCastSession();
    }

    public boolean isConnected() {
        CastSession session = session();
        return session != null && (session.isConnected() || session.isSuspended());
    }

    private void bindClient() {
        RemoteMediaClient next = session() == null ? null : session().getRemoteMediaClient();
        if (next == client) return;
        unbindClient();
        client = next;
        if (client != null) {
            client.registerCallback(mediaCallback);
            client.addProgressListener(progressListener, 1000);
        }
    }

    private void unbindClient() {
        if (client != null) {
            client.unregisterCallback(mediaCallback);
            client.removeProgressListener(progressListener);
            client = null;
        }
    }

    private static double finite(double value, double maximum) {
        return Double.isFinite(value) ? Math.max(0, Math.min(maximum, value)) : 0;
    }

    private void handle(String raw) {
        if (raw == null || raw.length() > 32_768) return;
        try {
            JSONObject command = new JSONObject(raw);
            String action = command.optString("action");
            if ("state".equals(action)) { publish(); return; }
            if (context == null) { fail("Google Cast ещё не готов. Проверьте сервисы Google Play и повторите."); return; }
            error = "";
            if ("choose".equals(action)) {
                if (!activity.getSupportFragmentManager().isStateSaved() && !routeButton.showDialog()) {
                    fail("Не удалось открыть выбор телевизора. Повторите попытку.");
                }
            } else if ("stop".equals(action)) {
                pendingId = "";
                context.getSessionManager().endCurrentSession(true);
            } else if ("load".equals(action)) {
                load(command);
            } else if (client != null && command.optString("id").equals(mediaId())) {
                switch (action) {
                    case "play": check(client.play()); break;
                    case "pause": check(client.pause()); break;
                    case "seek": check(client.seek(new MediaSeekOptions.Builder()
                            .setPosition((long) (finite(command.optDouble("position"), 7 * 86400) * 1000)).build())); break;
                    case "volume": check(client.setStreamVolume(finite(command.optDouble("volume"), 1))); break;
                    default: break;
                }
            }
            publish();
        } catch (JSONException | RuntimeException reason) {
            fail("Не удалось выполнить команду Google Cast.");
        }
    }

    private void check(com.google.android.gms.common.api.PendingResult<RemoteMediaClient.MediaChannelResult> result) {
        String requestedMedia = mediaId();
        result.setResultCallback(value -> {
            if (!closed && requestedMedia.equals(mediaId()) && !value.getStatus().isSuccess()) fail("Телевизор не выполнил команду (" + value.getStatus().getStatusCode() + ").");
        });
    }

    private void load(JSONObject command) throws JSONException {
        bindClient();
        if (client == null || session() == null || !session().isConnected()) return;
        String url = command.optString("url");
        Uri uri = Uri.parse(url);
        String host = uri.getHost();
        // This phase supports online media only; never expose the private local API.
        if (!"https".equals(uri.getScheme()) || host == null || host.equals("localhost")
                || host.startsWith("127.") || host.equals("[::1]") || uri.getUserInfo() != null
                || url.length() > 8192) {
            fail("Для Cast нужна прямая HTTPS-ссылка. Скачанные серии пока не поддерживаются.");
            return;
        }
        String id = command.getString("id");
        if (!id.startsWith("animesoul:") || id.length() > 100) return;
        MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE);
        metadata.putString(MediaMetadata.KEY_TITLE, command.optString("title").substring(0, Math.min(300, command.optString("title").length())));
        metadata.putString(MediaMetadata.KEY_SUBTITLE, command.optString("subtitle").substring(0, Math.min(300, command.optString("subtitle").length())));
        String type = "video/mp4".equals(command.optString("type")) ? "video/mp4" : "application/x-mpegURL";
        MediaInfo info = new MediaInfo.Builder(url)
                .setContentType(type)
                .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
                .setMetadata(metadata)
                .setCustomData(new JSONObject().put("animeSoulId", id))
                .build();
        pendingId = id;
        client.load(new MediaLoadRequestData.Builder().setMediaInfo(info)
                .setCurrentTime((long) (finite(command.optDouble("position"), 7 * 86400) * 1000))
                .setAutoplay(command.optBoolean("autoplay", true)).build()).setResultCallback(result -> {
                    if (closed || !pendingId.equals(id)) return;
                    pendingId = "";
                    if (!result.getStatus().isSuccess()) fail("Телевизор не открыл поток (" + result.getStatus().getStatusCode() + "). Проверьте совместимость ссылки Kodik.");
                    else publish();
                });
    }

    private String mediaId() {
        MediaInfo info = client == null ? null : client.getMediaInfo();
        JSONObject data = info == null ? null : info.getCustomData();
        return data == null ? "" : data.optString("animeSoulId");
    }

    private void fail(String message) { if (!closed) { error = message; publish(); } }

    public void publish() {
        if (closed) return;
        try {
            CastSession session = session();
            MediaStatus media = client == null ? null : client.getMediaStatus();
            JSONObject state = new JSONObject()
                    .put("available", context != null)
                    .put("connected", session != null && session.isConnected())
                    .put("suspended", session != null && session.isSuspended())
                    .put("device", session == null || session.getCastDevice() == null ? "" : session.getCastDevice().getFriendlyName())
                    .put("id", mediaId())
                    .put("pendingId", pendingId)
                    .put("position", client == null ? 0 : client.getApproximateStreamPosition() / 1000d)
                    .put("duration", client == null ? 0 : client.getStreamDuration() / 1000d)
                    .put("playing", client != null && client.isPlaying())
                    .put("buffering", client != null && (client.isBuffering() || client.isLoadingNextItem()))
                    .put("finished", media != null && media.getPlayerState() == MediaStatus.PLAYER_STATE_IDLE && media.getIdleReason() == MediaStatus.IDLE_REASON_FINISHED)
                    .put("volume", media == null ? 1 : media.getStreamVolume())
                    .put("error", media != null && media.getPlayerState() == MediaStatus.PLAYER_STATE_IDLE && media.getIdleReason() == MediaStatus.IDLE_REASON_ERROR && error.isEmpty()
                            ? "Телевизор не смог воспроизвести этот поток." : error);
            webView.evaluateJavascript("if(location.origin===" + JSONObject.quote(origin) + ")window.dispatchEvent(new CustomEvent('animesoul:cast-state',{detail:" + state + "}));", null);
        } catch (JSONException ignored) { /* Finite SDK values only. */ }
    }

    @Override public void close() {
        closed = true;
        unbindClient();
        if (context != null) {
            context.removeCastStateListener(castStateListener);
            context.getSessionManager().removeSessionManagerListener(sessionListener, CastSession.class);
        }
        executor.shutdownNow();
        if (routeButton != null && routeButton.getParent() instanceof ViewGroup) {
            ((ViewGroup) routeButton.getParent()).removeView(routeButton);
        }
        // The receiver can continue after the sender Activity closes.
    }
}
