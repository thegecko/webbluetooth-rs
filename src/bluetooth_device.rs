use btleplug::api::Peripheral as _;
use btleplug::platform;
use napi_derive::napi;

#[napi]
pub struct BluetoothDevice {
    #[napi(writable = false)]
    pub id: String,
    #[napi(writable = false)]
    pub name: String,
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
            name,
        }
    }
}
