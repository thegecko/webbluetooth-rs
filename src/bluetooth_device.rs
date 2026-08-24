use btleplug::api::{
    CharPropFlags, Characteristic, Descriptor, Peripheral as _, Service, ValueNotification,
    WriteType,
};
use btleplug::platform;
use futures_lite::StreamExt;
use napi::bindgen_prelude::Uint8Array;
use napi::{
    threadsafe_function::ThreadsafeFunction, threadsafe_function::ThreadsafeFunctionCallMode,
};
use napi::{Error, Result};
use napi_derive::napi;
use std::sync::{Mutex, MutexGuard};
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};

fn napi_error(prefix: &str, err: impl ToString) -> Error {
    Error::from_reason(format!("{prefix} error: {}", err.to_string()))
}

fn notification_task_guard(
    task: &Mutex<Option<JoinHandle<()>>>,
) -> MutexGuard<'_, Option<JoinHandle<()>>> {
    task.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn uuid_string(uuid: impl ToString) -> String {
    uuid.to_string().to_lowercase()
}

const CLIENT_CHARACTERISTIC_CONFIGURATION_DESCRIPTOR: &str = "00002902-0000-1000-8000-00805f9b34fb";

#[napi(object)]
pub struct BluetoothAdapterInfo {
    pub index: u32,
    pub address: String,
    pub active: bool,
}

#[napi]
pub struct BluetoothRemoteGATTDescriptor {
    peripheral: platform::Peripheral,
    descriptor: Descriptor,

    #[napi(writable = false)]
    pub uuid: String,
}

#[napi]
impl BluetoothRemoteGATTDescriptor {
    pub fn new(peripheral: platform::Peripheral, descriptor: Descriptor) -> Self {
        Self {
            peripheral,
            uuid: uuid_string(descriptor.uuid),
            descriptor,
        }
    }

    #[napi]
    pub async unsafe fn nativeReadValue(&mut self) -> Result<Uint8Array> {
        if self.uuid == CLIENT_CHARACTERISTIC_CONFIGURATION_DESCRIPTOR {
            return Ok(Uint8Array::from(vec![0, 0]));
        }

        let value = self
            .peripheral
            .read_descriptor(&self.descriptor)
            .await
            .map_err(|err| napi_error("readValue", err))?;
        Ok(Uint8Array::from(value))
    }

    #[napi]
    pub async unsafe fn nativeWriteValue(&mut self, value: Uint8Array) -> Result<()> {
        if self.uuid == CLIENT_CHARACTERISTIC_CONFIGURATION_DESCRIPTOR {
            return Err(Error::from_reason(
                "writeValue error: client characteristic configuration descriptor must be configured using startNotifications/stopNotifications",
            ));
        }

        let bytes = value.to_vec();
        self.peripheral
            .write_descriptor(&self.descriptor, &bytes)
            .await
            .map_err(|err| napi_error("writeValue", err))?;
        Ok(())
    }
}

#[napi]
pub struct BluetoothRemoteGATTCharacteristic {
    peripheral: platform::Peripheral,
    characteristic: Characteristic,
    notification_task: Mutex<Option<JoinHandle<()>>>,

    #[napi(writable = false)]
    pub uuid: String,
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
impl BluetoothRemoteGATTCharacteristic {
    pub fn new(peripheral: platform::Peripheral, characteristic: Characteristic) -> Self {
        Self {
            peripheral,
            uuid: uuid_string(characteristic.uuid),
            broadcast: characteristic.properties.contains(CharPropFlags::BROADCAST),
            read: characteristic.properties.contains(CharPropFlags::READ),
            writeWithoutResponse: characteristic
                .properties
                .contains(CharPropFlags::WRITE_WITHOUT_RESPONSE),
            write: characteristic.properties.contains(CharPropFlags::WRITE),
            notify: characteristic.properties.contains(CharPropFlags::NOTIFY),
            indicate: characteristic.properties.contains(CharPropFlags::INDICATE),
            authenticatedSignedWrites: characteristic
                .properties
                .contains(CharPropFlags::AUTHENTICATED_SIGNED_WRITES),
            reliableWrite: false,
            writableAuxiliaries: false,
            characteristic,
            notification_task: Mutex::new(None),
        }
    }

