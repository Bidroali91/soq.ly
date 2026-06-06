package com.micronet.app

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import java.util.Base64

/**
 * Bridge exposing MikroTik RouterOS API to JavaScript.
 * Supports:
 *   - v6 API (binary protocol, default port 8728, or 8729 for SSL)
 *   - v7 REST API (HTTP/HTTPS, default port 80/443)
 *
 * JS calls: MikroTik.connect(jsonConn), MikroTik.command(path, paramsJson),
 *           MikroTik.disconnect(), MikroTik.isConnected().
 * All methods return JSON strings: {"ok":true,"data":...} or {"ok":false,"error":"..."}.
 */
class MikroTikBridge(private val ctx: Context, private val webView: WebView) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var client: MikroTikClient? = null

    fun dispose() {
        scope.launch { runCatching { client?.disconnect() } }
        scope.cancel()
    }

    @JavascriptInterface
    fun isConnected(): Boolean = client?.connected == true

    @JavascriptInterface
    fun connect(connJson: String): String = runBlocking {
        try {
            runCatching { client?.disconnect() }
            val cfg = JSONObject(connJson)
            val version = cfg.optString("version", "v7")
            val host = cfg.getString("host")
            val port = cfg.optInt("port", if (version == "v6") 8728 else 443)
            val user = cfg.optString("username", "admin")
            val pass = cfg.optString("password", "")
            val https = cfg.optBoolean("https", port == 443)
            val newClient: MikroTikClient =
                if (version == "v6") ApiClient(host, port, user, pass)
                else RestClient(host, port, user, pass, https)
            withContext(Dispatchers.IO) { newClient.connect() }
            client = newClient
            ok(JSONObject().put("identity", newClient.identity()))
        } catch (e: Throwable) { err(e) }
    }

    /** Execute a RouterOS command. Returns rows as JSON array. */
    @JavascriptInterface
    fun command(path: String, paramsJson: String): String = runBlocking {
        val c = client ?: return@runBlocking err(IllegalStateException("غير متصل"))
        try {
            val params = if (paramsJson.isBlank()) JSONObject() else JSONObject(paramsJson)
            val rows = withContext(Dispatchers.IO) { c.command(path, params) }
            ok(rows)
        } catch (e: Throwable) { err(e) }
    }

    @JavascriptInterface
    fun disconnect(): String = runBlocking {
        try {
            client?.disconnect(); client = null
            ok(JSONObject())
        } catch (e: Throwable) { err(e) }
    }

    private fun ok(data: Any): String =
        JSONObject().put("ok", true).put("data", data).toString()

    private fun err(e: Throwable): String =
        JSONObject().put("ok", false).put("error", e.message ?: e.javaClass.simpleName).toString()
}

/* ===== Generic client interface ===== */
interface MikroTikClient {
    val connected: Boolean
    suspend fun connect()
    suspend fun disconnect()
    suspend fun identity(): String
    /**
     * Execute a path with given parameters.
     * For v7 REST: path "/system/resource" GET-prints, params with key "_method"="POST" etc.
     *   Default method is GET unless params has "_method".
     *   For "add" → _method=PUT, for "remove" → _method=DELETE on /path/{id},
     *   for "set" → _method=PATCH on /path/{id}.
     * For v6 API: path is RouterOS command path like "/ip/hotspot/user/print".
     *   Params: {"name":"x","password":"y"} or {".id":"*123","disabled":"yes"}.
     */
    suspend fun command(path: String, params: JSONObject): JSONArray
}

