import {
    AdapterEmitter,
    BluetoothDevice as NativeBluetoothDevice,
    BluetoothRemoteGattCharacteristic as NativeBluetoothRemoteGATTCharacteristic,
    BluetoothRemoteGattDescriptor as NativeBluetoothRemoteGATTDescriptor,
    BluetoothRemoteGattServer as NativeBluetoothRemoteGATTServer,
    BluetoothRemoteGattService as NativeBluetoothRemoteGATTService,
    getAdapters,
    getAvailability as nativeGetAvailability,
} from '../index.js';
import { BluetoothUUID } from './uuid';

type NativeDevice = NativeBluetoothDevice & EventTarget & {
    serviceUuids?: string[];
    gatt: NativeGATTServer;
    nativeForget?: () => Promise<void>;
    forget: () => Promise<void>;
    watchAdvertisements: () => Promise<void>;
    unwatchAdvertisements: () => Promise<void>;
    onadvertisementreceived: ((ev: Event) => void) | null;
    ongattserverdisconnected: ((ev: Event) => void) | null;
    oncharacteristicvaluechanged: ((ev: Event) => void) | null;
    onserviceadded: ((ev: Event) => void) | null;
    onservicechanged: ((ev: Event) => void) | null;
    onserviceremoved: ((ev: Event) => void) | null;
};

type NativeGATTServer = NativeBluetoothRemoteGATTServer & EventTarget & {
    device: NativeDevice;
    nativeConnect: () => Promise<void>;
    nativeDisconnect: () => Promise<void>;
    nativeGetPrimaryServices: () => Promise<NativeService[]>;
    connect: () => Promise<NativeGATTServer>;
    disconnect: () => void;
    getPrimaryService: (service: BluetoothServiceUUID) => Promise<NativeService>;
    getPrimaryServices: (service?: BluetoothServiceUUID) => Promise<NativeService[]>;
};

type NativeService = Omit<NativeBluetoothRemoteGATTService, 'getCharacteristics'> & EventTarget & {
    device: NativeDevice;
    getCharacteristic: (characteristic: BluetoothCharacteristicUUID) => Promise<NativeCharacteristic>;
    getCharacteristics: (characteristic?: BluetoothCharacteristicUUID) => Promise<NativeCharacteristic[]>;
};

type NativeCharacteristic = Omit<NativeBluetoothRemoteGATTCharacteristic, 'value' | 'getDescriptors'> & EventTarget & {
    service: NativeService;
    value?: DataView;
    properties: BluetoothCharacteristicProperties;
    broadcast: boolean;
    read: boolean;
    writeWithoutResponse: boolean;
    write: boolean;
    notify: boolean;
    indicate: boolean;
    authenticatedSignedWrites: boolean;
    reliableWrite: boolean;
    writableAuxiliaries: boolean;
    nativeReadValue: () => Promise<Uint8Array>;
    nativeWriteValueWithResponse: (value: Uint8Array) => Promise<void>;
    nativeWriteValueWithoutResponse: (value: Uint8Array) => Promise<void>;
    nativeStartNotifications: (callback: (value: number[]) => void) => Promise<void>;
    nativeStopNotifications: () => Promise<void>;
    readValue: () => Promise<DataView>;
    writeValue: (value: BufferSource) => Promise<void>;
    writeValueWithResponse: (value: BufferSource) => Promise<void>;
    writeValueWithoutResponse: (value: BufferSource) => Promise<void>;
    getDescriptor: (descriptor: BluetoothDescriptorUUID) => Promise<NativeDescriptor>;
    getDescriptors: (descriptor?: BluetoothDescriptorUUID) => Promise<NativeDescriptor[]>;
    startNotifications: () => Promise<NativeCharacteristic>;
    stopNotifications: () => Promise<NativeCharacteristic>;
};

