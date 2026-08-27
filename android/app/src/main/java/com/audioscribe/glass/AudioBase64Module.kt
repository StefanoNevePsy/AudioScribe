package com.audioscribe.glass

import android.net.Uri
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream

/**
 * Legge un file audio condiviso (content:// o file://) e lo restituisce in
 * base64. Serve alle API che vogliono l'audio inline nel JSON (Gemini),
 * a differenza di Groq che accetta un upload multipart.
 *
 * Usa ContentResolver: e l'unico modo affidabile di leggere un content://
 * ricevuto da WhatsApp, che punta a un file fuori dalla sandbox dell'app.
 */
@ReactModule(name = AudioBase64Module.NAME)
class AudioBase64Module(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  @ReactMethod
  fun readAsBase64(uriString: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      val stream = when (uri.scheme) {
        "content" -> reactApplicationContext.contentResolver.openInputStream(uri)
        "file" -> FileInputStream(File(uri.path ?: ""))
        else -> FileInputStream(File(uriString))
      }

      if (stream == null) {
        promise.reject("E_OPEN", "Impossibile aprire il file audio condiviso.")
        return
      }

      stream.use { input ->
        val output = ByteArrayOutputStream()
        val chunk = ByteArray(8192)
        var total = 0L
        while (true) {
          val read = input.read(chunk)
          if (read == -1) break
          total += read
          if (total > MAX_BYTES) {
            promise.reject("E_TOO_LARGE", "Audio troppo grande (limite ${MAX_BYTES / 1024 / 1024} MB).")
            return
          }
          output.write(chunk, 0, read)
        }
        promise.resolve(Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP))
      }
    } catch (e: Exception) {
      promise.reject("E_READ", e.message ?: "Errore di lettura del file audio.", e)
    }
  }

  companion object {
    const val NAME = "AudioBase64"

    // Gemini accetta richieste fino a 20 MB totali; il base64 pesa ~33% in
    // piu dei byte originali, quindi teniamo un margine di sicurezza.
    private const val MAX_BYTES = 14L * 1024 * 1024
  }
}
