package com.audioscribe.glass

import android.app.Application
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Modulo locale: lettura audio in base64, ricerca ultimo vocale,
          // azione di avvio della scorciatoia.
          add(AudioScribePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    publishShareShortcut()
  }

  /**
   * Pubblica uno shortcut dinamico "long lived" con la categoria dichiarata
   * in res/xml/shortcuts.xml. E' quello che fa comparire AudioScribe nella
   * riga dei suggerimenti in cima al menu di condivisione (Direct Share),
   * invece che solo nella lista di tutte le app.
   */
  private fun publishShareShortcut() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    try {
      val manager = getSystemService(ShortcutManager::class.java) ?: return
      val intent = Intent(this, MainActivity::class.java).apply { action = Intent.ACTION_MAIN }

      val shortcut = ShortcutInfo.Builder(this, SHARE_SHORTCUT_ID)
        .setShortLabel(getString(R.string.shortcut_share_short))
        .setLongLabel(getString(R.string.shortcut_share_long))
        .setLongLived(true)
        .setCategories(setOf(SHARE_CATEGORY))
        .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
        .setIntent(intent)
        .build()

      manager.setDynamicShortcuts(listOf(shortcut))
    } catch (e: Exception) {
      // Uno shortcut non pubblicato non deve mai impedire l'avvio dell'app.
    }
  }

  companion object {
    private const val SHARE_SHORTCUT_ID = "share_transcribe"
    private const val SHARE_CATEGORY = "com.audioscribe.glass.category.AUDIO_SHARE_TARGET"
  }
}
