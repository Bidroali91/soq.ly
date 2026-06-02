package com.sasaida.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import android.widget.Toast

class AndroidBridge(private val context: Context) {

    @JavascriptInterface
    fun openWhatsApp(phone: String, message: String) {
        val normalized = normalizePhone(phone)
        val url = "https://wa.me/$normalized?text=" + Uri.encode(message)
        startView(url)
    }

    @JavascriptInterface
    fun openSms(phone: String, message: String) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("smsto:$phone"))
            intent.putExtra("sms_body", message)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            toast("لا يوجد تطبيق رسائل")
        }
    }

    @JavascriptInterface
    fun openDialer(phone: String) {
        try {
            val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            toast("لا يوجد تطبيق اتصال")
        }
    }

    @JavascriptInterface
    fun shareText(text: String) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        context.startActivity(Intent.createChooser(intent, "مشاركة").apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK })
    }

    @JavascriptInterface
    fun toast(message: String) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }

    private fun startView(url: String) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            toast("لا يمكن فتح الرابط")
        }
    }

    private fun normalizePhone(phone: String): String {
        val digits = phone.filter { it.isDigit() }
        return when {
            digits.startsWith("00") -> digits.drop(2)
            digits.startsWith("0") -> "218" + digits.drop(1)
            else -> digits
        }
    }
}
