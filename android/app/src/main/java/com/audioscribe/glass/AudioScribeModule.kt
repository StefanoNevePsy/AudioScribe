package com.audioscribe.glass

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream

/**
 * Funzioni native di supporto:
 *  - readAsBase64: legge l'audio condiviso (content://) per le API che lo
 *    vogliono inline nel JSON, come Gemini.
 *  - findLatestVoiceNote: trova l'ultimo vocale WhatsApp sul dispositivo,
 *    per trascriverlo senza passare dal menu di condivisione.
 *  - consumeLaunchAction: dice al JS se l'app e stata aperta dalla
 *    scorciatoia "Trascrivi ultimo vocale".
 */
@ReactModule(name = AudioScribeModule.NAME)
class AudioScribeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  // ------------------------------------------------------------------
  //  Lettura audio in base64 (ContentResolver: unico modo affidabile per
  //  un content:// di WhatsApp, che sta fuori dalla sandbox dell'app)
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  //  Permesso "accesso a tutti i file"
  //  Serve perche la cartella dei vocali contiene .nomedia e quindi non e
  //  indicizzata da MediaStore: va letta direttamente dal filesystem.
  // ------------------------------------------------------------------
  @ReactMethod
  fun hasAllFilesAccess(promise: Promise) {
    promise.resolve(
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Environment.isExternalStorageManager()
      } else {
        true
      },
    )
  }

  @ReactMethod
  fun requestAllFilesAccess(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val intent = Intent(
          Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
          Uri.parse("package:${reactApplicationContext.packageName}"),
        ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        reactApplicationContext.startActivity(intent)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_PERM", e.message ?: "Impossibile aprire le impostazioni.", e)
    }
  }

  // ------------------------------------------------------------------
  //  Ultimo vocale WhatsApp
  // ------------------------------------------------------------------
  @ReactMethod
  fun findLatestVoiceNote(promise: Promise) {
    try {
      val root = Environment.getExternalStorageDirectory()
      val folders = listOf(
        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Voice Notes",
        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Voice Notes",
        // Percorsi legacy (Android 10 e precedenti)
        "WhatsApp/Media/WhatsApp Voice Notes",
        "WhatsApp Business/Media/WhatsApp Business Voice Notes",
      )

      var newestPath: String? = null
      var newestTime = Long.MIN_VALUE

      for (relative in folders) {
        val dir = File(root, relative)
        if (!dir.isDirectory) continue
        dir.walkTopDown().forEach { f ->
          if (f.isFile && AUDIO_EXT.contains(f.extension.lowercase())) {
            val modified = f.lastModified()
            if (modified > newestTime) {
              newestTime = modified
              newestPath = f.absolutePath
            }
          }
        }
      }

      val path = newestPath
      if (path == null) {
        promise.resolve(null)
        return
      }

      val file = File(path)
      val result = Arguments.createMap().apply {
        putString("uri", "file://$path")
        putString("name", file.name)
        putString("mimeType", mimeForExtension(file.extension.lowercase()))
        putDouble("modified", newestTime.toDouble())
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("E_SCAN", e.message ?: "Errore durante la ricerca dei vocali.", e)
    }
  }

  // ------------------------------------------------------------------
  //  Scorciatoia dalla home / riquadro: quale azione ha aperto l'app?
  // ------------------------------------------------------------------
  @ReactMethod
  fun consumeLaunchAction(promise: Promise) {
    val intent = reactApplicationContext.currentActivity?.intent
    val action = intent?.action
    if (intent != null && action == ACTION_TRANSCRIBE_LATEST) {
      // Consuma l'azione, cosi non si ripete al prossimo ritorno in foreground.
      intent.setAction(Intent.ACTION_MAIN)
    }
    promise.resolve(action)
  }

  private fun mimeForExtension(ext: String): String = when (ext) {
    "opus", "ogg" -> "audio/ogg"
    "m4a", "aac", "3gp" -> "audio/aac"
    "mp3" -> "audio/mp3"
    "wav" -> "audio/wav"
    "flac" -> "audio/flac"
    "aiff" -> "audio/aiff"
    else -> "audio/ogg"
  }

  companion object {
    const val NAME = "AudioScribeNative"
    const val ACTION_TRANSCRIBE_LATEST = "com.audioscribe.glass.TRANSCRIBE_LATEST"

    // Gemini accetta richieste fino a 20 MB totali; il base64 pesa ~33% in
    // piu dei byte originali, quindi teniamo un margine di sicurezza.
    private const val MAX_BYTES = 14L * 1024 * 1024

    private val AUDIO_EXT =
      setOf("opus", "ogg", "m4a", "mp3", "aac", "wav", "flac", "aiff", "3gp", "amr")
  }
}
