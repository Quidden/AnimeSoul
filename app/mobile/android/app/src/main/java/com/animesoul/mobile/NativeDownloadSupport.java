package com.animesoul.mobile;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.arthenica.ffmpegkit.FFmpegKit;
import com.arthenica.ffmpegkit.FFmpegSession;
import com.arthenica.ffmpegkit.ReturnCode;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Native MP4 remuxing and scoped-storage publishing used by Chaquopy. */
public final class NativeDownloadSupport {
    private static final Map<String, RemuxState> REMUXES = new ConcurrentHashMap<>();
    private static volatile Context applicationContext;

    private NativeDownloadSupport() {}

    static void initialize(Context context) {
        applicationContext = context.getApplicationContext();
    }

    public static boolean startRemux(String jobId, String source, String target) {
        if (jobId == null || source == null || target == null) return false;
        RemuxState state = new RemuxState();
        REMUXES.put(jobId, state);
        String[] arguments = new String[] {
                "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
                "-user_agent", "Mozilla/5.0 (Linux; Android) AnimeSoul/0.2",
                "-headers", "Referer: https://kodik.info/\r\n",
                "-i", source,
                "-map", "0:v?", "-map", "0:a?",
                "-c", "copy",
                "-movflags", "+faststart", target
        };
        try {
            FFmpegSession session = FFmpegKit.executeWithArgumentsAsync(
                    arguments,
                    completed -> {
                        state.success = ReturnCode.isSuccess(completed.getReturnCode());
                        if (!state.success) {
                            String output = completed.getOutput();
                            state.error = output == null || output.trim().isEmpty()
                                    ? "FFmpeg завершился с ошибкой."
                                    : lastLine(output);
                        }
                        state.done = true;
                    },
                    null,
                    statistics -> state.timeMs = Math.max(state.timeMs, Math.round(statistics.getTime()))
            );
            state.sessionId = session.getSessionId();
            return true;
        } catch (Throwable error) {
            state.error = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            state.done = true;
            return false;
        }
    }

    public static String remuxState(String jobId) {
        RemuxState state = REMUXES.get(jobId);
        JSONObject result = new JSONObject();
        if (state == null) return result.toString();
        try {
            result.put("done", state.done);
            result.put("success", state.success);
            result.put("timeMs", state.timeMs);
            result.put("error", state.error);
        } catch (Exception ignored) {
            return "{}";
        }
        if (state.done) REMUXES.remove(jobId, state);
        return result.toString();
    }

    public static void cancelRemux(String jobId) {
        RemuxState state = REMUXES.remove(jobId);
        if (state != null && state.sessionId >= 0) FFmpegKit.cancel(state.sessionId);
    }

    public static String publishVideo(
            String sourcePath,
            String animeFolder,
            String seasonFolder,
            String displayName
    ) throws Exception {
        Context context = requireContext();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            throw new IllegalStateException("Общая папка AnimeSoul требует Android 10 или новее.");
        }
        ContentResolver resolver = context.getContentResolver();
        String safeAnime = safeSegment(animeFolder);
        String safeSeason = safeSegment(seasonFolder);
        String safeName = safeSegment(displayName);
        String relativePath = Environment.DIRECTORY_MOVIES + "/AnimeSoul/" + safeAnime + "/" + safeSeason + "/";

        ContentValues values = new ContentValues();
        values.put(MediaStore.Video.Media.DISPLAY_NAME, safeName);
        values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
        values.put(MediaStore.Video.Media.RELATIVE_PATH, relativePath);
        values.put(MediaStore.Video.Media.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("MediaStore не создал видео.");
        try {
            try (InputStream input = new FileInputStream(sourcePath);
                 OutputStream output = resolver.openOutputStream(uri, "w")) {
                if (output == null) throw new IllegalStateException("MediaStore не открыл видео для записи.");
                byte[] buffer = new byte[1024 * 1024];
                int count;
                while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            }
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.Video.Media.IS_PENDING, 0);
            resolver.update(uri, ready, null, null);
            String path = mediaPath(resolver, uri);
            if (path == null || path.trim().isEmpty()) {
                throw new IllegalStateException("MediaStore не вернул файловый путь.");
            }
            JSONObject result = new JSONObject();
            result.put("uri", uri.toString());
            result.put("path", path);
            return result.toString();
        } catch (Exception error) {
            resolver.delete(uri, null, null);
            throw error;
        }
    }

    public static void deleteVideo(String contentUri) {
        try {
            requireContext().getContentResolver().delete(Uri.parse(contentUri), null, null);
        } catch (Exception ignored) {
            // A user may already have removed the visible file manually.
        }
    }

    private static String mediaPath(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(
                uri,
                new String[] { MediaStore.Video.Media.DATA },
                null,
                null,
                null
        )) {
            if (cursor == null || !cursor.moveToFirst()) return null;
            int column = cursor.getColumnIndex(MediaStore.Video.Media.DATA);
            return column >= 0 ? cursor.getString(column) : null;
        }
    }

    private static Context requireContext() {
        Context context = applicationContext;
        if (context == null) throw new IllegalStateException("AnimeSoul ещё не инициализирован.");
        return context;
    }

    private static String safeSegment(String value) {
        String safe = value == null ? "AnimeSoul" : value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", " ");
        safe = safe.trim().replaceAll("\\s+", " ");
        return safe.isEmpty() ? "AnimeSoul" : safe;
    }

    private static String lastLine(String output) {
        String[] lines = output.trim().split("\\R");
        return lines.length == 0 ? "FFmpeg завершился с ошибкой." : lines[lines.length - 1];
    }

    private static final class RemuxState {
        volatile long sessionId = -1;
        volatile long timeMs;
        volatile boolean done;
        volatile boolean success;
        volatile String error = "";
    }
}
