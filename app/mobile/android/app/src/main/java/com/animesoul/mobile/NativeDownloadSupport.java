package com.animesoul.mobile;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.app.PendingIntent;
import android.app.RecoverableSecurityException;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.arthenica.ffmpegkit.FFmpegKit;
import com.arthenica.ffmpegkit.FFmpegSession;
import com.arthenica.ffmpegkit.ReturnCode;

import org.json.JSONObject;
import org.json.JSONArray;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Map;
import java.util.Collections;
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

    public static boolean deleteVideo(String contentUri) {
        Uri uri = Uri.parse(contentUri);
        try {
            return requireContext().getContentResolver().delete(uri, null, null) > 0;
        } catch (RecoverableSecurityException error) {
            requestDeletePermission(error.getUserAction().getActionIntent());
            return false;
        } catch (SecurityException error) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                PendingIntent request = MediaStore.createDeleteRequest(
                        requireContext().getContentResolver(),
                        Collections.singletonList(uri)
                );
                requestDeletePermission(request);
            }
            return false;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static void requestDeletePermission(PendingIntent request) {
        MainActivity activity = MainActivity.activeInstance;
        if (activity == null || request == null) return;
        activity.runOnUiThread(() -> {
            try {
                activity.startIntentSenderForResult(
                        request.getIntentSender(), 44, null, 0, 0, 0
                );
            } catch (Exception ignored) {
                // The API response tells the WebView that confirmation is needed.
            }
        });
    }

    /** Return every MP4 previously published below Movies/AnimeSoul. */
    public static String scanPublishedVideos() throws Exception {
        Context context = requireContext();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "[]";
        ContentResolver resolver = context.getContentResolver();
        Uri collection = MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
        String[] projection = new String[] {
                MediaStore.Video.Media._ID,
                MediaStore.Video.Media.DISPLAY_NAME,
                MediaStore.Video.Media.RELATIVE_PATH,
                MediaStore.Video.Media.DATA,
                MediaStore.Video.Media.SIZE,
                MediaStore.Video.Media.DATE_MODIFIED
        };
        JSONArray result = new JSONArray();
        try (Cursor cursor = resolver.query(
                collection,
                projection,
                MediaStore.Video.Media.RELATIVE_PATH + " LIKE ?",
                new String[] { Environment.DIRECTORY_MOVIES + "/AnimeSoul/%" },
                MediaStore.Video.Media.DATE_MODIFIED + " ASC"
        )) {
            if (cursor == null) return result.toString();
            int idColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID);
            int nameColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME);
            int relativeColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.RELATIVE_PATH);
            int pathColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATA);
            int sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE);
            int modifiedColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_MODIFIED);
            while (cursor.moveToNext()) {
                long id = cursor.getLong(idColumn);
                JSONObject item = new JSONObject();
                item.put("uri", ContentUris.withAppendedId(collection, id).toString());
                item.put("displayName", cursor.getString(nameColumn));
                item.put("relativePath", cursor.getString(relativeColumn));
                item.put("path", cursor.getString(pathColumn));
                item.put("sizeBytes", cursor.getLong(sizeColumn));
                item.put("dateModified", cursor.getLong(modifiedColumn));
                result.put(item);
            }
        }
        return result.toString();
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
