#![allow(non_snake_case)]

mod bluetooth_device;

use bluetooth_device::BluetoothDevice;
use btleplug::api::{Central, Manager as _, ScanFilter};
use btleplug::platform::Manager;
use napi::{Error, Result};
use napi_derive::napi;
use std::time::Duration;
use tokio::time;

#[napi(js_name = "nativeGetDevices")]
pub async fn getDevices() -> Result<Vec<BluetoothDevice>> {
    let manager = Manager::new().await.unwrap();

    // get the first bluetooth adapter
    let adapters = manager
        .adapters()
        .await
        .map_err(|err| Error::from_reason(err.to_string()))?;
    let central = adapters.into_iter().nth(0).unwrap();

    // start scanning for devices
    central
        .start_scan(ScanFilter::default())
        .await
        .map_err(|err| Error::from_reason(err.to_string()))?;
    // instead of waiting, you can use central.events() to get a stream which will
    // notify you of new devices, for an example of that see examples/event_driven_discovery.rs
    time::sleep(Duration::from_secs(2)).await;

    let peripherals = central.peripherals().await.unwrap();
    let mut devices = Vec::with_capacity(peripherals.len());
    for peripheral in peripherals {
        devices.push(BluetoothDevice::new(peripheral).await);
    }

    Ok(devices)
}