type NativeDescriptor = Omit<NativeBluetoothRemoteGATTDescriptor, 'value'> & {
    characteristic: NativeCharacteristic;
    value?: DataView;
    nativeReadValue: () => Promise<Uint8Array>;
    nativeWriteValue: (value: Uint8Array) => Promise<void>;
    readValue: () => Promise<DataView>;
    writeValue: (value: BufferSource) => Promise<void>;
};

interface BluetoothOptions {
    deviceFound?: (device: BluetoothDevice, selectFn: () => void) => boolean;
    scanTime?: number;
    allowAllDevices?: boolean;
    referringDevice?: BluetoothDevice;
    adapterIndex?: number;
}

interface BluetoothState {
    allowAllDevices: boolean;
    deviceFound?: (device: NativeDevice, selectFn: () => void) => boolean;
    scanTime: number;
    adapterIndex: number;
    emitter: AdapterEmitter;
    scanning: boolean;
    lifecycleStarted: boolean;
    allowedDevices: Set<string>;
    allowedServices: Map<string, Set<string>>;
    deviceCache: Map<string, NativeDevice>;
}

const DEFAULT_SCAN_TIME = 10.24;
const states = new WeakMap<Bluetooth, BluetoothState>();
const eventTargets = new WeakMap<object, EventTarget>();
const deviceOwners = new WeakMap<NativeDevice, Bluetooth>();
const deviceKeys = new WeakMap<NativeDevice, string>();
const gattDevices = new WeakMap<NativeGATTServer, NativeDevice>();
const gattConnected = new WeakMap<NativeGATTServer, boolean>();
const pendingDisconnects = new WeakMap<NativeDevice, Promise<void>>();
const serviceDevices = new WeakMap<NativeService, NativeDevice>();
const characteristicServices = new WeakMap<NativeCharacteristic, NativeService>();
const descriptorCharacteristics = new WeakMap<NativeDescriptor, NativeCharacteristic>();
const decorated = new WeakSet<object>();
const activeNotifications = new WeakMap<NativeDevice, Set<NativeCharacteristic>>();

const targetFor = (target: object): EventTarget => {
    let eventTarget = eventTargets.get(target);
    if (!eventTarget) {
        eventTarget = new EventTarget();
        eventTargets.set(target, eventTarget);
    }
    return eventTarget;
};

const defineReadonly = (target: object, key: string, value: unknown): void => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor && descriptor.value === value) {
        return;
    }
    if (descriptor && descriptor.configurable === false) {
        return;
    }
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        writable: false,
        value,
    });
};

const defineConnectedAccessor = (gatt: NativeGATTServer): void => {
    if (!gattConnected.has(gatt)) {
        let connected = false;
        try {
            connected = Boolean((gatt as unknown as { connected?: boolean }).connected);
        } catch {
            connected = false;
        }
        gattConnected.set(gatt, connected);
    }

    Object.defineProperty(gatt, 'connected', {
        configurable: true,
        enumerable: true,
        get(): boolean {
            return gattConnected.get(gatt) ?? false;
        },
        set(value: boolean): void {
            gattConnected.set(gatt, value);
        },
    });
};

const patchEventTarget = (prototype: object): void => {
    const proto = prototype as EventTarget;
    if (typeof proto.addEventListener === 'function') {
        return;
    }

    Object.defineProperties(prototype, {
        addEventListener: {
            configurable: true,
            value(this: object, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
                targetFor(this).addEventListener(type, listener, options);
            },
        },
        removeEventListener: {
            configurable: true,
            value(this: object, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
                targetFor(this).removeEventListener(type, listener, options);
            },
        },
        dispatchEvent: {
            configurable: true,
            value(this: object, event: Event): boolean {
                return targetFor(this).dispatchEvent(event);
            },
        },
    });
};

const toDataView = (value: Uint8Array): DataView => new DataView(value.buffer, value.byteOffset, value.byteLength);

const toUint8Array = (data: BufferSource): Uint8Array => {
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
    }

    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
};

const canonicalServices = (services?: BluetoothServiceUUID[]): string[] => {
    if (!services) {
        return [];
    }
    return services.map(service => BluetoothUUID.getService(service));
};

