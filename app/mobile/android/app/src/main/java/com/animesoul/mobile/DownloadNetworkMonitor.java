package com.animesoul.mobile;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Publishes Android connectivity changes to the embedded download service. */
final class DownloadNetworkMonitor {
    interface BaseUrlProvider {
        String getBaseUrl();
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ConnectivityManager connectivityManager;
    private final BaseUrlProvider baseUrlProvider;
    private ConnectivityManager.NetworkCallback callback;

    DownloadNetworkMonitor(Context context, BaseUrlProvider baseUrlProvider) {
        connectivityManager = (ConnectivityManager) context.getSystemService(
                Context.CONNECTIVITY_SERVICE);
        this.baseUrlProvider = baseUrlProvider;
    }

    void start() {
        if (connectivityManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;
        callback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                publishCurrentState();
            }

            @Override
            public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
                publishCurrentState();
            }

            @Override
            public void onLost(Network network) {
                publishCurrentState();
            }
        };
        connectivityManager.registerDefaultNetworkCallback(callback);
    }

    void close() {
        if (connectivityManager != null && callback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(callback);
            } catch (IllegalArgumentException ignored) {
                // Already unregistered by Android.
            }
            callback = null;
        }
        executor.shutdownNow();
    }

    private String currentNetworkType() {
        if (connectivityManager == null) return "unknown";
        Network network = connectivityManager.getActiveNetwork();
        if (network == null) return "none";
        NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
        if (capabilities == null) return "unknown";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "mobile";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return "vpn";
        return "unknown";
    }

    void publishCurrentState() {
        String networkType = currentNetworkType();
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(baseUrlProvider.getBaseUrl() + "api/downloads/network");
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(800);
                connection.setReadTimeout(1_000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] body = ("{\"type\":\"" + networkType + "\"}")
                        .getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                }
                connection.getResponseCode();
            } catch (Exception ignored) {
                // The first callback may arrive before the embedded server.
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }
}