    #[napi]
    pub async fn getDescriptors(&self) -> Result<Vec<BluetoothRemoteGATTDescriptor>> {
        Ok(self
            .characteristic
            .descriptors
            .iter()
            .cloned()
            .map(|descriptor| {
                BluetoothRemoteGATTDescriptor::new(self.peripheral.clone(), descriptor)
            })
            .collect())
    }

    #[napi]
    pub async unsafe fn nativeReadValue(&mut self) -> Result<Uint8Array> {
        let value = self
            .peripheral
            .read(&self.characteristic)
            .await
            .map_err(|err| napi_error("readValue", err))?;
        Ok(Uint8Array::from(value))
    }

    #[napi]
    pub async unsafe fn nativeWriteValueWithResponse(&mut self, value: Uint8Array) -> Result<()> {
        self.native_write_value(value, WriteType::WithResponse)
            .await
    }

    #[napi]
    pub async unsafe fn nativeWriteValueWithoutResponse(
        &mut self,
        value: Uint8Array,
    ) -> Result<()> {
        self.native_write_value(value, WriteType::WithoutResponse)
            .await
    }

    async fn native_write_value(&mut self, value: Uint8Array, write_type: WriteType) -> Result<()> {
        let bytes = value.to_vec();
        self.peripheral
            .write(&self.characteristic, &bytes, write_type)
            .await
            .map_err(|err| napi_error("writeValue", err))?;
        Ok(())
    }

    #[napi]
    pub async fn nativeStartNotifications(
        &self,
        callback: ThreadsafeFunction<Vec<u8>, (), Vec<u8>, napi::Status, false>,
    ) -> Result<()> {
        {
            let task = notification_task_guard(&self.notification_task);
            if task.as_ref().is_some_and(|task| !task.is_finished()) {
                return Ok(());
            }
        }

        let peripheral = self.peripheral.clone();
        let notifications_task = tokio::spawn(async move { peripheral.notifications().await });
        let mut notifications = match timeout(Duration::from_secs(5), notifications_task).await {
            Ok(joined) => joined
                .map_err(|err| {
                    Error::from_reason(format!(
                        "startNotifications error: notifications task failed: {err}"
                    ))
                })?
                .map_err(|err| napi_error("startNotifications", err))?,
            Err(_) => {
                return Err(Error::from_reason(
                    "startNotifications error: notifications stream timed out",
                ));
            }
        };
        let service_uuid = self.characteristic.service_uuid;
        let characteristic_uuid = self.characteristic.uuid;
        {
            let mut task = notification_task_guard(&self.notification_task);
            *task = Some(tokio::spawn(async move {
                while let Some(ValueNotification {
                    uuid,
                    service_uuid: notification_service_uuid,
                    value,
                }) = notifications.next().await
                {
                    if uuid == characteristic_uuid && notification_service_uuid == service_uuid {
                        callback.call(value, ThreadsafeFunctionCallMode::NonBlocking);
                    }
                }
            }));
        }

        let peripheral = self.peripheral.clone();
        let characteristic = self.characteristic.clone();
        let subscribe_task =
            tokio::spawn(async move { peripheral.subscribe(&characteristic).await });
        match timeout(Duration::from_secs(5), subscribe_task).await {
            Ok(joined) => {
                if let Err(err) = joined.map_err(|err| {
                    Error::from_reason(format!(
                        "startNotifications error: subscribe task failed: {err}"
                    ))
                })? {
                    if let Some(task) = notification_task_guard(&self.notification_task).take() {
                        task.abort();
                    }
                    return Err(napi_error("startNotifications", err));
                }
            }
            Err(_) => {
                if let Some(task) = notification_task_guard(&self.notification_task).take() {
                    task.abort();
                }
                return Err(Error::from_reason(
                    "startNotifications error: subscribe timed out",
                ));
            }
        }

        Ok(())
    }

    #[napi]
    pub async fn nativeStopNotifications(&self) -> Result<()> {
        if let Some(task) = notification_task_guard(&self.notification_task).take() {
            task.abort();
        }
        self.peripheral
            .unsubscribe(&self.characteristic)
            .await
            .map_err(|err| napi_error("stopNotifications", err))?;
        Ok(())
    }
}

impl Drop for BluetoothRemoteGATTCharacteristic {
    fn drop(&mut self) {
        if let Some(task) = notification_task_guard(&self.notification_task).take() {
            task.abort();
        }
    }
}

#[napi]
pub struct BluetoothRemoteGATTService {
    peripheral: platform::Peripheral,
    service: Service,