const serviceAllowed = (state: BluetoothState, device: NativeDevice, serviceUuid: string): boolean => {
    const key = deviceKeys.get(device);
    if (!key) {
        return true;
    }
    const allowed = state.allowedServices.get(key);
    return !allowed || allowed.size === 0 || allowed.has(serviceUuid);
};

const grantDevice = (state: BluetoothState, device: NativeDevice, services: string[]): void => {
    const key = deviceKeys.get(device);
    if (!key) {
        return;
    }
    state.allowedDevices.add(key);
    let allowed = state.allowedServices.get(key);
    if (!allowed) {
        allowed = new Set<string>();
        state.allowedServices.set(key, allowed);
    }
    services.forEach(service => allowed.add(service));
};

const scanError = (method: 'requestDevice' | 'getDevices'): Error => new Error(`${method} error: request in progress`);

const stopScan = (state: BluetoothState): void => {
    state.scanning = false;
    state.emitter.stopScan().catch(() => undefined);
};

const stopScanAsync = async (state: BluetoothState): Promise<void> => {
    state.scanning = false;
    await Promise.race([
        state.emitter.stopScan().catch(() => undefined),
        new Promise<void>(resolve => setTimeout(resolve, 1000)),
    ]);
};

const cacheKey = (state: BluetoothState, device: NativeDevice): string => `${state.adapterIndex}:${device.id}`;

const updateCachedDevice = (cached: NativeDevice, fresh: NativeDevice): void => {
    if (fresh.name) {
        cached.name = fresh.name;
    }
    if (fresh.serviceUuids) {
        try {
            cached.serviceUuids = fresh.serviceUuids;
        } catch {
            // Native fields may be readonly; stale advertisement data is acceptable.
        }
    }
};

const cacheDevice = (bluetooth: Bluetooth, fresh: NativeDevice): NativeDevice => {
    const state = stateFor(bluetooth);
    const key = cacheKey(state, fresh);
    const cached = state.deviceCache.get(key);
    if (cached) {
        updateCachedDevice(cached, fresh);
        if (!cached.gatt.connected) {
            const nativeGattFactory = (fresh as unknown as { gatt: () => NativeGATTServer }).gatt;
            const gatt = nativeGattFactory.call(fresh);
            decorateGatt(cached, gatt);
            defineReadonly(cached, 'gatt', gatt);
        }
        return cached;
    }

    decorateDevice(bluetooth, fresh, key);
    state.deviceCache.set(key, fresh);
    return fresh;
};

const dispatchDisconnect = (bluetooth: Bluetooth, device: NativeDevice): void => {
    stopDeviceNotifications(device);
    device.gatt.connected = false;
    const event = new CustomEvent('gattserverdisconnected', { bubbles: true });
    device.dispatchEvent(event);
    bluetooth.dispatchEvent(new CustomEvent('gattserverdisconnected', { bubbles: true }));
    eventTargets.set(device, new EventTarget());
    const state = stateFor(bluetooth);
    state.emitter.removeConnect().catch(() => undefined);
    state.emitter.removeDisconnect().catch(() => undefined);
    state.emitter.removeServicesModified().catch(() => undefined);
    state.lifecycleStarted = false;
};

const trackNotification = (characteristic: NativeCharacteristic): void => {
    const service = characteristicServices.get(characteristic);
    const device = service?.device;
    if (!device) {
        return;
    }
    let active = activeNotifications.get(device);
    if (!active) {
        active = new Set<NativeCharacteristic>();
        activeNotifications.set(device, active);
    }
    active.add(characteristic);
};

const untrackNotification = (characteristic: NativeCharacteristic): void => {
    const service = characteristicServices.get(characteristic);
    const device = service?.device;
    if (!device) {
        return;
    }
    const active = activeNotifications.get(device);
    active?.delete(characteristic);
    if (active?.size === 0) {
        activeNotifications.delete(device);
    }
};

