export interface BleDevice {
  deviceId: string;
  name?: string;
  rssi?: number;
}

export interface SensorData {
    type?: string;
    ph?: number;
    do_conc?: number;
    do_sat?: number;
    temp?: number;
    timestamp?: string;
    status?: string;
    readings_count?: { ph: number; do: number };
    errors_count?: { ph: number; do: number };
    wifi_status?: 'connected' | 'disconnected' | 'connecting';
    altitude_meters?: number;
    altitude_info?: {
      meters?: number;
      correction_factor?: number;
      status?: string;
    };
}

export type ConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';

export const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const UART_TX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notificaciones (ESP32 -> App)
export const UART_RX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Escrituras (App -> ESP32)

export const SCAN_DURATION_MS = 10000;
export const CONNECTION_TIMEOUT_MS = 15000;
export const CHUNK_SIZE = 512;
export const CHUNK_DELAY_MS = 100;
