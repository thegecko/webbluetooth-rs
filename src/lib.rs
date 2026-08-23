#![allow(non_snake_case)]

mod bluetooth_device;

use bluetooth_device::{BluetoothAdapterInfo, BluetoothDevice};
use btleplug::api::{Central, CentralEvent, Manager as _, ScanFilter};
use btleplug::platform::Manager;
use futures_lite::StreamExt;
use napi::{
    threadsafe_function::ThreadsafeFunction, threadsafe_function::ThreadsafeFunctionCallMode,
};
use napi::{Error, Result};
use napi_derive::napi;
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::task::JoinHandle;
use tokio::time::{sleep, Duration};

struct Callbacks {
    scan: Option<ThreadsafeFunction<BluetoothDevice, (), BluetoothDevice, napi::Status, false>>,
    connect: Option<ThreadsafeFunction<String, (), String, napi::Status, false>>,
    disconnect: Option<ThreadsafeFunction<String, (), String, napi::Status, false>>,
    services_modified: Option<ThreadsafeFunction<String, (), String, napi::Status, false>>,
}

fn callbacks_guard(callbacks: &Mutex<Callbacks>) -> MutexGuard<'_, Callbacks> {
    callbacks
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn watch_task_guard(
    watch_task: &Mutex<Option<JoinHandle<()>>>,
) -> MutexGuard<'_, Option<JoinHandle<()>>> {
    watch_task
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

async fn adapter(adapterIndex: u32) -> Result<btleplug::platform::Adapter> {
    let manager = Manager::new()
        .await
        .map_err(|err| Error::from_reason(format!("adapter error: {err}")))?;
    let adapters = manager
        .adapters()
        .await
        .map_err(|err| Error::from_reason(format!("adapter error: {err}")))?;
    adapters
        .into_iter()
        .nth(adapterIndex as usize)
        .ok_or_else(|| Error::from_reason("adapter error: adapter not found"))
}

#[napi]
pub struct AdapterEmitter {
    callbacks: Arc<Mutex<Callbacks>>,
    watch_task: Mutex<Option<JoinHandle<()>>>,
    scan_task: Mutex<Option<JoinHandle<()>>>,
    adapterIndex: Mutex<Option<u32>>,
    scanning: Mutex<bool>,
}

