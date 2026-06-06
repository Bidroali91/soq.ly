package com.micronet.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.MotionEvent
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var mikrotikBridge: MikroTikBridge

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setNeedInitialFocus(true)
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            webViewClient = WebViewClient()
            setBackgroundColor(0xFF0D1B2A.toInt())
            // Critical for input fields: ensure WebView accepts focus from touches
            isFocusable = true
            isFocusableInTouchMode = true
            requestFocus()
            setOnTouchListener { v, event ->
                if (event.action == MotionEvent.ACTION_DOWN || event.action == MotionEvent.ACTION_UP) {
                    if (!v.hasFocus()) v.requestFocus()
                }
                false
            }
        }

        mikrotikBridge = MikroTikBridge(this, webView)
        webView.addJavascriptInterface(mikrotikBridge, "MikroTik")
        webView.addJavascriptInterface(PrintBridge(this), "Printer")

        setContentView(webView)
        webView.loadUrl("file:///android_asset/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("typeof handleBack==='function' ? handleBack() : false") { result ->
                    if (result != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        })
    }

    override fun onDestroy() {
        mikrotikBridge.dispose()
        webView.removeJavascriptInterface("MikroTik")
        webView.removeJavascriptInterface("Printer")
        webView.destroy()
        super.onDestroy()
    }
}
