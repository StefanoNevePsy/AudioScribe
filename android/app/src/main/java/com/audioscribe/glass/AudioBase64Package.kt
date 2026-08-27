package com.audioscribe.glass

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registra AudioBase64Module. Usa BaseReactPackage (API non deprecata,
 * compatibile con la new architecture / bridgeless) invece del vecchio
 * ReactPackage.createNativeModules.
 */
class AudioBase64Package : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == AudioBase64Module.NAME) AudioBase64Module(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        AudioBase64Module.NAME to
          ReactModuleInfo(
            AudioBase64Module.NAME,
            AudioBase64Module::class.java.name,
            false, // canOverrideExistingModule
            false, // needsEagerInit
            false, // isCxxModule
            false, // isTurboModule
          ),
      )
    }
}