/* ===================================================================== */
/* v6 binary API client                                                   */
/* ===================================================================== */
class ApiClient(
    private val host: String,
    private val port: Int,
    private val user: String,
    private val pass: String,
) : MikroTikClient {

    private var socket: Socket? = null
    private var input: InputStream? = null
    private var output: OutputStream? = null

    override val connected: Boolean
        get() = socket?.isConnected == true && socket?.isClosed == false

    override suspend fun connect() {
        val s = Socket()
        s.connect(InetSocketAddress(host, port), 8000)
        s.soTimeout = 15000
        socket = s
        input = BufferedInputStream(s.getInputStream())
        output = BufferedOutputStream(s.getOutputStream())
        login()
    }

    private fun login() {
        // RouterOS 6.43+ login: send /login with name & password directly
        val reply = talk(listOf("/login", "=name=$user", "=password=$pass"))
        if (reply.any { it.first == "!trap" })
            throw RuntimeException("اسم المستخدم أو كلمة المرور غير صحيحة")
        // Legacy challenge-response (pre-6.43) — if response contains "ret"
        val re = reply.firstOrNull { it.first == "!done" || it.first == "!re" }
        val challenge = re?.second?.get("ret")
        if (challenge != null) {
            val resp = md5LoginResponse(pass, challenge)
            val legacy = talk(listOf("/login", "=name=$user", "=response=$resp"))
            if (legacy.any { it.first == "!trap" })
                throw RuntimeException("اسم المستخدم أو كلمة المرور غير صحيحة")
        }
    }

    override suspend fun disconnect() {
        runCatching { talk(listOf("/quit")) }
        runCatching { input?.close() }
        runCatching { output?.close() }
        runCatching { socket?.close() }
        socket = null; input = null; output = null
    }

    override suspend fun identity(): String {
        val r = command("/system/identity/print", JSONObject())
        return r.optJSONObject(0)?.optString("name").orEmpty().ifBlank { host }
    }

    override suspend fun command(path: String, params: JSONObject): JSONArray {
        val method = params.optString("_method", "GET").uppercase()
        params.remove("_method")
        val id = params.optString("_id", "")
        params.remove("_id")
        val basePath = path.trimEnd('/')
        val cmd = when {
            basePath.endsWith("/reboot") || basePath.endsWith("/quit") ||
                basePath.endsWith("/login") || basePath.endsWith("/print") -> basePath
            method == "PUT" -> "$basePath/add"
            method == "PATCH" || method == "POST" -> "$basePath/set"
            method == "DELETE" -> "$basePath/remove"
            else -> "$basePath/print"
        }
        val words = mutableListOf(cmd)
        if (id.isNotBlank()) words.add("=.id=$id")
        val it2 = params.keys()
        while (it2.hasNext()) {
            val k = it2.next()
            if (k == ".id" && id.isNotBlank()) continue
            val v = params.opt(k)?.toString() ?: ""
            words.add("=$k=$v")
        }
        val reply = talk(words)
        val result = JSONArray()
        for ((tag, attrs) in reply) {
            if (tag == "!re") {
                val obj = JSONObject()
                for ((k, v) in attrs) obj.put(k, v)
                result.put(obj)
            } else if (tag == "!trap") {
                throw RuntimeException(attrs["message"] ?: "خطأ من الراوتر")
            }
        }
        return result
    }

    /* ---- Binary protocol ---- */
    @Synchronized
    private fun talk(words: List<String>): List<Pair<String, Map<String, String>>> {
        val out = output ?: throw IllegalStateException("غير متصل")
        for (w in words) writeWord(out, w)
        writeWord(out, "")
        out.flush()

        val replies = mutableListOf<Pair<String, Map<String, String>>>()
        var currentTag = ""
        var currentAttrs = mutableMapOf<String, String>()
        while (true) {
            val word = readWord(input!!)
            if (word.isEmpty()) {
                if (currentTag.isNotEmpty()) replies.add(currentTag to currentAttrs)
                currentTag = ""
                currentAttrs = mutableMapOf()
                if (replies.any { it.first == "!done" || it.first == "!fatal" }) break
                continue
            }
            if (word.startsWith("!")) {
                if (currentTag.isNotEmpty()) replies.add(currentTag to currentAttrs)
                currentTag = word
                currentAttrs = mutableMapOf()
            } else if (word.startsWith("=")) {
                val rest = word.substring(1)
                val eq = rest.indexOf('=')
                if (eq > 0) currentAttrs[rest.substring(0, eq)] = rest.substring(eq + 1)
            }
        }
        return replies
    }

    private fun writeWord(out: OutputStream, w: String) {
        val bytes = w.toByteArray(Charsets.ISO_8859_1)
        out.write(encodeLength(bytes.size))
        out.write(bytes)
    }

    private fun encodeLength(n: Int): ByteArray = when {
        n < 0x80 -> byteArrayOf(n.toByte())
        n < 0x4000 -> byteArrayOf(((n shr 8) or 0x80).toByte(), n.toByte())
        n < 0x200000 -> byteArrayOf(((n shr 16) or 0xC0).toByte(), (n shr 8).toByte(), n.toByte())
        n < 0x10000000 -> byteArrayOf(((n shr 24) or 0xE0).toByte(), (n shr 16).toByte(), (n shr 8).toByte(), n.toByte())
        else -> byteArrayOf(0xF0.toByte(), (n shr 24).toByte(), (n shr 16).toByte(), (n shr 8).toByte(), n.toByte())
    }

    private fun readWord(inp: InputStream): String {
        val len = decodeLength(inp)
        if (len == 0) return ""
        val buf = ByteArray(len)
        var read = 0
        while (read < len) {
            val n = inp.read(buf, read, len - read)
            if (n < 0) throw RuntimeException("اتصال مقطوع")
            read += n
        }
        return String(buf, Charsets.ISO_8859_1)
    }

    private fun decodeLength(inp: InputStream): Int {
        val b0 = inp.read()
        if (b0 < 0) throw RuntimeException("اتصال مقطوع")
        return when {
            b0 < 0x80 -> b0
            b0 < 0xC0 -> ((b0 and 0x3F) shl 8) or inp.read()
            b0 < 0xE0 -> ((b0 and 0x1F) shl 16) or (inp.read() shl 8) or inp.read()
            b0 < 0xF0 -> ((b0 and 0x0F) shl 24) or (inp.read() shl 16) or (inp.read() shl 8) or inp.read()
            else -> (inp.read() shl 24) or (inp.read() shl 16) or (inp.read() shl 8) or inp.read()
        }
    }

    private fun md5LoginResponse(password: String, challenge: String): String {
        val chBytes = ByteArray(challenge.length / 2)
        for (i in chBytes.indices) chBytes[i] = challenge.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        val md = MessageDigest.getInstance("MD5")
        md.update(0)
        md.update(password.toByteArray(Charsets.ISO_8859_1))
        md.update(chBytes)
        return "00" + md.digest().joinToString("") { "%02x".format(it) }
    }
}

