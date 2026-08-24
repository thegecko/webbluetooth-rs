# Web Bluetooth Library for Node.JS

[![Build Status](https://github.com/thegecko/webbluetooth-rs/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/thegecko/webbluetooth-rs/actions)
[![npm](https://img.shields.io/npm/dm/webbluetooth.svg)](https://www.npmjs.com/package/webbluetooth)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](http://opensource.org/licenses/MIT)

Node.js implementation of the [Web Bluetooth Specification](https://webbluetoothcg.github.io/web-bluetooth/)

This is a complete rewrite in rust using the excellent [btleplug library](https://docs.rs/btleplug/latest/btleplug/) and [napi-rs](https://napi.rs/).

> [!NOTE]
> For the previous v3.x.x - v6.x.x versions of webbluetooth, please see https://github.com/thegecko/webbluetooth.

# License
[MIT](LICENSE.md)

# Prerequisites

[Node.js >= v12.22.0](https://nodejs.org), which includes `npm`.

# Getting Started

## Supported Architectures and Operating Systems

- i686-pc-windows-msvc
- x86_64-apple-darwin
- x86_64-pc-windows-msvc
- x86_64-unknown-linux-gnu
- x86_64-unknown-linux-musl
- aarch64-apple-darwin
- aarch64-pc-windows-msvc
- aarch64-unknown-linux-gnu
- aarch64-unknown-linux-musl
- armv7-unknown-linux-gnueabihf

## Installation

Native modules are bundled as separate optional packages, so installation should be as simple as installing the package.

With `npm`:

```bash
npm install webbluetooth
```

With `yarn`:

```bash
yarn add webbluetooth
```

## Examples

Use the following examples to kickstart your development and once you have a desired device, use the APIs below to interact with it.

### Using the default bluetooth instance

To use existing Web Bluetooth scripts, you can simply use the default `bluetooth` instance in place of the `navigator.bluetooth` object:

```typescript
import { bluetooth } from 'webbluetooth';

const device = await bluetooth.requestDevice({
    filters:[{ services:[ 'heart_rate' ] }]
});

const server = await device.gatt.connect();
...
```

The first device matching the filters will be returned.

### Creating your own bluetooth instances

You may want to create your own instance of the `Bluetooth` class. For example, to inject a device chooser function or control the referring device:

```typescript
import { Bluetooth } from 'webbluetooth';

const customBluetooth = new Bluetooth({
    // This function can return a promise which allows a UI to be displayed if required
    devicesFound: device => device.name === 'myName'
});

const device = await customBluetooth.requestDevice({
    filters:[{ services:[ 'heart_rate' ] }]
});

const server = await device.gatt.connect();
...
```

# APIs
The API follows the Web Bluetooth specification which can be found here:

https://webbluetoothcg.github.io/web-bluetooth/

Two versions of the API exist by default:

- `bluetooth` - which exposes all functionality in an unrestricted manner (e.g. without needing to `requestDevice()` first)
- `webbluetooth` - which follows the Web Bluetooth specification exactly and requires the user to authorise devices via `requestDevice()` first.

You may also construct your own Bluetooth (e.g. to specify a `requestDevice()` callback) using the exported `Bluetooth` class.

Full auto-generated API documentation can be seen here:

https://thegecko.github.io/webbluetooth-rs/

## Implementation Status

### bluetooth

- [x] getAvailability()
- [x] referringDevice
- [x] requestDevice()
- [x] getDevices()
- [x] RequestDeviceOptions.filter.name
- [x] RequestDeviceOptions.filter.namePrefix
- [x] RequestDeviceOptions.filter.services
- [x] RequestDeviceOptions.filter.manufacturerData
- [x] RequestDeviceOptions.filter.serviceData
- [x] RequestDeviceOptions.acceptAllDevices
- [x] RequestDeviceOptions.optionalServices
- [ ] RequestDeviceOptions.exclusionFilters
- [ ] RequestDeviceOptions.optionalManufacturerData - used in advertisements, unsupported in adapter

### BluetoothDevice

- [x] id
- [x] name
- [x] gatt
- [x] forget()
- [ ] watchAdvertisements() - unsupported in adapter
- [ ] watchingAdvertisements - unsupported in adapter

### BluetoothRemoteGATTServer

- [x] device
- [x] connected
- [x] connect()
- [x] disconnect()
- [x] getPrimaryService()
- [x] getPrimaryServices()

### BluetoothRemoteGATTService

- [x] uuid
- [x] device
- [x] isPrimary
- [x] getCharacteristic()
- [x] getCharacteristics()
- [ ] getIncludedService() - unsupported in adapter
- [ ] getIncludedServices() - unsupported in adapter

### BluetoothRemoteGATTCharacteristic

- [x] uuid
- [x] service
- [x] value
- [x] properties.broadcast
- [x] properties.read
- [x] properties.write
- [x] properties.writeWithoutResponse
- [x] properties.notify
- [x] properties.indicate
- [x] properties.authenticatedSignedWrites
- [ ] properties.reliableWrite - unsupported in adapter
- [ ] properties.writableAuxiliaries - unsupported in adapter
- [x] getDescriptor()
- [x] getDescriptors()
- [x] readValue()
- [x] writeValue()
- [x] writeValueWithResponse()
- [x] writeValueWithoutResponse()
- [x] startNotifications()
- [x] stopNotifications()

### BluetoothRemoteGATTDescriptor

- [x] uuid
- [x] characteristic
- [x] value
- [x] readValue()
- [x] writeValue()

### BluetoothUUID

- [x] getService()
- [x] getCharacteristic()
- [x] getDescriptor()
- [x] canonicalUUID()

### Events

#### Bluetooth

- [ ] availabilitychanged - unsupported in adapter

#### Bluetooth Device

- [x] gattserverdisconnected
- [ ] advertisementreceived - unsupported in adapter

#### Bluetooth Service

- [x] serviceadded
- [ ] servicechanged - unsupported in adapter
- [ ] serviceremoved - unsupported in adapter

#### Bluetooth Characteristic

- [x] characteristicvaluechanged

## Extended Functions

This library extends the Web Bluetooth specification to add further functionality and convenience.

### getAdapters()
List the available bluetooth adapters

### Bluetooth class options
- [x] deviceFound - A `device found` callback function to allow the user to select a device
- [x] scanTime - The amount of seconds to scan for the device (default is 10)
- [x] allowAllDevices - Optional flag to automatically allow all devices
- [x] referringDevice - An optional referring device
- [x] adapterIndex - An optional index of bluetooth adapter to use (default is 0)

# Development
The library is based on native rust bindings wrapping the [btleplug](https://docs.rs/btleplug/latest/btleplug/) crate.

Ensure you have a working rust environment, instructions for setting this up are avalable at https://rust-lang.org/tools/install/

## Setup

```bash
git clone https://github.com/thegecko/webbluetooth-rs
```

## Building
The package can be built as follows:

```bash
npm install
npm run build:all
```

## Testing
To execute the unit tests, Run:

```bash
npm run test
```

The tests are set up to use a BBC micro:bit in range with the following services available:

- Device Info Service (0000180a-0000-1000-8000-00805f9b34fb)
- LED Service (e95dd91d-251d-470a-a062-fa1922dfa9a8)
- Button Service (e95d9882-251d-470a-a062-fa1922dfa9a8)

Sample code and hex file for the v2 micro:bit can be found in the [firmware folder](https://github.com/thegecko/webbluetooth-rs/tree/main/firmware).
