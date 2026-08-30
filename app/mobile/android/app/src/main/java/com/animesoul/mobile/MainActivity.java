package com.animesoul.mobile;

import android.annotation.SuppressLint;
import android.Manifest;
import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Rational;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 41;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 42;
    private static final int VIDEO_LIBRARY_PERMISSION_REQUEST = 43;
    private static final String LOOPBACK_HOST = "127.0.0.1";

    static volatile MainActivity activeInstance;

    private final ExecutorService startupExecutor = Executors.newSingleThreadExecutor();
    private FrameLayout root;
    private WebView webView;
    private TextView splash;
    private ValueCallback<Uri[]> fileChooserCallback;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private int requestedOrientationBeforeFullscreen = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private OnBackInvokedCallback backInvokedCallback;
    private boolean backRequestPending;
    private boolean notificationPermissionRequested;
    private DownloadNetworkMonitor downloadNetworkMonitor;
    private PlaybackSessionController playbackController;
    private boolean pictureInPictureRequested;
    private int playbackVideoWidth = 16;
    private int playbackVideoHeight = 9;
    private int insetLeft;
    private int insetTop;
    private int insetRight;
    private int insetBottom;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = this;
        NativeDownloadSupport.initialize(this);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(9, 8, 13));
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        splash = new TextView(this);
        splash.setText(R.string.startup_preparing);
        splash.setTextColor(Color.WHITE);
        splash.setTextSize(16);
        splash.setGravity(Gravity.CENTER);
        splash.setBackgroundColor(Color.rgb(9, 8, 13));
        root.addView(splash, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        configureSystemInsets();
        setContentView(root);

        configureWebView();
        configurePlaybackSession();
        configureBackNavigation();
        configureDownloadNetworkMonitor();
        root.postDelayed(this::requestInitialNotificationPermission, 900);
        startupExecutor.execute(this::startLocalRuntime);
    }

    private void configureBackNavigation() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        backInvokedCallback = this::handleBackNavigation;
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                backInvokedCallback
        );
    }

    /** Draw edge-to-edge and expose safe areas to CSS instead of shrinking fullscreen media. */
    private void configureSystemInsets() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }

        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left;
            int top;
            int right;
            int bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets systemBars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                left = systemBars.left;
                top = systemBars.top;
                right = systemBars.right;
                bottom = systemBars.bottom;
            } else {
                left = insets.getSystemWindowInsetLeft();
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                bottom = insets.getSystemWindowInsetBottom();
            }
            insetLeft = left;
            insetTop = top;
            insetRight = right;
            insetBottom = bottom;
            view.setPadding(0, 0, 0, 0);
            applyInsetsToWebView();
            return insets;
        });
        root.requestApplyInsets();
    }

    private void applyInsetsToWebView() {
        if (webView == null) return;
        float density = getResources().getDisplayMetrics().density;
        int left = Math.round(insetLeft / density);
        int top = Math.round(insetTop / density);
        int right = Math.round(insetRight / density);
        int bottom = Math.round(insetBottom / density);
        webView.evaluateJavascript(
                "(function(){var s=document.documentElement.style;"
                        + "s.setProperty('--android-safe-left','" + left + "px');"
                        + "s.setProperty('--android-safe-top','" + top + "px');"
                        + "s.setProperty('--android-safe-right','" + right + "px');"
                        + "s.setProperty('--android-safe-bottom','" + bottom + "px');})();",
                null
        );
    }

    private void resetWebViewViewportScale() {
        if (webView == null) return;
        int widthDp = Math.max(1, getResources().getConfiguration().screenWidthDp);
        webView.evaluateJavascript(
                "(function(){var m=document.querySelector('meta[name=viewport]');"
                        + "if(m)m.setAttribute('content','width=" + widthDp
                        + ", initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');})();",
                null
        );
    }

    @SuppressWarnings("deprecation")
    private void setFullscreenSystemUi(boolean fullscreen) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller == null) return;
            if (fullscreen) {
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            } else {
                controller.show(WindowInsets.Type.systemBars());
            }
            return;
        }
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        if (fullscreen) {
            flags |= View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        }
        getWindow().getDecorView().setSystemUiVisibility(flags);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " AnimeSoulAndroid/0.2.5");

        // This deliberately exposes only two parameterless download lifecycle
        // signals. The native service reads all state from the trusted
        // loopback API and never accepts paths or notification text from JS.
        webView.addJavascriptInterface(new AndroidDownloadBridge(), "AnimeSoulDownloads");
        webView.addJavascriptInterface(new AndroidPlaybackBridge(), "AnimeSoulPlayback");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (LOOPBACK_HOST.equals(host) || "localhost".equals(host)) return false;
                openExternal(uri);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                applyInsetsToWebView();
                resetWebViewViewportScale();
                if (url.startsWith(localBaseUrl())) {
                    splash.animate().alpha(0f).setDuration(180).withEndAction(() -> {
                        root.removeView(splash);
                        splash = null;
                    }).start();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params
            ) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException error) {
                    fileChooserCallback = null;
                    Toast.makeText(MainActivity.this, R.string.file_manager_unavailable, Toast.LENGTH_LONG).show();
                    return false;
                }
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                fullscreenView = view;
                fullscreenCallback = callback;
                requestedOrientationBeforeFullscreen = getRequestedOrientation();
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                webView.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));
                setFullscreenSystemUi(true);
            }

            @Override
            public void onHideCustomView() {
                hideFullscreenPlayer();
            }
        });
    }

    private void configurePlaybackSession() {
        playbackController = new PlaybackSessionController(
                this,
                this::dispatchMediaCommand,
                this::requestDownloadNotificationPermission
        );
    }

    static void receivePlaybackAction(String action) {
        MainActivity activity = activeInstance;
        if (activity == null || action == null) return;
        activity.runOnUiThread(() -> {
            if (activity.playbackController != null) {
                activity.playbackController.handleAction(action);
            }
        });
    }

    private void dispatchMediaCommand(String command, double position) {
        if (webView == null) return;
        String detail = position >= 0
                ? "{command:'" + command + "',position:" + position + "}"
                : "{command:'" + command + "'}";
        webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('animesoul-media-command',{detail:" + detail + "}));",
                null
        );
    }

    private PictureInPictureParams pictureInPictureParams() {
        int width = Math.max(1, playbackVideoWidth);
        int height = Math.max(1, playbackVideoHeight);
        double ratio = (double) width / height;
        if (ratio > 2.35d) width = Math.round(height * 2.35f);
        else if (ratio < .45d) height = Math.round(width / .45f);
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
                .setAspectRatio(new Rational(width, height));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setSeamlessResizeEnabled(true);
        return builder.build();
    }

    private void requestNativePictureInPicture(int width, int height) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || !getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
                || pictureInPictureRequested
                || isInPictureInPictureMode()) {
            return;
        }
        playbackVideoWidth = Math.max(1, width);
        playbackVideoHeight = Math.max(1, height);
        pictureInPictureRequested = true;
        dispatchPictureInPictureChange(true);
        root.postDelayed(() -> {
            try {
                if (!enterPictureInPictureMode(pictureInPictureParams())) {
                    pictureInPictureRequested = false;
                    dispatchPictureInPictureChange(false);
                }
            } catch (IllegalArgumentException | IllegalStateException error) {
                pictureInPictureRequested = false;
                dispatchPictureInPictureChange(false);
            }
        }, 90);
    }

    private void dispatchPictureInPictureChange(boolean active) {
        if (webView == null) return;
        webView.evaluateJavascript(
                "document.documentElement.classList.toggle('animesoul-native-pip'," + active + ");"
                        + "window.dispatchEvent(new CustomEvent('animesoul-pip-change',{detail:{active:"
                        + active + "}}));",
                null
        );
    }

    private void refreshWebViewLayoutAfterPictureInPicture() {
        if (root == null || webView == null) return;
        setFullscreenSystemUi(fullscreenView != null);
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) webView.getLayoutParams();
        params.width = ViewGroup.LayoutParams.MATCH_PARENT;
        params.height = ViewGroup.LayoutParams.MATCH_PARENT;
        webView.setLayoutParams(params);
        root.requestApplyInsets();
        root.requestLayout();
        webView.requestLayout();
        webView.invalidate();
        webView.postDelayed(() -> {
            resetWebViewViewportScale();
            applyInsetsToWebView();
            webView.evaluateJavascript(
                    "void document.documentElement.offsetWidth;"
                            + "window.dispatchEvent(new Event('resize'));"
                            + "window.dispatchEvent(new Event('orientationchange'));",
                    null
            );
        }, 80);
    }

    private void startLocalRuntime() {
        try {
            File frontend = new File(getFilesDir(), "frontend-0.2.5");
            copyAssetTree(getAssets(), "frontend", frontend);

            Python python = Python.getInstance();
            PyObject runtime = python.getModule("mobile_runtime");
            runtime.callAttr(
                    "start",
                    new File(getFilesDir(), "data").getAbsolutePath(),
                    frontend.getAbsolutePath(),
                    BuildConfig.LOCAL_SERVER_PORT,
                    BuildConfig.YUMMY_PUBLIC_TOKEN,
                    BuildConfig.GOOGLE_CLIENT_ID,
                    BuildConfig.GOOGLE_CLIENT_SECRET
            );

            waitForServer();
            if (downloadNetworkMonitor != null) downloadNetworkMonitor.publishCurrentState();
            runOnUiThread(() -> webView.loadUrl(localBaseUrl()));
        } catch (Exception error) {
            runOnUiThread(() -> showStartupError(error));
        }
    }

    private void waitForServer() throws Exception {
        Exception lastError = null;
        for (int attempt = 0; attempt < 120; attempt++) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(localBaseUrl() + "api/health").openConnection();
                connection.setConnectTimeout(400);
                connection.setReadTimeout(400);
                connection.setUseCaches(false);
                if (connection.getResponseCode() == 200) return;
            } catch (Exception error) {
                lastError = error;
            } finally {
                if (connection != null) connection.disconnect();
            }
            Thread.sleep(100);
        }
        throw new IOException("Локальный сервер не запустился", lastError);
    }

    private String localBaseUrl() {
        return "http://" + LOOPBACK_HOST + ":" + BuildConfig.LOCAL_SERVER_PORT + "/";
    }

    private static void copyAssetTree(AssetManager assets, String assetPath, File target) throws IOException {
        String[] children = assets.list(assetPath);
        if (children != null && children.length > 0) {
            if (!target.isDirectory() && !target.mkdirs()) {
                throw new IOException("Не удалось создать " + target);
            }
            for (String child : children) {
                copyAssetTree(assets, assetPath + "/" + child, new File(target, child));
            }
            return;
        }
        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            throw new IOException("Не удалось создать " + parent);
        }
        try (InputStream input = assets.open(assetPath);
             FileOutputStream output = new FileOutputStream(target, false)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
        }
    }

    private void showStartupError(Exception error) {
        if (splash == null) return;
        String detail = error.getMessage() == null
                ? error.getClass().getSimpleName()
                : error.getMessage();
        splash.setText(getString(R.string.startup_error, detail));
        splash.setOnClickListener(view -> {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        });
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, R.string.link_open_failed, Toast.LENGTH_SHORT).show();
        }
    }

    private void hideFullscreenPlayer() {
        if (fullscreenView == null) return;
        root.removeView(fullscreenView);
        fullscreenView = null;
        webView.setVisibility(View.VISIBLE);
        setRequestedOrientation(requestedOrientationBeforeFullscreen);
        requestedOrientationBeforeFullscreen = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        setFullscreenSystemUi(false);
        root.requestApplyInsets();
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || fileChooserCallback == null) return;
        Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        fileChooserCallback.onReceiveValue(result);
        fileChooserCallback = null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        notifyOAuthReturn(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !isInPictureInPictureMode()) {
            pictureInPictureRequested = false;
            dispatchPictureInPictureChange(false);
        }
        notifyOAuthReturn(getIntent());
    }

    @Override
    protected void onPause() {
        boolean keepPlaybackAlive = pictureInPictureRequested
                || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode());
        if (webView != null && !keepPlaybackAlive) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (playbackController != null
                && playbackController.isActive()
                && playbackController.isPlaying()) {
            requestNativePictureInPicture(playbackVideoWidth, playbackVideoHeight);
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(inPictureInPictureMode, newConfig);
        pictureInPictureRequested = inPictureInPictureMode;
        dispatchPictureInPictureChange(inPictureInPictureMode);
        if (!inPictureInPictureMode && webView != null) {
            webView.onResume();
            refreshWebViewLayoutAfterPictureInPicture();
        }
    }

    private void notifyOAuthReturn(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"animesoul".equals(data.getScheme()) || !"oauth-complete".equals(data.getHost())) {
            return;
        }
        if (webView != null) {
            webView.evaluateJavascript(
                    "setTimeout(() => fetch('/api/gdrive/complete-auth', {method:'POST'})"
                            + ".catch(() => null).finally(() => "
                            + "window.dispatchEvent(new Event('animesoul-oauth-return'))), 500)",
                    null
            );
        }
        intent.setData(null);
    }

    private void requestDownloadNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
                || notificationPermissionRequested) {
            return;
        }
        notificationPermissionRequested = true;
        requestPermissions(
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                NOTIFICATION_PERMISSION_REQUEST
        );
    }

    private void requestInitialNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        String preference = "notifications_prompted_v1";
        if (getSharedPreferences("animesoul_mobile", MODE_PRIVATE).getBoolean(preference, false)) return;
        getSharedPreferences("animesoul_mobile", MODE_PRIVATE).edit().putBoolean(preference, true).apply();
        requestDownloadNotificationPermission();
    }

    private void requestOfflineLibraryPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            dispatchOfflineLibraryPermissionChanged();
            return;
        }
        String permission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? Manifest.permission.READ_MEDIA_VIDEO
                : Manifest.permission.READ_EXTERNAL_STORAGE;
        if (checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
            dispatchOfflineLibraryPermissionChanged();
            return;
        }
        requestPermissions(new String[]{permission}, VIDEO_LIBRARY_PERMISSION_REQUEST);
    }

    private void dispatchOfflineLibraryPermissionChanged() {
        if (webView == null) return;
        webView.evaluateJavascript(
                "window.dispatchEvent(new Event('animesoul:media-permission-changed'))",
                null
        );
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == VIDEO_LIBRARY_PERMISSION_REQUEST) {
            dispatchOfflineLibraryPermissionChanged();
        }
    }

    private void configureDownloadNetworkMonitor() {
        downloadNetworkMonitor = new DownloadNetworkMonitor(this, this::localBaseUrl);
        downloadNetworkMonitor.start();
    }


    private final class AndroidDownloadBridge {
        @JavascriptInterface
        public void prepareNotificationPermission() {
            runOnUiThread(MainActivity.this::requestDownloadNotificationPermission);
        }

        @JavascriptInterface
        public void requestOfflineLibraryPermission() {
            runOnUiThread(MainActivity.this::requestOfflineLibraryPermission);
        }

        @JavascriptInterface
        public void startForegroundMonitoring() {
            runOnUiThread(() -> {
                try {
                    DownloadForegroundService.start(getApplicationContext());
                } catch (RuntimeException error) {
                    Toast.makeText(
                            MainActivity.this,
                            R.string.download_background_unavailable,
                            Toast.LENGTH_LONG
                    ).show();
                }
            });
        }

        @JavascriptInterface
        public void notifyMobileDownloadsBlocked() {
            runOnUiThread(() -> {
                Toast.makeText(
                        MainActivity.this,
                        "Скачивание через мобильную сеть отключено в настройках",
                        Toast.LENGTH_LONG
                ).show();
                DownloadForegroundService.showMobileDataBlocked(getApplicationContext());
            });
        }
    }

    private final class AndroidPlaybackBridge {
        @JavascriptInterface
        public void updatePlayback(
                String title,
                String subtitle,
                boolean playing,
                double position,
                double duration,
                boolean active
        ) {
            runOnUiThread(() -> {
                if (playbackController == null) return;
                playbackController.update(
                        title == null || title.trim().isEmpty() ? getString(R.string.app_name) : title,
                        subtitle == null ? "" : subtitle,
                        playing,
                        position,
                        duration,
                        active
                );
            });
        }

        @JavascriptInterface
        public void clearPlayback() {
            runOnUiThread(() -> {
                if (playbackController != null) playbackController.clear();
            });
        }

        @JavascriptInterface
        public void requestPictureInPicture(int width, int height) {
            runOnUiThread(() -> requestNativePictureInPicture(width, height));
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBackNavigation();
    }

    private void handleBackNavigation() {
        if (webView == null || backRequestPending) return;

        backRequestPending = true;
        webView.evaluateJavascript(
                "(function(){try{var event=new Event('animesoul-native-back',{cancelable:true});"
                        + "window.dispatchEvent(event);return event.defaultPrevented;}"
                        + "catch(error){return false;}})();",
                handled -> {
                    backRequestPending = false;
                    if ("true".equals(handled)) return;
                    if (fullscreenView != null) {
                        hideFullscreenPlayer();
                    } else if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        // Keep the local Python runtime and WebView alive. Finishing a
                        // singleTask Activity here could relaunch into a blank WebView.
                        moveTaskToBack(true);
                    }
                }
        );
    }

    @Override
    protected void onDestroy() {
        if (downloadNetworkMonitor != null) {
            downloadNetworkMonitor.close();
            downloadNetworkMonitor = null;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backInvokedCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backInvokedCallback);
            backInvokedCallback = null;
        }
        if (playbackController != null) {
            playbackController.release();
            playbackController = null;
        }
        if (activeInstance == this) activeInstance = null;
        startupExecutor.shutdownNow();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
