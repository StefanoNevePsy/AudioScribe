package com.audioscribe.glass

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registra i moduli nativi dell'app. Usa BaseReactPackage (API non deprecata,
 * compatibile con la new architecture / bridgeless).
 */
class AudioScribePackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    when (name) {
      AudioScribeModule.NAME -> AudioScribeModule(reactContext)
      LocalAsrModule.NAME -> LocalAsrModule(reactContext)
      else -> null
    }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        AudioScribeModule.NAME to info(AudioScribeModule.NAME, AudioScribeModule::class.java.name),
        LocalAsrModule.NAME to info(LocalAsrModule.NAME, LocalAsrModule::class.java.name),
      )
    }

  private fun info(name: String, className: String) =
    ReactModuleInfo(
      name,
      className,
      false, // canOverrideExistingModule
      false, // needsEagerInit
      false, // isCxxModule
      false, // isTurboModule
    )
}
