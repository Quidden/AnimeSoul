package com.animesoul.mobile;

import android.content.Intent;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.io.File;
import java.io.FileOutputStream;

/** Real-device smoke test. Does not select a TV or use account credentials. */
public class CastSmokeTest {
    private WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView found = findWebView(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    private String evaluate(WebView webView, String code) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> webView.evaluateJavascript(code, value -> {
            result.set(value); done.countDown();
        }));
        assertTrue("WebView did not respond", done.await(8, TimeUnit.SECONDS));
        return result.get();
    }

    @Test public void trustedBridgeAndNativeChooser() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(intent);
        AtomicReference<WebView> ref = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> ref.set(findWebView(activity.findViewById(android.R.id.content))));
        WebView webView = ref.get();
        assertNotNull(webView);
        long deadline = SystemClock.elapsedRealtime() + 45_000;
        while (!"\"object\"".equals(evaluate(webView, "typeof window.AnimeSoulCast")) && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(300);
        assertEquals("\"object\"", evaluate(webView, "typeof window.AnimeSoulCast"));
        evaluate(webView, "window.__castSmoke=null;window.addEventListener('animesoul:cast-state',e=>window.__castSmoke=e.detail);AnimeSoulCast.postMessage(JSON.stringify({action:'state'}));");
        deadline = SystemClock.elapsedRealtime() + 15_000;
        while (!"true".equals(evaluate(webView, "Boolean(window.__castSmoke&&window.__castSmoke.available)")) && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(300);
        assertEquals("Cast SDK unavailable on device", "true", evaluate(webView, "Boolean(window.__castSmoke&&window.__castSmoke.available)"));
        evaluate(webView, "window.__castChild=null;window.addEventListener('message',e=>{if(e.data&&e.data.castSmoke)window.__castChild=e.data.kind;});var child=document.createElement('iframe');child.sandbox='allow-scripts';child.srcdoc=\"<script>parent.postMessage({castSmoke:true,kind:typeof window.AnimeSoulCast},'*')<\\/script>\";document.body.appendChild(child);");
        deadline = SystemClock.elapsedRealtime() + 5_000;
        while (!"\"undefined\"".equals(evaluate(webView, "window.__castChild")) && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
        assertEquals("Cast bridge leaked into an untrusted iframe", "\"undefined\"", evaluate(webView, "window.__castChild"));
        evaluate(webView, "child.remove();");
        evaluate(webView, "AnimeSoulCast.postMessage(JSON.stringify({action:'choose'}));");
        SystemClock.sleep(1500);
        assertEquals("Native chooser failed", "\"\"", evaluate(webView, "window.__castSmoke.error"));
        AtomicReference<Boolean> hasDialog = new AtomicReference<>(false);
        instrumentation.runOnMainSync(() -> hasDialog.set(!activity.getSupportFragmentManager().getFragments().isEmpty()));
        assertTrue("Cast route chooser did not open", hasDialog.get());
        Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
        if (screenshot != null) {
            try (FileOutputStream output = new FileOutputStream(new File(activity.getExternalFilesDir(null), "cast-chooser.png"))) {
                screenshot.compress(Bitmap.CompressFormat.PNG, 100, output);
            }
            screenshot.recycle();
        }
    }
}
