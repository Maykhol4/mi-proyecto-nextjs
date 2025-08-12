import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.getcapacitor.myapp',
  appName: 'AQUADATA 2.0',
  webDir: 'out',
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: "Buscando dispositivos BLE...",
        cancel: "Cancelar",
        ok: "OK",
        connect: "Conectar",
        disconnect: "Desconectar"
      }
    }
  }
};

export default config;