const stopDeviceNotifications = (device: NativeDevice): void => {
    const active = activeNotifications.get(device);
    if (!active) {
        return;
    }
    activeNotifications.delete(device);
    for (const characteristic of active) {
        characteristic.nativeStopNotifications().catch(() => undefined);
    }
};

const decorateDevice = (bluetooth: Bluetooth, device: NativeDevice, key: string): void => {
    patchEventTarget(Object.getPrototypeOf(device));
    deviceOwners.set(device, bluetooth);
    deviceKeys.set(device, key);

    if (!decorated.has(device)) {
        decorated.add(device);
        const nativeGattFactory = (device as unknown as { gatt: () => NativeGATTServer }).gatt;
        const gatt = nativeGattFactory.call(device);
        decorateGatt(device, gatt);
        defineReadonly(device, 'gatt', gatt);
    }
};

const decorateGatt = (device: NativeDevice, gatt: NativeGATTServer): void => {
    patchEventTarget(Object.getPrototypeOf(gatt));
    gattDevices.set(gatt, device);
    defineConnectedAccessor(gatt);
    defineReadonly(gatt, 'device', device);
    if (decorated.has(gatt)) {
        return;
    }
    decorated.add(gatt);
};

const decorateService = (device: NativeDevice, service: NativeService): NativeService => {
    patchEventTarget(Object.getPrototypeOf(service));
    serviceDevices.set(service, device);
    defineReadonly(service, 'device', device);
    return service;
};

const decorateCharacteristic = (service: NativeService, characteristic: NativeCharacteristic): NativeCharacteristic => {
    patchEventTarget(Object.getPrototypeOf(characteristic));
    characteristicServices.set(characteristic, service);
    defineReadonly(characteristic, 'service', service);
    defineReadonly(characteristic, 'properties', {
        broadcast: characteristic.broadcast,
        read: characteristic.read,
        writeWithoutResponse: characteristic.writeWithoutResponse,
        write: characteristic.write,
        notify: characteristic.notify,
        indicate: characteristic.indicate,
        authenticatedSignedWrites: characteristic.authenticatedSignedWrites,
        reliableWrite: characteristic.reliableWrite,
        writableAuxiliaries: characteristic.writableAuxiliaries,
    });
    return characteristic;
};

const decorateDescriptor = (characteristic: NativeCharacteristic, descriptor: NativeDescriptor): NativeDescriptor => {
    descriptorCharacteristics.set(descriptor, characteristic);
    defineReadonly(descriptor, 'characteristic', characteristic);
    return descriptor;
};

const stateFor = (bluetooth: Bluetooth): BluetoothState => {
    const state = states.get(bluetooth);
    if (!state) {
        throw new Error('Bluetooth state not found');
    }
    return state;
};

const matchesFilter = (device: NativeDevice, filter: BluetoothLEScanFilter): boolean => {
    const name = device.name ?? '';

    if (filter.name !== undefined && filter.name !== name) {
        return false;
    }
    if (filter.namePrefix !== undefined && !name.startsWith(filter.namePrefix)) {
        return false;
    }
    if (filter.services) {
        const advertised = new Set(device.serviceUuids ?? []);
        const required = canonicalServices(filter.services);
        if (!required.every(service => advertised.has(service))) {
            return false;
        }
    }
    if (filter.serviceData) {
        const advertised = new Set<string>();
        if (!filter.serviceData.every(entry => advertised.has(BluetoothUUID.getService(entry.service)))) {
            return false;
        }
    }
    if (filter.manufacturerData) {
        const advertised = new Set<number>();
        if (!filter.manufacturerData.every(entry => advertised.has(entry.companyIdentifier))) {
            return false;
        }
    }

    return true;
};

const matchingFilterServices = (options: RequestDeviceOptions, device: NativeDevice): string[] => {
    if (!('filters' in options) || options.filters === undefined) {
        return [];
    }
    const services: string[] = [];
    for (const filter of options.filters) {
        if (matchesFilter(device, filter)) {
            services.push(...canonicalServices(filter.services));
        }
    }
    return services;
};

