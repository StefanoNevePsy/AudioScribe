package com.audioscribe.glass

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registra AudioScribeModule. Usa BaseReactPackage (API non deprecata,
 * compatibile con la new architecture / bridgeless).
 */
class AudioScribePackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == AudioScribeModule.NAME) AudioScribeModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        AudioScribeModule.NAME to
          ReactModuleInfo(
            AudioScribeModule.NAME,
            AudioScribeModule::class.java.name,
            false, // canOverrideExistingModule
            false, // needsEagerInit
            false, // isCxxModule
            false, // isTurboModule
          ),
      )
    }
}
