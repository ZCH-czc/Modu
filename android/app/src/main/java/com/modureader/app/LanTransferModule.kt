package com.modureader.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

private const val MAX_UPLOAD_BYTES = 25L * 1024L * 1024L
private const val MAX_PENDING_FILES = 8

data class PendingTransfer(
  val id: String,
  val file: File,
  val name: String,
  val size: Long,
  @Volatile var status: String = "pending",
)

class LanTransferModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val clients = Executors.newCachedThreadPool()
  private val acceptor = Executors.newSingleThreadExecutor()
  private val transfers = ConcurrentHashMap<String, PendingTransfer>()
  @Volatile private var running = false
  @Volatile private var serverSocket: ServerSocket? = null

  override fun getName() = "LanTransfer"

  @ReactMethod
  fun startServer(portValue: Double, promise: Promise) {
    val port = portValue.toInt().coerceIn(1024, 65535)
    stopInternal(false)
    acceptor.execute {
      try {
        val socket = ServerSocket()
        socket.reuseAddress = true
        socket.bind(InetSocketAddress("0.0.0.0", port))
        serverSocket = socket
        running = true
        val ip = localIpAddress()
        val result = Arguments.createMap().apply {
          putString("ip", ip)
          putInt("port", port)
          putString("url", "http://$ip:$port")
        }
        promise.resolve(result)
        while (running) {
          try {
            val client = socket.accept()
            client.soTimeout = 30_000
            clients.execute { handleClient(client) }
          } catch (_: Exception) {
            if (running) continue else break
          }
        }
      } catch (error: Exception) {
        running = false
        promise.reject("LAN_SERVER_START_FAILED", error.message, error)
      }
    }
  }

  @ReactMethod
  fun stopServer(promise: Promise) {
    stopInternal(true)
    promise.resolve(null)
  }

  @ReactMethod
  fun resolveTransfer(id: String, accepted: Boolean, promise: Promise) {
    val transfer = transfers[id]
    if (transfer == null) {
      promise.reject("TRANSFER_NOT_FOUND", "Transfer no longer exists")
      return
    }
    transfer.status = if (accepted) "accepted" else "rejected"
    if (transfer.file.exists()) transfer.file.delete()
    promise.resolve(null)
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  override fun invalidate() {
    stopInternal(true)
    clients.shutdownNow()
    acceptor.shutdownNow()
    super.invalidate()
  }

  private fun stopInternal(clearPending: Boolean) {
    running = false
    try { serverSocket?.close() } catch (_: Exception) {}
    serverSocket = null
    if (clearPending) {
      transfers.values.forEach { transfer ->
        if (transfer.status == "pending") transfer.status = "rejected"
        if (transfer.file.exists()) transfer.file.delete()
      }
      transfers.clear()
    }
  }

  private fun handleClient(socket: Socket) {
    socket.use { client ->
      val input = BufferedInputStream(client.getInputStream())
      val output = BufferedOutputStream(client.getOutputStream())
      try {
        val requestLine = readLine(input) ?: return
        val parts = requestLine.split(" ")
        if (parts.size < 2) return respond(output, 400, "text/plain; charset=utf-8", "Bad request")
        val method = parts[0].uppercase()
        val target = parts[1]
        val headers = mutableMapOf<String, String>()
        while (true) {
          val line = readLine(input) ?: break
          if (line.isEmpty()) break
          val colon = line.indexOf(':')
          if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
        }

        when {
          method == "GET" && (target == "/" || target.startsWith("/?")) -> {
            val html = context.assets.open("lan-transfer.html").bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
            respond(output, 200, "text/html; charset=utf-8", html)
          }
          method == "GET" && target.startsWith("/status") -> handleStatus(output, target)
          method == "GET" && target == "/health" -> respondJson(output, 200, "{\"ok\":true}")
          method == "POST" && target == "/upload" -> handleUpload(input, output, headers)
          method == "OPTIONS" -> respond(output, 204, "text/plain", "")
          else -> respond(output, 404, "text/plain; charset=utf-8", "Not found")
        }
      } catch (error: Exception) {
        try { respondJson(output, 500, "{\"error\":\"${json(error.message ?: "Upload failed")}\"}") } catch (_: Exception) {}
      }
    }
  }

  private fun handleUpload(
    input: BufferedInputStream,
    output: BufferedOutputStream,
    headers: Map<String, String>,
  ) {
    if (transfers.values.count { it.status == "pending" } >= MAX_PENDING_FILES) {
      respondJson(output, 429, "{\"error\":\"待确认文件过多，请先在设备上处理\"}")
      return
    }
    val length = headers["content-length"]?.toLongOrNull()
    if (length == null || length <= 0) {
      respondJson(output, 411, "{\"error\":\"浏览器未提供文件大小\"}")
      return
    }
    if (length > MAX_UPLOAD_BYTES) {
      respondJson(output, 413, "{\"error\":\"文件超过 25 MB\"}")
      return
    }
    val encodedName = headers["x-file-name"] ?: "received.txt"
    val decodedName = try { URLDecoder.decode(encodedName, "UTF-8") } catch (_: Exception) { encodedName }
    val safeName = decodedName.replace(Regex("[\\/\\r\\n\\t]"), "_").trim().take(120)
    val extension = safeName.substringAfterLast('.', "").lowercase()
    if (extension !in setOf("epub", "txt", "pdf")) {
      respondJson(output, 415, "{\"error\":\"仅支持 EPUB、TXT 和 PDF\"}")
      return
    }

    val directory = File(context.cacheDir, "lan-transfer").apply { mkdirs() }
    val id = UUID.randomUUID().toString()
    val temp = File(directory, "$id.$extension")
    var remaining = length
    FileOutputStream(temp).buffered().use { fileOutput ->
      val buffer = ByteArray(64 * 1024)
      while (remaining > 0) {
        val count = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
        if (count < 0) throw IllegalStateException("Upload ended early")
        fileOutput.write(buffer, 0, count)
        remaining -= count
      }
    }

    val transfer = PendingTransfer(id, temp, safeName, length)
    transfers[id] = transfer
    emitTransfer(transfer)
    respondJson(output, 202, "{\"id\":\"$id\",\"status\":\"pending\"}")
  }

  private fun handleStatus(output: BufferedOutputStream, target: String) {
    val id = target.substringAfter("id=", "").substringBefore('&')
    val transfer = transfers[id]
    if (transfer == null) {
      respondJson(output, 404, "{\"status\":\"missing\"}")
      return
    }
    respondJson(output, 200, "{\"status\":\"${transfer.status}\"}")
  }

  private fun emitTransfer(transfer: PendingTransfer) {
    val payload = Arguments.createMap().apply {
      putString("id", transfer.id)
      putString("name", transfer.name)
      putDouble("size", transfer.size.toDouble())
      putString("path", transfer.file.absolutePath)
    }
    context.runOnUiQueueThread {
      if (context.hasActiveReactInstance()) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("lanTransferRequest", payload)
      }
    }
  }

  private fun readLine(input: BufferedInputStream): String? {
    val bytes = ArrayList<Byte>(128)
    while (bytes.size < 8192) {
      val value = input.read()
      if (value < 0) return if (bytes.isEmpty()) null else bytes.toByteArray().toString(StandardCharsets.UTF_8)
      if (value == 10) break
      if (value != 13) bytes.add(value.toByte())
    }
    return bytes.toByteArray().toString(StandardCharsets.UTF_8)
  }

  private fun respondJson(output: BufferedOutputStream, status: Int, body: String) =
    respond(output, status, "application/json; charset=utf-8", body)

  private fun respond(output: BufferedOutputStream, status: Int, contentType: String, body: String) {
    val bytes = body.toByteArray(StandardCharsets.UTF_8)
    val label = when (status) {
      200 -> "OK"; 202 -> "Accepted"; 204 -> "No Content"; 400 -> "Bad Request"
      404 -> "Not Found"; 411 -> "Length Required"; 413 -> "Payload Too Large"
      415 -> "Unsupported Media Type"; 429 -> "Too Many Requests"; else -> "Server Error"
    }
    val header = "HTTP/1.1 $status $label\r\nContent-Type: $contentType\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n"
    output.write(header.toByteArray(StandardCharsets.US_ASCII))
    output.write(bytes)
    output.flush()
  }

  private fun localIpAddress(): String {
    try {
      val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val active = connectivity.activeNetwork
      val capabilities = active?.let(connectivity::getNetworkCapabilities)
      if (active != null && capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true) {
        val wifiAddress = connectivity.getLinkProperties(active)?.linkAddresses
          ?.map { it.address }
          ?.filterIsInstance<Inet4Address>()
          ?.firstOrNull { !it.isLoopbackAddress }
          ?.hostAddress
        if (!wifiAddress.isNullOrBlank()) return wifiAddress
      }

      val interfaces = NetworkInterface.getNetworkInterfaces().toList()
      val wifiAddress = interfaces
        .filter { it.isUp && (it.name.startsWith("wlan") || it.name.startsWith("wifi")) }
        .flatMap { it.inetAddresses.toList() }
        .filterIsInstance<Inet4Address>()
        .firstOrNull { !it.isLoopbackAddress }
        ?.hostAddress
      if (!wifiAddress.isNullOrBlank()) return wifiAddress

      return interfaces
        .filter { it.isUp }
        .flatMap { it.inetAddresses.toList() }
        .filterIsInstance<Inet4Address>()
        .firstOrNull { !it.isLoopbackAddress && it.isSiteLocalAddress }
        ?.hostAddress ?: "0.0.0.0"
    } catch (_: Exception) {
      return "0.0.0.0"
    }
  }

  private fun json(value: String) = value
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")
    .replace("\r", " ")
    .replace("\n", " ")
}