/* ===================================================================== */
/* v7 REST API client                                                     */
/* ===================================================================== */
class RestClient(
    private val host: String,
    private val port: Int,
    private val user: String,
    private val pass: String,
    private val useHttps: Boolean,
) : MikroTikClient {

    @Volatile private var ok = false
    override val connected: Boolean get() = ok

    private val baseUrl: String
        get() = "${if (useHttps) "https" else "http"}://$host:$port/rest"

    override suspend fun connect() {
        // Validate by hitting /system/identity
        val res = http("/system/identity", "GET", null)
        ok = res != null
        if (!ok) throw RuntimeException("تعذّر الاتصال")
    }

    override suspend fun disconnect() { ok = false }

    override suspend fun identity(): String {
        val res = http("/system/identity", "GET", null)
        return res?.let { JSONObject(it).optString("name") }.orEmpty().ifBlank { host }
    }

    override suspend fun command(path: String, params: JSONObject): JSONArray {
        val method = params.optString("_method", "GET").uppercase()
        params.remove("_method")
        val id = params.optString("_id", "")
        params.remove("_id")
        val effective = if (id.isNotBlank()) "$path/$id" else path
        val body = if (method == "GET" || method == "DELETE") null else params.toString()
        val res = http(effective, method, body) ?: return JSONArray()
        val trimmed = res.trim()
        return when {
            trimmed.startsWith("[") -> JSONArray(trimmed)
            trimmed.startsWith("{") -> JSONArray().put(JSONObject(trimmed))
            else -> JSONArray()
        }
    }

    private fun http(path: String, method: String, body: String?): String? {
        val url = URL(baseUrl + path)
        val conn = (url.openConnection() as HttpURLConnection).apply {
            if (this is HttpsURLConnection) {
                val sc = SSLContext.getInstance("TLS")
                sc.init(null, arrayOf(object : X509TrustManager {
                    override fun checkClientTrusted(chain: Array<X509Certificate>?, authType: String?) {}
                    override fun checkServerTrusted(chain: Array<X509Certificate>?, authType: String?) {}
                    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
                }), SecureRandom())
                sslSocketFactory = sc.socketFactory
                setHostnameVerifier { _, _ -> true }
            }
            requestMethod = if (method == "PATCH") "POST" else method
            if (method == "PATCH") setRequestProperty("X-HTTP-Method-Override", "PATCH")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Authorization",
                "Basic " + Base64.getEncoder().encodeToString("$user:$pass".toByteArray()))
            connectTimeout = 10000
            readTimeout = 20000
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                outputStream.use { it.write(body.toByteArray()) }
            }
        }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
        if (code !in 200..299) {
            val msg = runCatching { JSONObject(text).optString("message") }.getOrNull()
                ?: runCatching { JSONObject(text).optString("detail") }.getOrNull()
                ?: text.ifBlank { "HTTP $code" }
            throw RuntimeException(msg)
        }
        return text
    }
}
