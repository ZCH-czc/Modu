package com.modureader.app

import android.view.KeyEvent
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class ReaderControlsModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  init {
    reactContext = context
  }

  override fun getName(): String = "ModuReaderControls"

  @ReactMethod
  fun setVolumeKeysEnabled(enabled: Boolean) {
    volumeKeysEnabled = enabled
  }

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit

  override fun invalidate() {
    if (reactContext === context) reactContext = null
    volumeKeysEnabled = false
    super.invalidate()
  }

  companion object {
    @Volatile
    private var reactContext: ReactApplicationContext? = null

    @Volatile
    private var volumeKeysEnabled = false

    fun handles(keyCode: Int): Boolean = volumeKeysEnabled &&
      (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)

    fun emit(keyCode: Int) {
      val direction = if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) "previous" else "next"
      reactContext
        ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit("moduVolumeKeyTurn", direction)
    }
  }
}
