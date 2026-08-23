use btleplug::api::Peripheral as _;
use btleplug::platform;
use napi::bindgen_prelude::Uint8Array;
use napi_derive::napi;

#[napi]
pub struct BluetoothCharacteristicProperties {
    #[napi(writable = false)]
    pub broadcast: bool,
    #[napi(writable = false)]
    pub read: bool,
    #[napi(writable = false)]
    pub writeWithoutResponse: bool,
    #[napi(writable = false)]
    pub write: bool,
    #[napi(writable = false)]
    pub notify: bool,
    #[napi(writable = false)]
    pub indicate: bool,
    #[napi(writable = false)]
    pub authenticatedSignedWrites: bool,
    #[napi(writable = false)]
    pub reliableWrite: bool,
    #[napi(writable = false)]
    pub writableAuxiliaries: bool,
}

#[napi]
pub struct BluetoothRemoteGATTDescriptor {
    #[napi(writable = false)]
    pub uuid: String, // UUID
    #[napi(writable = false)]
    pub value: Option<Uint8Array>,
}

impl BluetoothRemoteGATTDescriptor {
    /*
      Promise<DataView> readValue();
      Promise<undefined> writeValue(BufferSource value);
    */
}

#[napi]
pub struct BluetoothRemoteGATTCharacteristic {
    #[napi(writable = false)]
    pub uuid: String, // UUID
    #[napi(writable = false)]
    pub value: Option<Uint8Array>,
}

impl BluetoothRemoteGATTCharacteristic {
    /*
      Promise<BluetoothRemoteGATTDescriptor> getDescriptor(BluetoothDescriptorUUID descriptor);
      Promise<sequence<BluetoothRemoteGATTDescriptor>>
        getDescriptors(optional BluetoothDescriptorUUID descriptor);
      Promise<DataView> readValue();
      Promise<undefined> writeValue(BufferSource value);
      Promise<undefined> writeValueWithResponse(BufferSource value);
      Promise<undefined> writeValueWithoutResponse(BufferSource value);
      Promise<BluetoothRemoteGATTCharacteristic> startNotifications();
      Promise<BluetoothRemoteGATTCharacteristic> stopNotifications();
    */
}

#[napi]
pub struct BluetoothRemoteGATTService {
    #[napi(writable = false)]
    pub uuid: String, // UUID
    #[napi(writable = false)]
    pub isPrimary: bool,
}

impl BluetoothRemoteGATTService {
    /*
      Promise<BluetoothRemoteGATTCharacteristic>
        getCharacteristic(BluetoothCharacteristicUUID characteristic);
      Promise<sequence<BluetoothRemoteGATTCharacteristic>>
        getCharacteristics(optional BluetoothCharacteristicUUID characteristic);
      Promise<BluetoothRemoteGATTService>
        getIncludedService(BluetoothServiceUUID service);
      Promise<sequence<BluetoothRemoteGATTService>>
        getIncludedServices(optional BluetoothServiceUUID service);
    */
}

#[napi]
pub struct BluetoothRemoteGATTServer {
    #[napi(writable = false)]
    pub connected: bool,
}

impl BluetoothRemoteGATTServer {
    /*
      Promise<BluetoothRemoteGATTServer> connect();
      undefined disconnect();
      Promise<BluetoothRemoteGATTService> getPrimaryService(BluetoothServiceUUID service);
      Promise<sequence<BluetoothRemoteGATTService>>
        getPrimaryServices(optional BluetoothServiceUUID service);
    */
}

#[napi]
pub struct BluetoothDevice {
    #[napi(writable = false)]
    pub id: String,
    #[napi(writable = false)]
    pub name: Option<String>,
    #[napi(writable = false)]
    pub watchingAdvertisements: bool,
}

impl BluetoothDevice {
    pub async fn new(peripheral: platform::Peripheral) -> Self {
        let name = peripheral
            .properties()
            .await
            .ok()
            .flatten()
            .and_then(|properties| properties.local_name)
            .unwrap_or_else(|| "Unknown".to_string());

        Self {
            id: peripheral.id().to_string(),
            name: Some(name),
            watchingAdvertisements: false,
        }
    }
    /*
        Promise<undefined> forget();
    Promise<undefined> watchAdvertisements(
        optional WatchAdvertisementsOptions options = {});
        */
}