const matchesRequestOptions = (device: NativeDevice, options: RequestDeviceOptions): boolean => {
    if ('acceptAllDevices' in options && options.acceptAllDevices === true) {
        return true;
    }
    if (!('filters' in options) || options.filters === undefined) {
        return false;
    }
    return options.filters.some(filter => matchesFilter(device, filter));
};

const patchNativePrototypes = (): void => {
    const devicePrototype = NativeBluetoothDevice.prototype as unknown as NativeDevice;
    devicePrototype.forget = async function forget(this: NativeDevice): Promise<void> {
        const bluetooth = deviceOwners.get(this);
        const key = deviceKeys.get(this);
        if (bluetooth && key) {
            const state = stateFor(bluetooth);
            state.allowedDevices.delete(key);
            state.allowedServices.delete(key);
            state.deviceCache.delete(key);
        }
        await this.nativeForget?.();
    };

    const nativeGetCharacteristics = NativeBluetoothRemoteGATTService.prototype.getCharacteristics;
    const nativeGetDescriptors = NativeBluetoothRemoteGATTCharacteristic.prototype.getDescriptors;
    const gattPrototype = NativeBluetoothRemoteGATTServer.prototype as unknown as NativeGATTServer;
    gattPrototype.connect = async function connect(this: NativeGATTServer): Promise<NativeGATTServer> {
        if (this.connected) {
            return this;
        }
        const device = gattDevices.get(this);
        if (!device) {
            throw new Error('connect error: device not found');
        }
        await pendingDisconnects.get(device);
        await this.nativeConnect();
        this.connected = true;
        return this;
    };
    gattPrototype.disconnect = function disconnect(this: NativeGATTServer): void {
        const device = gattDevices.get(this);
        const bluetooth = device ? deviceOwners.get(device) : undefined;
        if (device && bluetooth && this.connected) {
            dispatchDisconnect(bluetooth, device);
        } else {
            this.connected = false;
        }
        try {
            const pending = this.nativeDisconnect().catch(() => undefined);
            if (device) {
                pendingDisconnects.set(device, pending);
                pending.finally(() => {
                    if (pendingDisconnects.get(device) === pending) {
                        pendingDisconnects.delete(device);
                    }
                }).catch(() => undefined);
            }
        } catch {
            // Public disconnect is void/best-effort.
        }
    };
    gattPrototype.getPrimaryServices = async function getPrimaryServices(this: NativeGATTServer, service?: BluetoothServiceUUID): Promise<NativeService[]> {
        if (!this.connected) {
            throw new Error('getPrimaryServices error: device not connected');
        }
        const device = gattDevices.get(this);
        const bluetooth = device ? deviceOwners.get(device) : undefined;
        const state = bluetooth ? stateFor(bluetooth) : undefined;
        const canonical = service === undefined ? undefined : BluetoothUUID.getService(service);
        let services = (await this.nativeGetPrimaryServices()).map(nativeService => device ? decorateService(device, nativeService as NativeService) : nativeService as NativeService);
        if (state && device) {
            services = services.filter(nativeService => serviceAllowed(state, device, nativeService.uuid));
        }
        if (canonical !== undefined) {
            services = services.filter(nativeService => nativeService.uuid === canonical);
            if (services.length === 0) {
                throw new Error('getPrimaryServices error: service not found');
            }
        }
        return services;
    };
    gattPrototype.getPrimaryService = async function getPrimaryService(this: NativeGATTServer, service: BluetoothServiceUUID): Promise<NativeService> {
        if (!this.connected) {
            throw new Error('getPrimaryService error: device not connected');
        }
        if (!service) {
            throw new Error('getPrimaryService error: no service specified');
        }
        const services = await this.getPrimaryServices(service);
        if (services.length === 0) {
            throw new Error('getPrimaryService error: service not found');
        }
        return services[0];
    };

    const servicePrototype = NativeBluetoothRemoteGATTService.prototype as unknown as NativeService;
    servicePrototype.getCharacteristics = async function getCharacteristics(this: NativeService, characteristic?: BluetoothCharacteristicUUID): Promise<NativeCharacteristic[]> {
        const device = serviceDevices.get(this);
        if (device && !device.gatt.connected) {
            throw new Error('getCharacteristics error: device not connected');
        }
        let characteristics = (await nativeGetCharacteristics.call(this)).map((nativeCharacteristic: NativeBluetoothRemoteGATTCharacteristic) => decorateCharacteristic(this, nativeCharacteristic as NativeCharacteristic));
        if (characteristic !== undefined) {
            const canonical = BluetoothUUID.getCharacteristic(characteristic);
            characteristics = characteristics.filter(nativeCharacteristic => nativeCharacteristic.uuid === canonical);
            if (characteristics.length === 0) {
                throw new Error('getCharacteristics error: characteristic not found');
            }
        }
        return characteristics;
    };
    servicePrototype.getCharacteristic = async function getCharacteristic(this: NativeService, characteristic: BluetoothCharacteristicUUID): Promise<NativeCharacteristic> {
        const device = serviceDevices.get(this);
        if (device && !device.gatt.connected) {
            throw new Error('getCharacteristic error: device not connected');
        }
        if (!characteristic) {
            throw new Error('getCharacteristic error: no characteristic specified');
        }
        const characteristics = await this.getCharacteristics(characteristic);
        if (characteristics.length === 0) {
            throw new Error('getCharacteristic error: characteristic not found');
        }
        return characteristics[0];
    };

    const characteristicPrototype = NativeBluetoothRemoteGATTCharacteristic.prototype as unknown as NativeCharacteristic;
    characteristicPrototype.readValue = async function readValue(this: NativeCharacteristic): Promise<DataView> {
        const service = characteristicServices.get(this);
        if (service?.device && !service.device.gatt.connected) {
            throw new Error('readValue error: device not connected');
        }
        const view = toDataView(await this.nativeReadValue());
        this.value = view;
        return view;
    };
    characteristicPrototype.writeValue = async function writeValue(this: NativeCharacteristic, value: BufferSource): Promise<void> {
        await this.writeValueWithResponse(value);
    };
    characteristicPrototype.writeValueWithResponse = async function writeValueWithResponse(this: NativeCharacteristic, value: BufferSource): Promise<void> {
        const service = characteristicServices.get(this);
        if (service?.device && !service.device.gatt.connected) {
            throw new Error('writeValue error: device not connected');
        }
        const bytes = toUint8Array(value);
        await this.nativeWriteValueWithResponse(bytes);
        this.value = toDataView(bytes);
    };
    characteristicPrototype.writeValueWithoutResponse = async function writeValueWithoutResponse(this: NativeCharacteristic, value: BufferSource): Promise<void> {
        const service = characteristicServices.get(this);
        if (service?.device && !service.device.gatt.connected) {
            throw new Error('writeValue error: device not connected');
        }
        const bytes = toUint8Array(value);
        await this.nativeWriteValueWithoutResponse(bytes);
        this.value = toDataView(bytes);
    };
    characteristicPrototype.getDescriptors = async function getDescriptors(this: NativeCharacteristic, descriptor?: BluetoothDescriptorUUID): Promise<NativeDescriptor[]> {
        const service = characteristicServices.get(this);
        if (service?.device && !service.device.gatt.connected) {
            throw new Error('getDescriptors error: device not connected');
        }
        let descriptors = (await nativeGetDescriptors.call(this)).map((nativeDescriptor: NativeBluetoothRemoteGATTDescriptor) => decorateDescriptor(this, nativeDescriptor as NativeDescriptor));
        if (descriptor !== undefined) {
            const canonical = BluetoothUUID.getDescriptor(descriptor);
            descriptors = descriptors.filter(nativeDescriptor => nativeDescriptor.uuid === canonical);
            if (descriptors.length === 0) {
                throw new Error('getDescriptors error: descriptor not found');
            }
        }
        return descriptors;
    };
    characteristicPrototype.getDescriptor = async function getDescriptor(this: NativeCharacteristic, descriptor: BluetoothDescriptorUUID): Promise<NativeDescriptor> {
        if (!descriptor) {
            throw new Error('getDescriptor error: no descriptor specified');
        }
        const descriptors = await this.getDescriptors(descriptor);
        if (descriptors.length === 0) {
            throw new Error('getDescriptor error: descriptor not found');
        }
        return descriptors[0];
    };
    characteristicPrototype.startNotifications = async function startNotifications(this: NativeCharacteristic): Promise<NativeCharacteristic> {
        const service = characteristicServices.get(this);
        if (service?.device && !service.device.gatt.connected) {
            throw new Error('startNotifications error: device not connected');
        }
        await this.nativeStartNotifications(value => {
            const view = toDataView(Uint8Array.from(value));
            this.value = view;
            this.dispatchEvent(new CustomEvent('characteristicvaluechanged', { bubbles: true }));
            service?.dispatchEvent(new CustomEvent('characteristicvaluechanged', { bubbles: true }));
            service?.device.dispatchEvent(new CustomEvent('characteristicvaluechanged', { bubbles: true }));
            const bluetooth = service?.device ? deviceOwners.get(service.device) : undefined;
            bluetooth?.dispatchEvent(new CustomEvent('characteristicvaluechanged', { bubbles: true }));
        });
        trackNotification(this);
        return this;
    };
    characteristicPrototype.stopNotifications = async function stopNotifications(this: NativeCharacteristic): Promise<NativeCharacteristic> {
        const service = characteristicServices.get(this);
        if (service?.device && !service.device.gatt.connected) {
            throw new Error('stopNotifications error: device not connected');
        }
        await this.nativeStopNotifications();
        untrackNotification(this);
        return this;
    };

    const descriptorPrototype = NativeBluetoothRemoteGATTDescriptor.prototype as unknown as NativeDescriptor;
    descriptorPrototype.readValue = async function readValue(this: NativeDescriptor): Promise<DataView> {
        const characteristic = descriptorCharacteristics.get(this);
        const service = characteristic ? characteristicServices.get(characteristic) : undefined;
        if (service?.device && !service.device.gatt.connected) {
            throw new Error('readValue error: device not connected');
        }
        const view = toDataView(await this.nativeReadValue());
        this.value = view;
        return view;
    };
    descriptorPrototype.writeValue = async function writeValue(this: NativeDescriptor, value: BufferSource): Promise<void> {
        const characteristic = descriptorCharacteristics.get(this);
        const service = characteristic ? characteristicServices.get(characteristic) : undefined;
        if (service?.device && !service.device.gatt.connected) {
            throw new Error('writeValue error: device not connected');
        }
        const bytes = toUint8Array(value);
        await this.nativeWriteValue(bytes);
        this.value = toDataView(bytes);
    };
};

