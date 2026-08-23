import { BluetoothDevice as NativeBluetoothDevice, nativeGetDevices } from '../index.js';

/**
 * Bluetooth Options interface
 */
interface BluetoothOptions {
    /**
     * A `device found` callback function to allow the user to select a device.
     */
    deviceFound?: (device: NativeBluetoothDevice, selectFn: () => void) => boolean;

    /**
     * The amount of seconds to scan for the device.
     */
    scanTime?: number;

    /**
     * Optional flag to automatically allow all devices.
     */
    allowAllDevices?: boolean;

    /**
     * An optional referring device.
     */
    referringDevice?: NativeBluetoothDevice;

    /**
     * An optional index of bluetooth adapter to use.
     */
    adapterIndex?: number;
}

class Bluetooth extends EventTarget {
    public readonly referringDevice?: NativeBluetoothDevice;

    private readonly allowAllDevices: boolean;
    private readonly deviceFound?: (device: NativeBluetoothDevice, selectFn: () => void) => boolean;
    private readonly allowedDevices = new Set<string>();

    constructor(options: BluetoothOptions = {}) {
        super();

        this.allowAllDevices = options.allowAllDevices ?? false;
        this.deviceFound = options.deviceFound;
        this.referringDevice = options.referringDevice;

        void options.scanTime;
        void options.adapterIndex;
    }

    /**
     * Gets the availability of a bluetooth adapter.
     */
    public getAvailability(): Promise<boolean> {
        return Promise.resolve(true);
    }

    /**
     * Scans for a device matching optional filters.
     */
    public async requestDevice(options: RequestDeviceOptions = { filters: [] }): Promise<NativeBluetoothDevice> {
        this.validateRequestOptions(options);

        const devices = await nativeGetDevices();
        const matchedDevice = devices.find(device => this.matchesRequestOptions(device, options));

        if (!matchedDevice) {
            throw new Error('requestDevice error: no devices found');
        }

        let selected = true;
        const selectFn = () => {
            selected = true;
        };

        if (this.deviceFound) {
            selected = this.deviceFound(matchedDevice, selectFn) === true;
        }

        if (!selected) {
            throw new Error('requestDevice error: device not selected');
        }

        this.allowedDevices.add(matchedDevice.id);
        return matchedDevice;
    }

    /**
     * Get all allowed bluetooth devices.
     */
    public async getDevices(): Promise<NativeBluetoothDevice[]> {
        const devices = await nativeGetDevices();

        if (this.allowAllDevices) {
            return devices;
        }

        return devices.filter(device => this.allowedDevices.has(device.id));
    }

    public loadDevices(): Promise<NativeBluetoothDevice[]> {
        return nativeGetDevices();
    }

    /**
     * Request LE scan.
     */
    public requestLEScan(_options?: BluetoothLEScanOptions): Promise<BluetoothLEScan> {
        throw new Error('requestLEScan error: method not implemented.');
    }

    private validateRequestOptions(options: RequestDeviceOptions): void {
        if ('filters' in options && options.filters !== undefined) {
            if (options.filters.length === 0) {
                throw new TypeError('requestDevice error: no filters specified');
            }

            const hasEmptyFilter = options.filters.some(filter => Object.keys(filter).length === 0);
            if (hasEmptyFilter) {
                throw new TypeError('requestDevice error: empty filter specified');
            }

            const hasEmptyNamePrefix = options.filters.some(filter => filter.namePrefix === '');
            if (hasEmptyNamePrefix) {
                throw new TypeError('requestDevice error: empty namePrefix specified');
            }

            return;
        }

        if ('acceptAllDevices' in options && options.acceptAllDevices === true) {
            return;
        }

        throw new TypeError('requestDevice error: specify filters or acceptAllDevices');
    }

    private matchesRequestOptions(device: NativeBluetoothDevice, options: RequestDeviceOptions): boolean {
        if ('acceptAllDevices' in options && options.acceptAllDevices === true) {
            return true;
        }

        if (!('filters' in options) || options.filters === undefined) {
            return false;
        }

        return options.filters.some(filter => this.matchesFilter(device, filter));
    }

    private matchesFilter(device: NativeBluetoothDevice, filter: BluetoothLEScanFilter): boolean {
        const name = device.name ?? '';

        if (filter.name !== undefined && filter.name !== name) {
            return false;
        }

        if (filter.namePrefix !== undefined && !name.startsWith(filter.namePrefix)) {
            return false;
        }

        return true;
    }
}

/**
 * Default bluetooth object, allowing all devices by default.
 */
const bluetooth = new Bluetooth({
    allowAllDevices: true,
});

/**
 * Default WebBluetooth object, mimicking `navigator.bluetooth` when present.
 */
const webbluetooth = typeof navigator !== 'undefined' && navigator.bluetooth ? navigator.bluetooth : bluetooth;

export {
    bluetooth,
    webbluetooth,
    Bluetooth,
    BluetoothOptions,
};

/**
 * Helper methods and enums.
 */
export * from './uuid';
