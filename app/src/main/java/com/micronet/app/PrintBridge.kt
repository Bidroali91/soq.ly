package com.micronet.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.JavascriptInterface
import android.webkit.WebView

/** Bridge for printing voucher HTML via Android print framework. */
class PrintBridge(private val ctx: Context) {

    @JavascriptInterface
    fun printHtml(html: String, jobName: String) {
        Handler(Looper.getMainLooper()).post {
            val printWebView = WebView(ctx).apply {
                settings.javaScriptEnabled = false
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
            }
            printWebView.webViewClient = object : android.webkit.WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    val pm = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
                    val adapter = printWebView.createPrintDocumentAdapter(jobName)
                    pm.print(jobName, adapter, PrintAttributes.Builder().build())
                }
            }
            printWebView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
        }
    }
}