    #[napi(writable = false)]
    pub uuid: String,
    #[napi(writable = false)]
    pub isPrimary: bool,
}

#[napi]
impl BluetoothRemoteGATTService {
    pub fn new(peripheral: platform::Peripheral, service: Service) -> Self {
        Self {
            peripheral,
            uuid: uuid_string(service.uuid),
            isPrimary: service.primary,
            service,
        }
    }

    #[napi]
    pub async fn getCharacteristics(&self) -> Result<Vec<BluetoothRemoteGATTCharacteristic>> {
        Ok(self
            .service
            .characteristics
            .iter()
            .cloned()
            .map(|characteristic| {
                BluetoothRemoteGATTCharacteristic::new(self.peripheral.clone(), characteristic)
            })
            .collect())
    }

    #[napi]
    pub async fn getIncludedService(&self, _service: String) -> Result<()> {
        Err(Error::from_reason(
            "getIncludedService error: method not implemented",
        ))
    }

    #[napi]
    pub async fn getIncludedServices(&self) -> Result<Vec<BluetoothRemoteGATTService>> {
        Err(Error::from_reason(
            "getIncludedServices error: method not implemented",
        ))
    }
}

#[napi]
pub struct BluetoothRemoteGATTServer {
    peripheral: platform::Peripheral,

    #[napi(writable = true)]
    pub connected: bool,
}

#[napi]
impl BluetoothRemoteGATTServer {
    pub fn new(peripheral: platform::Peripheral) -> Self {
        Self {
            peripheral,
            connected: false,
        }
    }

    #[napi]
    pub async unsafe fn nativeConnect(&mut self) -> Result<()> {
        if !self
            .peripheral
            .is_connected()
            .await
            .map_err(|err| napi_error("connect", err))?
        {
            self.peripheral
                .connect()
                .await
                .map_err(|err| napi_error("connect", err))?;
        }

        if let Err(err) = self.peripheral.discover_services().await {
            let _ = self.peripheral.disconnect().await;
            self.connected = false;
            return Err(napi_error("connect", err));
        }

        self.connected = true;
        Ok(())
    }

    #[napi]
    pub async fn nativeDisconnect(&self) -> Result<()> {
        let _ = self.peripheral.disconnect().await;
        Ok(())
    }

    #[napi]
    pub async fn nativeGetPrimaryServices(&self) -> Result<Vec<BluetoothRemoteGATTService>> {
        if !self.connected {
            return Err(Error::from_reason(
                "getPrimaryServices error: device not connected",
            ));
        }

        Ok(self
            .peripheral
            .services()
            .iter()
            .filter(|service| service.primary)
            .cloned()
            .map(|service| BluetoothRemoteGATTService::new(self.peripheral.clone(), service))
            .collect())
    }
}

#[napi]
pub struct BluetoothDevice {
    peripheral: platform::Peripheral,

    #[napi(writable = false)]
    pub id: String,
    #[napi(writable = true)]
    pub name: Option<String>,
    #[napi(writable = false)]
    pub watchingAdvertisements: bool,
    #[napi(writable = false)]
    pub serviceUuids: Vec<String>,
}

#[napi]
impl BluetoothDevice {
    pub async fn new(peripheral: platform::Peripheral) -> Self {
        let id = peripheral.id().to_string();
        let properties = peripheral.properties().await.ok().flatten();
        let name = properties.as_ref().and_then(|properties| {
            properties
                .local_name
                .clone()
                .or_else(|| properties.advertisement_name.clone())
        });

        let serviceUuids = properties
            .map(|properties| properties.services.into_iter().map(uuid_string).collect())
            .unwrap_or_default();

        Self {
            peripheral,
            id,
            name,
            watchingAdvertisements: false,
            serviceUuids,
        }
    }

    #[napi]
    pub fn gatt(&self) -> BluetoothRemoteGATTServer {
        BluetoothRemoteGATTServer::new(self.peripheral.clone())
    }

    #[napi]
    pub async fn nativeForget(&self) -> Result<()> {
        Ok(())
    }

    #[napi]
    pub async fn watchAdvertisements(&self) -> Result<()> {
        Err(Error::from_reason(
            "watchAdvertisements error: method not implemented",
        ))
    }

    #[napi]
    pub async fn unwatchAdvertisements(&self) -> Result<()> {
        Err(Error::from_reason(
            "unwatchAdvertisements error: method not implemented",
        ))
    }
}