#[napi]
impl AdapterEmitter {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            callbacks: Arc::new(Mutex::new(Callbacks {
                scan: None,
                connect: None,
                disconnect: None,
                services_modified: None,
            })),
            watch_task: Mutex::new(None),
            scan_task: Mutex::new(None),
            adapterIndex: Mutex::new(None),
            scanning: Mutex::new(false),
        }
    }

    async fn start_watching(&self, adapterIndex: u32) -> Result<()> {
        {
            let mut stored_index = self
                .adapterIndex
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *stored_index = Some(adapterIndex);
        }

        {
            let watch_task = watch_task_guard(&self.watch_task);
            if matches!(watch_task.as_ref(), Some(task) if !task.is_finished()) {
                return Ok(());
            }
        }

        let central = adapter(adapterIndex).await?;
        let mut events = central
            .events()
            .await
            .map_err(|err| Error::from_reason(format!("events error: {err}")))?;
        let callbacks = self.callbacks.clone();

        let mut watch_task = watch_task_guard(&self.watch_task);
        *watch_task = Some(tokio::spawn(async move {
            while let Some(event) = events.next().await {
                match event {
                    CentralEvent::DeviceDiscovered(id)
                    | CentralEvent::DeviceUpdated(id)
                    | CentralEvent::ManufacturerDataAdvertisement { id, .. }
                    | CentralEvent::ServiceDataAdvertisement { id, .. }
                    | CentralEvent::ServicesAdvertisement { id, .. }
                    | CentralEvent::RssiUpdate { id, .. } => {
                        let cb_exists = callbacks_guard(&callbacks).scan.is_some();
                        if !cb_exists {
                            continue;
                        }
                        if let Ok(peripheral) = central.peripheral(&id).await {
                            let device = BluetoothDevice::new(peripheral).await;
                            let guard = callbacks_guard(&callbacks);
                            if let Some(cb) = guard.scan.as_ref() {
                                cb.call(device, ThreadsafeFunctionCallMode::NonBlocking);
                            }
                        }
                    }
                    CentralEvent::DeviceConnected(id) => {
                        let guard = callbacks_guard(&callbacks);
                        if let Some(cb) = guard.connect.as_ref() {
                            cb.call(id.to_string(), ThreadsafeFunctionCallMode::NonBlocking);
                        }
                    }
                    CentralEvent::DeviceDisconnected(id) => {
                        let guard = callbacks_guard(&callbacks);
                        if let Some(cb) = guard.disconnect.as_ref() {
                            cb.call(id.to_string(), ThreadsafeFunctionCallMode::NonBlocking);
                        }
                    }
                    CentralEvent::DeviceServicesModified(id) => {
                        let guard = callbacks_guard(&callbacks);
                        if let Some(cb) = guard.services_modified.as_ref() {
                            cb.call(id.to_string(), ThreadsafeFunctionCallMode::NonBlocking);
                        }
                    }
                    CentralEvent::StateUpdate(_) => {}
                }
            }
        }));

        Ok(())
    }

    fn stop_watching_if_idle(&self) {
        let scanning = *self
            .scanning
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let callbacks = callbacks_guard(&self.callbacks);
        let has_callbacks = callbacks.scan.is_some()
            || callbacks.connect.is_some()
            || callbacks.disconnect.is_some()
            || callbacks.services_modified.is_some();
        drop(callbacks);

        if !scanning && !has_callbacks {
            if let Some(task) = watch_task_guard(&self.watch_task).take() {
                task.abort();
            }
        }
    }

    #[napi]
    pub async fn startScan(
        &self,
        adapterIndex: u32,
        callback: ThreadsafeFunction<BluetoothDevice, (), BluetoothDevice, napi::Status, false>,
    ) -> Result<()> {
        {
            callbacks_guard(&self.callbacks).scan = Some(callback);
            *self
                .scanning
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
        }
        self.start_watching(adapterIndex).await?;
        let central = adapter(adapterIndex).await?;
        central
            .start_scan(ScanFilter::default())
            .await
            .map_err(|err| Error::from_reason(format!("startScan error: {err}")))?;

        if let Some(task) = watch_task_guard(&self.scan_task).take() {
            task.abort();
        }
        let callbacks = self.callbacks.clone();
        *watch_task_guard(&self.scan_task) = Some(tokio::spawn(async move {
            loop {
                let cb_exists = callbacks_guard(&callbacks).scan.is_some();
                if !cb_exists {
                    break;
                }
                if let Ok(peripherals) = central.peripherals().await {
                    for peripheral in peripherals {
                        let device = BluetoothDevice::new(peripheral).await;
                        let guard = callbacks_guard(&callbacks);
                        if let Some(cb) = guard.scan.as_ref() {
                            cb.call(device, ThreadsafeFunctionCallMode::NonBlocking);
                        }
                    }
                }
                sleep(Duration::from_millis(250)).await;
            }
        }));

        Ok(())
    }

    #[napi]
    pub async fn stopScan(&self) -> Result<()> {
        let adapterIndex = *self
            .adapterIndex
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        callbacks_guard(&self.callbacks).scan = None;
        if let Some(task) = watch_task_guard(&self.scan_task).take() {
            task.abort();
        }
        *self
            .scanning
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = false;

        if let Some(adapterIndex) = adapterIndex {
            let _ = adapter(adapterIndex).await?.stop_scan().await;
        }
        self.stop_watching_if_idle();
        Ok(())
    }

    #[napi]
    pub async fn addConnect(
        &self,
        adapterIndex: u32,
        callback: ThreadsafeFunction<String, (), String, napi::Status, false>,
    ) -> Result<()> {
        callbacks_guard(&self.callbacks).connect = Some(callback);
        self.start_watching(adapterIndex).await
    }

    #[napi]
    pub async fn removeConnect(&self) {
        callbacks_guard(&self.callbacks).connect = None;
        self.stop_watching_if_idle();
    }

    #[napi]
    pub async fn addDisconnect(
        &self,
        adapterIndex: u32,
        callback: ThreadsafeFunction<String, (), String, napi::Status, false>,
    ) -> Result<()> {
        callbacks_guard(&self.callbacks).disconnect = Some(callback);
        self.start_watching(adapterIndex).await
    }

    #[napi]
    pub async fn removeDisconnect(&self) {
        callbacks_guard(&self.callbacks).disconnect = None;
        self.stop_watching_if_idle();
    }

    #[napi]
    pub async fn addServicesModified(
        &self,
        adapterIndex: u32,
        callback: ThreadsafeFunction<String, (), String, napi::Status, false>,
    ) -> Result<()> {
        callbacks_guard(&self.callbacks).services_modified = Some(callback);
        self.start_watching(adapterIndex).await
    }

    #[napi]
    pub async fn removeServicesModified(&self) {
        callbacks_guard(&self.callbacks).services_modified = None;
        self.stop_watching_if_idle();
    }
}

impl Drop for AdapterEmitter {
    fn drop(&mut self) {
        if let Some(task) = watch_task_guard(&self.watch_task).take() {
            task.abort();
        }
        if let Some(task) = watch_task_guard(&self.scan_task).take() {
            task.abort();
        }
    }
}

#[napi(js_name = "nativeGetDevices")]
pub async fn getDevices(adapterIndex: Option<u32>) -> Result<Vec<BluetoothDevice>> {
    let central = adapter(adapterIndex.unwrap_or(0)).await?;
    let peripherals = central.peripherals().await.unwrap();
    let mut devices = Vec::with_capacity(peripherals.len());
    for peripheral in peripherals {
        devices.push(BluetoothDevice::new(peripheral).await);
    }

    Ok(devices)
}

#[napi]
pub async fn getAdapters() -> Result<Vec<BluetoothAdapterInfo>> {
    let manager = Manager::new()
        .await
        .map_err(|err| Error::from_reason(format!("getAdapters error: {err}")))?;
    let adapters = manager
        .adapters()
        .await
        .map_err(|err| Error::from_reason(format!("getAdapters error: {err}")))?;

    Ok(adapters
        .into_iter()
        .enumerate()
        .map(|(index, adapter)| BluetoothAdapterInfo {
            index: index as u32,
            address: format!("{adapter:?}"),
            active: true,
        })
        .collect())
}

#[napi]
pub async fn getAvailability(adapterIndex: u32) -> Result<bool> {
    Ok(adapter(adapterIndex).await.is_ok())
}
