package com.audioscribe.glass

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.io.FileInputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.IntBuffer
import java.nio.LongBuffer
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Trascrizione locale con Parakeet Ultra (moondream, export ONNX di Olicorne).
 *
 * Replica la pipeline di onnx-asr, validata parola per parola in Python:
 *   audio -> PCM mono -> resample a 16 kHz -> nemo128 (log-mel) -> encoder
 *   -> decodifica greedy TDT con decoder_joint.
 *
 * L'audio viene diviso in blocchi da ~55 s tagliati nel punto piu silenzioso:
 * l'attenzione dell'encoder cresce col quadrato della durata (3 minuti in un
 * colpo solo superano i 3,5 GB di RAM).
 */
@ReactModule(name = LocalAsrModule.NAME)
class LocalAsrModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  private val worker = Executors.newSingleThreadExecutor()
  private val downloadCancelled = AtomicBoolean(false)
  private val env: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }

  private var resamplers = HashMap<Int, OrtSession>()
  private var preprocessor: OrtSession? = null
  private var encoder: OrtSession? = null
  private var decoder: OrtSession? = null
  private var vocab: Array<String> = emptyArray()
  private var blankId = -1

  private val modelDir: File
    get() = File(reactApplicationContext.filesDir, "models/$MODEL_ID")

  // ------------------------------------------------------------------
  //  Stato e gestione del modello
  // ------------------------------------------------------------------
  @ReactMethod
  fun getModelStatus(promise: Promise) {
    val installed = FILES.all { File(modelDir, it.name).length() == it.size }
    val partial = FILES.sumOf { f ->
      maxOf(File(modelDir, f.name).length(), File(modelDir, f.name + ".part").length())
    }
    promise.resolve(
      Arguments.createMap().apply {
        putBoolean("installed", installed)
        putDouble("downloadedBytes", partial.toDouble())
        putDouble("totalBytes", TOTAL_BYTES.toDouble())
        putString("modelName", "Parakeet Ultra · int8")
      },
    )
  }

  @ReactMethod
  fun downloadModel(promise: Promise) {
    downloadCancelled.set(false)
    worker.execute {
      try {
        modelDir.mkdirs()
        var doneBefore = 0L
        for (f in FILES) {
          val target = File(modelDir, f.name)
          if (target.length() != f.size) {
            downloadFile(f, target, doneBefore)
          }
          doneBefore += f.size
        }
        emitDownload(TOTAL_BYTES, TOTAL_BYTES, "Completato")
        promise.resolve(true)
      } catch (e: CancelledException) {
        promise.reject("E_CANCELLED", "Download annullato.")
      } catch (e: Exception) {
        promise.reject("E_DOWNLOAD", e.message ?: "Download non riuscito.", e)
      }
    }
  }

  @ReactMethod
  fun cancelDownload(promise: Promise) {
    downloadCancelled.set(true)
    promise.resolve(true)
  }

  @ReactMethod
  fun deleteModel(promise: Promise) {
    worker.execute {
      releaseSessions()
      modelDir.deleteRecursively()
      promise.resolve(true)
    }
  }

  // Richiesti da NativeEventEmitter lato JS.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}

  /** Scarica in un file .part con ripresa (Range) e verifica lo SHA-256. */
  private fun downloadFile(f: ModelFile, target: File, doneBefore: Long) {
    val part = File(target.path + ".part")
    var offset = if (part.exists()) part.length() else 0L
    if (offset > f.size) { part.delete(); offset = 0L }

    if (offset < f.size) {
      val conn = (URL("$BASE_URL/${f.remotePath}").openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = true
        connectTimeout = 20_000
        readTimeout = 60_000
        if (offset > 0) setRequestProperty("Range", "bytes=$offset-")
      }
      try {
        val code = conn.responseCode
        if (code == 200 && offset > 0) {
          // Il server ha ignorato il Range: si riparte da zero.
          offset = 0L
          part.delete()
        } else if (code != 200 && code != 206) {
          throw IllegalStateException("Errore HTTP $code durante il download di ${f.name}.")
        }

        RandomAccessFile(part, "rw").use { out ->
          out.seek(offset)
          conn.inputStream.use { input ->
            val buf = ByteArray(256 * 1024)
            var written = offset
            var lastEmit = 0L
            while (true) {
              if (downloadCancelled.get()) throw CancelledException()
              val n = input.read(buf)
              if (n == -1) break
              out.write(buf, 0, n)
              written += n
              if (written - lastEmit > 2_000_000) {
                lastEmit = written
                emitDownload(doneBefore + written, TOTAL_BYTES, f.label)
              }
            }
          }
        }
      } finally {
        conn.disconnect()
      }
    }

    if (part.length() != f.size) {
      throw IllegalStateException("Download incompleto di ${f.name}. Riprova: ripartira da dove si e fermato.")
    }
    emitDownload(doneBefore + f.size, TOTAL_BYTES, "Verifica integrita…")
    val actual = sha256(part)
    if (!actual.equals(f.sha256, ignoreCase = true)) {
      part.delete()
      throw IllegalStateException("File ${f.name} corrotto (checksum non valido). Riprova il download.")
    }
    if (!part.renameTo(target)) throw IllegalStateException("Impossibile salvare ${f.name}.")
  }

  private fun sha256(file: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buf = ByteArray(1 shl 20)
      while (true) {
        val n = input.read(buf)
        if (n == -1) break
        md.update(buf, 0, n)
      }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
  }

  private fun emitDownload(received: Long, total: Long, label: String) {
    reactApplicationContext.emitDeviceEvent(
      EVENT_DOWNLOAD,
      Arguments.createMap().apply {
        putDouble("received", received.toDouble())
        putDouble("total", total.toDouble())
        putString("label", label)
      },
    )
  }

  private fun emitProgress(message: String) {
    reactApplicationContext.emitDeviceEvent(
      EVENT_PROGRESS,
      Arguments.createMap().apply { putString("message", message) },
    )
  }

  // ------------------------------------------------------------------
  //  Trascrizione
  // ------------------------------------------------------------------
  @ReactMethod
  fun transcribe(uriString: String, promise: Promise) {
    worker.execute {
      try {
        if (!FILES.all { File(modelDir, it.name).length() == it.size }) {
          promise.reject("E_NO_MODEL", "Il modello locale non e scaricato. Scaricalo dalle Impostazioni.")
          return@execute
        }
        emitProgress("Caricamento del modello…")
        loadSessions()

        emitProgress("Decodifica audio…")
        val (pcm, rate) = decodeAudio(Uri.parse(uriString))
        if (pcm.isEmpty()) throw IllegalStateException("Il file audio e vuoto o non leggibile.")
        val wave = resampleTo16k(pcm, rate)

        val chunks = splitOnSilence(wave)
        val parts = ArrayList<String>()
        chunks.forEachIndexed { i, (start, end) ->
          emitProgress(
            if (chunks.size == 1) "Trascrizione sul dispositivo…"
            else "Trascrizione sul dispositivo · parte ${i + 1} di ${chunks.size}",
          )
          val text = recognize(wave.copyOfRange(start, end)).trim()
          if (text.isNotEmpty()) parts.add(text)
        }
        promise.resolve(parts.joinToString(" "))
      } catch (e: OutOfMemoryError) {
        releaseSessions()
        promise.reject("E_OOM", "Memoria insufficiente per la trascrizione locale.")
      } catch (e: Exception) {
        promise.reject("E_LOCAL_ASR", e.message ?: "Errore nella trascrizione locale.", e)
      }
    }
  }

  @Synchronized
  private fun loadSessions() {
    if (encoder != null) return
    val opts = OrtSession.SessionOptions().apply {
      setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      // Exynos 2200: 1 core X2 + 3 A710 + 4 A510. Usiamo i 4 core veloci.
      setIntraOpNumThreads(4)
    }
    preprocessor = env.createSession(readAsset("asr/nemo128.onnx"), opts)
    encoder = env.createSession(File(modelDir, "encoder-model.int8.onnx").path, opts)
    decoder = env.createSession(File(modelDir, "decoder_joint-model.int8.onnx").path, opts)

    val lines = File(modelDir, "vocab.txt").readLines(Charsets.UTF_8).filter { it.isNotEmpty() }
    val table = arrayOfNulls<String>(lines.size)
    for (line in lines) {
      val sep = line.lastIndexOf(' ')
      val id = line.substring(sep + 1).toInt()
      table[id] = line.substring(0, sep).replace('▁', ' ')
    }
    vocab = Array(table.size) { table[it] ?: "" }
    blankId = vocab.indexOf("<blk>")
  }

  @Synchronized
  private fun releaseSessions() {
    listOfNotNull(preprocessor, encoder, decoder).forEach { it.close() }
    resamplers.values.forEach { it.close() }
    resamplers = HashMap()
    preprocessor = null
    encoder = null
    decoder = null
  }

  private fun readAsset(path: String): ByteArray =
    reactApplicationContext.assets.open(path).use { it.readBytes() }

  /** Decodifica qualsiasi formato supportato da Android in PCM float mono. */
  private fun decodeAudio(uri: Uri): Pair<FloatArray, Int> {
    val extractor = MediaExtractor()
    extractor.setDataSource(reactApplicationContext, uri, null)
    val track = (0 until extractor.trackCount).firstOrNull {
      extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
    } ?: throw IllegalStateException("Nessuna traccia audio nel file.")
    extractor.selectTrack(track)
    val inFormat = extractor.getTrackFormat(track)
    var rate = inFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var channels = inFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

    val codec = MediaCodec.createDecoderByType(inFormat.getString(MediaFormat.KEY_MIME)!!)
    codec.configure(inFormat, null, null, 0)
    codec.start()

    var out = FloatArray(rate * 60)
    var count = 0
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    var floatPcm = false
    try {
      while (!outputDone) {
        if (!inputDone) {
          val inIdx = codec.dequeueInputBuffer(10_000)
          if (inIdx >= 0) {
            val buf = codec.getInputBuffer(inIdx)!!
            val size = extractor.readSampleData(buf, 0)
            if (size < 0) {
              codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(inIdx, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }

        val outIdx = codec.dequeueOutputBuffer(info, 10_000)
        when {
          outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val f = codec.outputFormat
            rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            if (f.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
              floatPcm = f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
            }
          }
          outIdx >= 0 -> {
            val buf = codec.getOutputBuffer(outIdx)!!.order(ByteOrder.nativeOrder())
            buf.position(info.offset)
            buf.limit(info.offset + info.size)
            // Downmix a mono. I decoder Android escono di norma a 16 bit,
            // ma alcuni possono restituire PCM float.
            if (floatPcm) {
              val samples = buf.asFloatBuffer()
              val frames = samples.remaining() / channels
              if (count + frames > out.size) out = out.copyOf(maxOf(out.size * 2, count + frames))
              for (i in 0 until frames) {
                var acc = 0f
                for (c in 0 until channels) acc += samples.get(i * channels + c)
                out[count++] = acc / channels
              }
            } else {
              val samples = buf.asShortBuffer()
              val frames = samples.remaining() / channels
              if (count + frames > out.size) out = out.copyOf(maxOf(out.size * 2, count + frames))
              for (i in 0 until frames) {
                var acc = 0f
                for (c in 0 until channels) acc += samples.get(i * channels + c)
                out[count++] = acc / (channels * 32768f)
              }
            }
            codec.releaseOutputBuffer(outIdx, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
          }
        }
      }
    } finally {
      codec.stop()
      codec.release()
      extractor.release()
    }
    return out.copyOf(count) to rate
  }

  private fun resampleTo16k(pcm: FloatArray, rate: Int): FloatArray {
    if (rate == 16_000) return pcm
    val asset = RESAMPLERS[rate]
    if (asset == null) {
      // Frequenza insolita: interpolazione lineare (raro con i vocali WhatsApp, che sono a 48 kHz).
      val outLen = (pcm.size.toLong() * 16_000 / rate).toInt()
      return FloatArray(outLen) { i ->
        val pos = i.toDouble() * rate / 16_000
        val j = pos.toInt().coerceAtMost(pcm.size - 1)
        val k = (j + 1).coerceAtMost(pcm.size - 1)
        val frac = (pos - j).toFloat()
        pcm[j] * (1 - frac) + pcm[k] * frac
      }
    }
    val session = resamplers.getOrPut(rate) { env.createSession(readAsset("asr/$asset"), OrtSession.SessionOptions()) }
    OnnxTensor.createTensor(env, FloatBuffer.wrap(pcm), longArrayOf(1, pcm.size.toLong())).use { w ->
      OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(pcm.size.toLong())), longArrayOf(1)).use { l ->
        session.run(mapOf("waveforms" to w, "waveforms_lens" to l)).use { r ->
          val len = (r.get("resampled_lens").get() as OnnxTensor).longBuffer.get(0).toInt()
          val data = (r.get("resampled").get() as OnnxTensor).floatBuffer
          return FloatArray(len).also { data.get(it) }
        }
      }
    }
  }

  /** Blocchi da ~55 s (max ~65 s, ~2 GB di picco), tagliati nel tratto di 100 ms piu silenzioso entro +-10 s. */
  private fun splitOnSilence(w: FloatArray): List<Pair<Int, Int>> {
    val sr = 16_000
    val target = 55 * sr
    val search = 10 * sr
    val win = sr / 10
    val cuts = ArrayList<Pair<Int, Int>>()
    var start = 0
    while (w.size - start > target + search) {
      val lo = start + target - search
      val hi = start + target + search
      var best = lo
      var bestEnergy = Double.MAX_VALUE
      var p = lo
      while (p < hi - win) {
        var e = 0.0
        for (i in p until p + win) e += w[i] * w[i]
        if (e < bestEnergy) { bestEnergy = e; best = p + win / 2 }
        p += win / 2
      }
      cuts.add(start to best)
      start = best
    }
    cuts.add(start to w.size)
    return cuts
  }

  private fun recognize(wave: FloatArray): String {
    val pre = preprocessor!!
    val enc = encoder!!
    val dec = decoder!!

    val (features, featShape, featLen) =
      OnnxTensor.createTensor(env, FloatBuffer.wrap(wave), longArrayOf(1, wave.size.toLong())).use { w ->
        OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(wave.size.toLong())), longArrayOf(1)).use { l ->
          pre.run(mapOf("waveforms" to w, "waveforms_lens" to l)).use { r ->
            val t = r.get("features").get() as OnnxTensor
            Triple(toArray(t.floatBuffer), t.info.shape, (r.get("features_lens").get() as OnnxTensor).longBuffer.get(0))
          }
        }
      }

    // encoder: outputs [1, 1024, T] (canali prima del tempo)
    val (encOut, dim, frames, validFrames) =
      OnnxTensor.createTensor(env, FloatBuffer.wrap(features), featShape).use { f ->
        OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(featLen)), longArrayOf(1)).use { l ->
          enc.run(mapOf("audio_signal" to f, "length" to l)).use { r ->
            val t = r.get("outputs").get() as OnnxTensor
            val shape = t.info.shape
            val arr = toArray(t.floatBuffer)
            val len = (r.get("encoded_lengths").get() as OnnxTensor).longBuffer.get(0).toInt()
            EncoderOut(arr, shape[1].toInt(), shape[2].toInt(), len)
          }
        }
      }

    val stateShape = longArrayOf(2, 1, 640)
    var state1 = FloatArray(2 * 640)
    var state2 = FloatArray(2 * 640)
    val frame = FloatArray(dim)
    val tokens = ArrayList<Int>()
    val vocabSize = vocab.size
    var t = 0
    var emitted = 0

    while (t < validFrames) {
      for (d in 0 until dim) frame[d] = encOut[d * frames + t]
      val prev = if (tokens.isEmpty()) blankId else tokens.last()

      val inputs = mapOf(
        "encoder_outputs" to OnnxTensor.createTensor(env, FloatBuffer.wrap(frame), longArrayOf(1, dim.toLong(), 1)),
        "targets" to OnnxTensor.createTensor(env, IntBuffer.wrap(intArrayOf(prev)), longArrayOf(1, 1)),
        "target_length" to OnnxTensor.createTensor(env, IntBuffer.wrap(intArrayOf(1)), longArrayOf(1)),
        "input_states_1" to OnnxTensor.createTensor(env, FloatBuffer.wrap(state1), stateShape),
        "input_states_2" to OnnxTensor.createTensor(env, FloatBuffer.wrap(state2), stateShape),
      )
      val out = try {
        dec.run(inputs, setOf("outputs", "output_states_1", "output_states_2")).use { r ->
          val logits = (r.get("outputs").get() as OnnxTensor).floatBuffer
          // Le ultime 5 uscite dopo il vocabolario sono le durate TDT (0..4 frame).
          DecodeStep(
            token = argmax(logits, 0, vocabSize),
            step = argmax(logits, vocabSize, logits.limit()) - vocabSize,
            state1 = toArray((r.get("output_states_1").get() as OnnxTensor).floatBuffer),
            state2 = toArray((r.get("output_states_2").get() as OnnxTensor).floatBuffer),
          )
        }
      } finally {
        inputs.values.forEach { it.close() }
      }

      if (out.token != blankId) {
        state1 = out.state1
        state2 = out.state2
        tokens.add(out.token)
        emitted++
      }
      if (out.step > 0) {
        t += out.step
        emitted = 0
      } else if (out.token == blankId || emitted == MAX_TOKENS_PER_STEP) {
        t += 1
        emitted = 0
      }
    }

    return detokenize(tokens)
  }

  private fun argmax(buf: FloatBuffer, from: Int, to: Int): Int {
    var best = from
    var bestVal = buf.get(from)
    for (i in from + 1 until to) {
      val v = buf.get(i)
      if (v > bestVal) { bestVal = v; best = i }
    }
    return best
  }

  /** Come onnx-asr: unisce i token SentencePiece e normalizza gli spazi. */
  private fun detokenize(tokens: List<Int>): String {
    val raw = tokens.joinToString("") { vocab[it] }
    return SPACE_PATTERN.replace(raw) { m -> if (m.groups[1] != null) " " else "" }
  }

  private fun toArray(buf: FloatBuffer): FloatArray = FloatArray(buf.remaining()).also { buf.get(it) }

  private class DecodeStep(val token: Int, val step: Int, val state1: FloatArray, val state2: FloatArray)

  private data class EncoderOut(val data: FloatArray, val dim: Int, val frames: Int, val valid: Int)

  private data class ModelFile(
    val name: String, val remotePath: String, val size: Long, val sha256: String, val label: String,
  )

  private class CancelledException : Exception()

  companion object {
    const val NAME = "LocalAsr"
    const val EVENT_DOWNLOAD = "LocalAsrDownload"
    const val EVENT_PROGRESS = "LocalAsrProgress"
    private const val MODEL_ID = "parakeet-ultra-int8"
    private const val MAX_TOKENS_PER_STEP = 10

    // Revisione fissata: e quella validata. Se l'autore ripubblica i file,
    // l'app continua a scaricare esattamente questa versione.
    private const val BASE_URL =
      "https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx/resolve/b27f93c2238aa35e138996c005a62f1e8430f801"

    private val FILES = listOf(
      ModelFile(
        "vocab.txt", "vocab.txt", 93_939,
        "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d", "Vocabolario",
      ),
      ModelFile(
        "decoder_joint-model.int8.onnx", "int8/decoder_joint-model.int8.onnx", 18_203_490,
        "667ffde2242a560923cba6bc7f69ef03d736f8a36ca9588f2e6f9fa818cf2fc1", "Decoder",
      ),
      ModelFile(
        "encoder-model.int8.onnx", "int8/encoder-model.int8.onnx", 649_431_593,
        "714047d70be4b612dce02e0ab2f9e0d6552f78adc421f408d154070796bc2dcf", "Encoder",
      ),
    )
    private val TOTAL_BYTES = FILES.sumOf { it.size }

    private val RESAMPLERS = mapOf(
      8_000 to "resample_8_16.onnx",
      11_025 to "resample_11_16.onnx",
      22_050 to "resample_22_16.onnx",
      24_000 to "resample_24_16.onnx",
      32_000 to "resample_32_16.onnx",
      44_100 to "resample_44_16.onnx",
      48_000 to "resample_48_16.onnx",
    )

    private val SPACE_PATTERN = Regex("""\A\s|\s\B|(\s)\b""")
  }
}