patchNativePrototypes();

class Bluetooth extends EventTarget {
    public readonly referringDevice?: BluetoothDevice;

    public constructor(options: BluetoothOptions = {}) {
        super();
        this.referringDevice = options.referringDevice;
        states.set(this, {
            allowAllDevices: options.allowAllDevices ?? false,
            deviceFound: options.deviceFound as ((device: NativeDevice, selectFn: () => void) => boolean) | undefined,
            scanTime: options.scanTime ?? DEFAULT_SCAN_TIME,
            adapterIndex: options.adapterIndex ?? 0,
            emitter: new AdapterEmitter(),
            scanning: false,
            lifecycleStarted: false,
            allowedDevices: new Set<string>(),
            allowedServices: new Map<string, Set<string>>(),
            deviceCache: new Map<string, NativeDevice>(),
        });
    }

    public getAvailability(): Promise<boolean> {
        return nativeGetAvailability(stateFor(this).adapterIndex);
    }

    public requestDevice(options: RequestDeviceOptions = { filters: [] }): Promise<BluetoothDevice> {
        this.validateRequestOptions(options);
        const state = stateFor(this);
        if (state.scanning) {
            throw scanError('requestDevice');
        }
        state.scanning = true;

        return new Promise((resolve, reject) => {
            let settled = false;
            const presented = new Set<string>();
            const finish = (fn: () => void): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                void stopScanAsync(state).then(fn);
            };
            const select = (device: NativeDevice): void => {
                const services = [
                    ...matchingFilterServices(options, device),
                    ...canonicalServices(options.optionalServices),
                ];
                grantDevice(state, device, services);
                finish(() => resolve(device as unknown as BluetoothDevice));
            };
            const timer = setTimeout(() => finish(() => reject('requestDevice error: no devices found')), state.scanTime * 1000);

            state.emitter.startScan(state.adapterIndex, found => {
                try {
                    if (settled) {
                        return;
                    }
                    const device = cacheDevice(this, found as NativeDevice);
                    const key = deviceKeys.get(device);
                    if (!key || presented.has(key) || !matchesRequestOptions(device, options)) {
                        return;
                    }
                    presented.add(key);
                    const selectFn = (): void => select(device);
                    if (!state.deviceFound || state.deviceFound(device, selectFn) === true) {
                        select(device);
                    }
                } catch (error) {
                    finish(() => reject(error));
                }
            }).catch(error => finish(() => reject(error)));
        });
    }

    public getDevices(): Promise<BluetoothDevice[]> {
        const state = stateFor(this);
        if (state.scanning) {
            throw scanError('getDevices');
        }
        state.scanning = true;

        return new Promise((resolve, reject) => {
            const devices = new Map<string, NativeDevice>();
            let settled = false;
            const finish = (fn: () => void): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                void stopScanAsync(state).then(fn);
            };
            const timer = setTimeout(() => finish(() => resolve([...devices.values()] as unknown as BluetoothDevice[])), state.scanTime * 1000);

            state.emitter.startScan(state.adapterIndex, found => {
                try {
                    if (settled) {
                        return;
                    }
                    const device = cacheDevice(this, found as NativeDevice);
                    const key = deviceKeys.get(device);
                    if (!key) {
                        return;
                    }
                    if (state.allowAllDevices || state.allowedDevices.has(key)) {
                        devices.set(key, device);
                    }
                } catch (error) {
                    finish(() => reject(error));
                }
            }).catch(error => finish(() => reject(error)));
        });
    }

    public loadDevices(): Promise<BluetoothDevice[]> {
        return this.getDevices();
    }

    public cancelRequest(): void {
        const state = stateFor(this);
        stopScan(state);
    }

    public requestLEScan(_options?: BluetoothLEScanOptions): Promise<BluetoothLEScan> {
        throw new Error('requestLEScan error: method not implemented.');
    }

    private validateRequestOptions(options: RequestDeviceOptions): void {
        if ('filters' in options && options.filters !== undefined) {
            if (options.filters.length === 0) {
                throw new TypeError('requestDevice error: no filters specified');
            }
            if (options.filters.some(filter => Object.keys(filter).length === 0)) {
                throw new TypeError('requestDevice error: empty filter specified');
            }
            if (options.filters.some(filter => filter.namePrefix === '')) {
                throw new TypeError('requestDevice error: empty namePrefix specified');
            }
            return;
        }

        if ('acceptAllDevices' in options && options.acceptAllDevices === true) {
            return;
        }

        throw new TypeError('requestDevice error: specify filters or acceptAllDevices');
    }
}

const bluetooth = new Bluetooth({
    allowAllDevices: true,
});

const webbluetooth = typeof navigator !== 'undefined' && navigator.bluetooth ? navigator.bluetooth : bluetooth;

export {
    bluetooth,
    webbluetooth,
    Bluetooth,
    BluetoothOptions,
    getAdapters,
};

export * from './uuid';
