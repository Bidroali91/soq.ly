package com.micronet.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var mikrotikBridge: MikroTikBridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)

        // Native toast — confirms Activity itself works
        Toast.makeText(this, "ميكرو نت 1.0.4 — Activity loaded", Toast.LENGTH_SHORT).show()

        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        webView.webViewClient = WebViewClient()
        webView.setBackgroundColor(0xFF0D1B2A.toInt())

        // CRITICAL FIX for Honor/Huawei/MagicOS WebView touch issue:
        // Force software rendering on the WebView layer
        webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null)

        mikrotikBridge = MikroTikBridge(this, webView)
        webView.addJavascriptInterface(mikrotikBridge, "MikroTik")
        webView.addJavascriptInterface(PrintBridge(this), "Printer")

        // Container with WebView + a native test Button overlay
        val container = FrameLayout(this)

        container.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        val testBtn = Button(this).apply {
            text = "اختبار اللمس الأصلي"
            setBackgroundColor(0xFF22D3EE.toInt())
            setTextColor(0xFF0D1B2A.toInt())
            setOnClickListener {
                Toast.makeText(
                    this@MainActivity,
                    "✓ اللمس الأصلي (Native) يعمل! المشكلة في WebView.",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
        val btnParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP or Gravity.END
        )
        btnParams.topMargin = 32
        btnParams.rightMargin = 16
        container.addView(testBtn, btnParams)

        setContentView(container)
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
