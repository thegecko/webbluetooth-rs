import { nativeGetDevices, BluetoothDevice } from '../index.js'

/**
 * Bluetooth Options interface
 */
interface BluetoothOptions {
    /**
     * A `device found` callback function to allow the user to select a device
     */
    deviceFound?: (device: BluetoothDevice, selectFn: () => void) => boolean;

    /**
     * The amount of seconds to scan for the device (default is 10)
     */
    scanTime?: number;

    /**
     * Optional flag to automatically allow all devices
     */
    allowAllDevices?: boolean;

    /**
     * An optional referring device
     */
    referringDevice?: BluetoothDevice;

    /**
     * An optional index of bluetooth adapter to use
     */
    adapterIndex?: number;
}

class Bluetooth extends EventTarget implements Partial<Bluetooth> {

    public async loadDevices(): Promise<BluetoothDevice[]> {
        let devices = await nativeGetDevices();
        return devices;
    }
}

/**
  * Default bluetooth instance synonymous with `navigator.bluetooth`
  */
const bluetooth = new Bluetooth();

export {
    // Default bluetooth object (mimics navigator.bluetooth)
    bluetooth,

    // Main object class
    Bluetooth,

    // Types
    BluetoothOptions,

    // getAdapters
};

/**
 * Helper methods and enums
 */
export * from './uuid';
