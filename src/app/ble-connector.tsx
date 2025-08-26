
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

// Interfaces
interface BleDevice {
  deviceId: string;
  name?: string;
}

interface ScanResult {
  device: BleDevice;
  localName?: string;
  // WebBluetooth specific
  rssi?: number;
  txPower?: number;
}

interface BleClient {
  initialize(options?: { androidNeverForLocation?: boolean }): Promise<void>;
  requestDevice(options?: { 
    services?: string[]; 
    name?: string; 
    namePrefix?: string; 
    acceptAllDevices?: boolean; 
    optionalServices?: string[] 
  }): Promise<BleDevice>;
  connect(deviceId: string, onDisconnect?: () => void, targetDevice?: BluetoothDevice): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  startNotifications(
    deviceId: string,
    service: string,
    characteristic: string,
    onPacket: (value: DataView) => void
  ): Promise<void>;
  write(
    deviceId: string,
    service: string,
    characteristic: string,
    value: string | DataView | ArrayBuffer,
  ): Promise<void>;
  requestLEScan?(options: { services?: string[], acceptAllDevices?: boolean }, onResult: (result: ScanResult) => void): Promise<void>;
  stopLEScan?(): Promise<void>;
  requestPermissions?(): Promise<void>;
  isEnabled?(): Promise<{ value: boolean }>;
  isGattServerDisconnected?(): boolean;
  getConnectedDevices?(services: string[]): Promise<{devices: BleDevice[]}>;
}

export interface SensorData {
  ph: number | null;
  do_conc: number | null;
  do_sat: number | null;
  temp: number | null;
  timestamp: string;
  status: string;
  readings_count?: { ph: number; do: number };
  errors_count?: { ph: number; do: number };
  type?: string;
  message?: string;
  wifi_status?: 'connected' | 'disconnected' | 'connecting';
  iso_timestamp?: string;
}

export const initialSensorData: SensorData = {
  ph: null,
  do_conc: null,
  do_sat: null,
  temp: null,
  timestamp: '--:--:--',
  status: '⚪',
  readings_count: { ph: 0, do: 0 },
  errors_count: { ph: 0, do: 0 },
  wifi_status: 'disconnected',
};

// Constantes
const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const UART_RX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const SCAN_DURATION_MS = 10000;
const CONNECTION_TIMEOUT_MS = 15000;
const NATIVE_CONNECTION_MONITOR_INTERVAL_MS = 3000; // Check connection every 3 seconds
const CHUNK_SIZE = 20; // Tamaño del chunk en bytes
const CHUNK_DELAY_MS = 100; // Retraso entre chunks

export interface BleConnectorRef {
    handleDisconnect: () => Promise<void>;
    sendWifiConfig: (ssid: string, psk: string) => Promise<void>;
    getIsConnecting: () => boolean;
    handleConnect: () => Promise<void>;
}

interface BleConnectorProps {
  setSensorData: (data: SensorData) => void;
  setIsConnected: (isConnected: boolean) => void;
  setInitialSensorData: () => void;
}

export const BleConnector = React.forwardRef<BleConnectorRef, BleConnectorProps>(({
  setSensorData,
  setIsConnected,
  setInitialSensorData,
}, ref) => {
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isBleInitialized, setIsBleInitialized] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<Map<string, BleDevice>>(new Map());
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  
  const bleClientRef = useRef<BleClient | null>(null);
  const connectedDeviceRef = useRef<BleDevice | null>(null);
  const receivedDataBuffer = useRef('');
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionMonitorRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const isNativePlatform = useRef(false);

  // Store web bluetooth devices to pass to connect method
  const webBleDevicesRef = useRef<Map<string, BluetoothDevice>>(new Map());

  // Cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
      if (connectionMonitorRef.current) clearInterval(connectionMonitorRef.current);
      if (connectedDeviceRef.current && bleClientRef.current) {
        bleClientRef.current.disconnect(connectedDeviceRef.current.deviceId).catch(console.error);
      }
    };
  }, []);

  // Inicialización mejorada
  useEffect(() => {
    const initializeBle = async () => {
      if (typeof window === 'undefined') return;

      try {
        const { Capacitor } = await import('@capacitor/core');
        
        if (Capacitor.isNativePlatform()) {
          isNativePlatform.current = true;
          const { BleClient } = await import('@capacitor-community/bluetooth-le');
          bleClientRef.current = BleClient;
          
          try {
            if (bleClientRef.current.requestPermissions) {
              await bleClientRef.current.requestPermissions();
              console.log('✅ Permisos BLE concedidos');
            }
          } catch (permError) {
            console.error('❌ Error solicitando permisos:', permError);
            toast({ 
              variant: 'destructive', 
              title: 'Permisos Requeridos', 
              description: 'Se necesitan permisos de Bluetooth y ubicación para funcionar.' 
            });
            return;
          }

          try {
            if (bleClientRef.current.isEnabled) {
              const enabled = await bleClientRef.current.isEnabled();
              if (!enabled.value) {
                toast({ 
                  variant: 'destructive', 
                  title: 'Bluetooth Deshabilitado', 
                  description: 'Por favor, habilita Bluetooth en configuración.' 
                });
                return;
              }
            }
          } catch (enableError) {
            console.warn('⚠️ No se pudo verificar estado de Bluetooth:', enableError);
          }

          await bleClientRef.current.initialize({ androidNeverForLocation: false });
          
          if (isMountedRef.current) {
            setIsBleInitialized(true);
            toast({ 
              title: 'BLE Nativo Listo', 
              description: 'Plugin de Capacitor inicializado correctamente.' 
            });
          }
        } else {
          isNativePlatform.current = false;
          // Plataforma web
          if (!navigator.bluetooth) {
            throw new Error('Web Bluetooth no es compatible con este navegador.');
          }
          
          bleClientRef.current = createWebBluetoothAdapter(webBleDevicesRef);
          await bleClientRef.current.initialize();
          
          if (isMountedRef.current) {
            setIsBleInitialized(true);
            toast({ 
              title: 'Web Bluetooth Listo', 
              description: 'Usando Web Bluetooth API del navegador.' 
            });
          }
        }
      } catch (error) {
        console.error('Error inicializando Bluetooth:', error);
        if (isMountedRef.current) {
          toast({ 
            variant: 'destructive', 
            title: 'Error de Bluetooth', 
            description: `No se pudo inicializar BLE: ${(error as Error).message}` 
          });
        }
      }
    };

    initializeBle();
  }, [toast]);

  const onDisconnected = useCallback(() => {
    if (!isMountedRef.current) return;
    
    // Only show toast if there was a device connected
    if (connectedDeviceRef.current) {
        toast({
            title: 'Desconectado',
            description: 'El dispositivo Bluetooth se ha desconectado.',
        });
    }
    
    console.log("Device disconnected. Cleaning up state.");

    if (connectionMonitorRef.current) {
      clearInterval(connectionMonitorRef.current);
      connectionMonitorRef.current = null;
    }
    
    connectedDeviceRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
    setInitialSensorData();
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    // Reset state variables
    connectedDeviceRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
    
    // Clear data buffer
    receivedDataBuffer.current = '';
    
    // Reset sensor data on UI
    setInitialSensorData();
    
  }, [toast, setIsConnected, setInitialSensorData]);


  const handleData = useCallback((data: SensorData) => {
    if (isMountedRef.current) {
      setSensorData(data);
    }
  }, [setSensorData]);

  const handleNotifications = useCallback((value: DataView) => {
    try {
      const decoder = new TextDecoder();
      receivedDataBuffer.current += decoder.decode(value);
      
      const lastNewline = receivedDataBuffer.current.lastIndexOf('\n');
      if (lastNewline !== -1) {
        const completeMessages = receivedDataBuffer.current.substring(0, lastNewline);
        receivedDataBuffer.current = receivedDataBuffer.current.substring(lastNewline + 1);
  
        completeMessages.split('\n').forEach(message => {
          if (message.trim()) {
            try {
              const jsonData = JSON.parse(message);
              console.log('📦 Mensaje recibido:', jsonData);
              
              if (jsonData.type && ['wifi_config_response', 'wifi_disconnect_response', 'mode_change_response'].includes(jsonData.type)) {
                  toast({
                      title: 'Respuesta del Dispositivo',
                      description: jsonData.message || 'Comando procesado.',
                      variant: jsonData.status === 'success' ? 'default' : 'destructive'
                  });
              }
              
              const hasSensorData = typeof jsonData.ph !== 'undefined' || 
                                   typeof jsonData.do_conc !== 'undefined' ||
                                   typeof jsonData.temp !== 'undefined' ||
                                   typeof jsonData.timestamp !== 'undefined';
              
              if (hasSensorData) {
                  console.log('🔬 Procesando datos de sensores:', jsonData);
                  handleData(jsonData as SensorData);
              }
  
            } catch (parseError) {
              console.warn('Error parseando JSON:', parseError, 'Mensaje:', `"${message}"`);
            }
          }
        });
      }
    } catch (error) {
      console.error('Error procesando notificación BLE:', error);
    }
  }, [handleData, toast]);


  const stopScanning = useCallback(async () => {
    if (!isScanning || !bleClientRef.current?.stopLEScan) return;
    
    try {
      await bleClientRef.current.stopLEScan();
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
    } catch (error) {
      console.error('Error deteniendo escaneo:', error);
    } finally {
      if (isMountedRef.current) {
        setIsScanning(false);
      }
    }
  }, [isScanning]);
  
  const handleDisconnect = useCallback(async () => {
    if (bleClientRef.current && connectedDeviceRef.current) {
      try {
        await bleClientRef.current.disconnect(connectedDeviceRef.current.deviceId);
      } catch (error) {
        console.error("Error desconectando:", error);
      }
    }
    // Forzar reseteo de estado independientemente del resultado para permitir reconexión.
    onDisconnected();
  }, [onDisconnected]);

  const startConnectionMonitor = useCallback(() => {
    if (!isNativePlatform.current || connectionMonitorRef.current) return;

    console.log("Starting native connection monitor...");

    connectionMonitorRef.current = setInterval(async () => {
      if (!bleClientRef.current?.getConnectedDevices || !connectedDeviceRef.current) {
        if(connectionMonitorRef.current) clearInterval(connectionMonitorRef.current);
        return;
      }
      try {
        const { devices } = await bleClientRef.current.getConnectedDevices([UART_SERVICE_UUID]);
        const isStillConnected = devices.some(d => d.deviceId === connectedDeviceRef.current?.deviceId);

        if (!isStillConnected) {
          console.log("Monitor detected disconnection.");
          onDisconnected();
        }
      } catch (error) {
        console.error("Connection monitor error:", error);
        onDisconnected();
      }
    }, NATIVE_CONNECTION_MONITOR_INTERVAL_MS);
  }, [onDisconnected]);

  const connectToDevice = async (device: BleDevice) => {
    if (!bleClientRef.current || !isMountedRef.current) return;

    if (isConnecting || connectedDeviceRef.current) {
        const reason = isConnecting ? "conexión ya en progreso" : "ya hay un dispositivo conectado";
        console.warn(`Intento de conexión ignorado: ${reason}.`);
        return;
    }

    setIsScanModalOpen(false);
    setIsConnecting(true);

    if (isScanning) {
      await stopScanning();
    }

    connectionTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current && isConnecting) {
        toast({
          variant: 'destructive',
          title: 'Timeout de Conexión',
          description: 'La conexión tardó demasiado tiempo.',
        });
        handleDisconnect();
      }
    }, CONNECTION_TIMEOUT_MS);

    try {
      console.log(`🔗 Intentando conectar a: ${device.name} (${device.deviceId})`);
      
      const webDevice = webBleDevicesRef.current.get(device.deviceId);

      await bleClientRef.current.connect(device.deviceId, onDisconnected, webDevice);
      console.log("✅ Conexión física establecida. Esperando para iniciar servicios...");
      connectedDeviceRef.current = device;

      // **FIX:** Add a small delay on native platforms before starting notifications
      if (isNativePlatform.current) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      try {
        console.log("⏳ Iniciando notificaciones BLE...");
        await bleClientRef.current.startNotifications(
          device.deviceId, 
          UART_SERVICE_UUID, 
          UART_TX_CHARACTERISTIC_UUID, 
          handleNotifications
        );
        console.log('✅ Notificaciones BLE iniciadas correctamente.');
      } catch (serviceError) {
        console.error("❌ Error al iniciar notificaciones:", serviceError);
        throw new Error('No se pudo iniciar la comunicación. El dispositivo no tiene el servicio UART requerido.');
      }

      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      
      if (isMountedRef.current) {
        setIsConnected(true);
        if (isNativePlatform.current) {
          startConnectionMonitor(); // Start monitor for native platforms
        }
        toast({ 
          title: '¡Conectado!', 
          description: `Conectado exitosamente a ${device.name || device.deviceId}.` 
        });
      }
    } catch (error) {
      console.error('Error en conexión:', error);
      if (isMountedRef.current) {
        toast({ 
          variant: 'destructive', 
          title: 'Conexión Fallida', 
          description: (error as Error).message 
        });
      }
      await handleDisconnect();
    } finally {
      if (isMountedRef.current) {
        setIsConnecting(false);
      }
    }
  };

  const handleConnect = async () => {
    if (!bleClientRef.current || !isBleInitialized || !isMountedRef.current) {
      toast({ 
        variant: 'destructive', 
        title: 'Bluetooth no listo', 
        description: 'El adaptador Bluetooth no se ha inicializado.' 
      });
      return;
    }
  
    if (connectedDeviceRef.current || isConnecting || isScanning) {
      console.warn("Ya hay un dispositivo conectado o una operación en curso.");
      return;
    }
    
    // Native path with custom modal
    if (isNativePlatform.current && bleClientRef.current.requestLEScan) {
      setIsScanning(true);
      setIsScanModalOpen(true);
      setScanResults(new Map());
    
      const onDeviceFound = (result: ScanResult) => {
        if (!isMountedRef.current || !result.device?.deviceId) return;
        
        setScanResults(prev => {
          const newMap = new Map(prev);
          if (!newMap.has(result.device.deviceId)) {
             const deviceName = result.device.name || result.localName || 'Dispositivo Desconocido';
             console.log(`📱 Dispositivo encontrado: ${deviceName} (${result.device.deviceId})`);
             newMap.set(result.device.deviceId, {
               deviceId: result.device.deviceId,
               name: deviceName,
             });
          }
          return newMap;
        });
      };
    
      try {
        await bleClientRef.current.requestLEScan({ acceptAllDevices: true }, onDeviceFound);
        console.log('🔍 Iniciando escaneo BLE nativo...');
    
        scanTimeoutRef.current = setTimeout(async () => {
          await stopScanning();
          if (isMountedRef.current && scanResults.size === 0) {
            toast({ 
              title: "Búsqueda finalizada", 
              description: "No se encontraron dispositivos. Verifica que el dispositivo esté encendido."
            });
          }
        }, SCAN_DURATION_MS);
    
      } catch (error) {
        console.error("Error iniciando escaneo nativo:", error);
        if (isMountedRef.current) {
          toast({ 
            variant: 'destructive', 
            title: 'Error de Escaneo', 
            description: `No se pudo iniciar la búsqueda: ${(error as Error).message}` 
          });
          setIsScanning(false);
          setIsScanModalOpen(false);
        }
      }
    } else { // Web path with browser prompt
      try {
        const device = await bleClientRef.current.requestDevice({
          acceptAllDevices: true,
          optionalServices: [UART_SERVICE_UUID]
        });
        if (device) {
          await connectToDevice(device);
        }
      } catch (error) {
        const errorMessage = (error as Error).message.toLowerCase();
        if (!errorMessage.includes('user cancelled')) {
          toast({ 
            variant: 'destructive', 
            title: 'Error de Conexión Web', 
            description: (error as Error).message 
          });
        }
      }
    }
  };
  
  const sendCommand = async (command: object) => {
      if (!bleClientRef.current || !connectedDeviceRef.current) {
          toast({ variant: 'destructive', title: 'Error', description: 'No hay un dispositivo conectado.' });
          return;
      }
      if (isNativePlatform.current === false && bleClientRef.current.isGattServerDisconnected && bleClientRef.current.isGattServerDisconnected()) {
          toast({
              variant: 'destructive',
              title: 'Desconectado',
              description: 'El dispositivo se ha desconectado. Por favor, vuelve a conectar.'
          });
          onDisconnected();
          return;
      }
      
      const jsonCommand = JSON.stringify(command) + '\n';
      const encoder = new TextEncoder();
      const encodedData = encoder.encode(jsonCommand);

      console.log(`📤 Enviando comando (longitud: ${encodedData.byteLength} bytes):`, jsonCommand.trim());

      try {
          for (let i = 0; i < encodedData.byteLength; i += CHUNK_SIZE) {
              const chunkBuffer = encodedData.slice(i, i + CHUNK_SIZE);
              console.log(`📦 Enviando chunk #${i / CHUNK_SIZE + 1} (${chunkBuffer.byteLength} bytes)`);

              const dataToWrite = isNativePlatform.current ? new DataView(chunkBuffer.buffer) : chunkBuffer.buffer;
              
              await bleClientRef.current.write(
                  connectedDeviceRef.current.deviceId,
                  UART_SERVICE_UUID,
                  UART_RX_CHARACTERISTIC_UUID,
                  dataToWrite
              );

              await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY_MS));
          }
          console.log("✅ Comando enviado completamente.");
      } catch (error) {
          console.error("Error enviando comando:", error);
          const errorMessage = (error as Error).message;
          toast({ 
            variant: 'destructive', 
            title: 'Error de Envío', 
            description: errorMessage 
          });
          if (errorMessage.toLowerCase().includes('disconnected')) {
              onDisconnected();
          }
      }
  };


  const sendWifiConfig = async (ssid: string, psk: string) => {
    await sendCommand({ type: 'wifi_config', ssid: ssid, password: psk });
    toast({ title: 'Comando Enviado', description: 'Configuración WiFi enviada al dispositivo.' });
  };
  
  React.useImperativeHandle(ref, () => ({
      handleDisconnect,
      sendWifiConfig,
      getIsConnecting: () => isConnecting || isScanning,
      handleConnect,
  }));

  const handleScanModalClose = async () => {
    if (isScanning) {
      await stopScanning();
    }
    setIsScanModalOpen(false);
  };
  
  const scanResultsArray = Array.from(scanResults.values());

  return (
    <>
      <Dialog open={isScanModalOpen} onOpenChange={handleScanModalClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispositivos BLE Encontrados</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {isScanning && (
              <div className="flex items-center justify-center space-x-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Buscando dispositivos... ({SCAN_DURATION_MS / 1000}s)</span>
              </div>
            )}
            <div className="max-h-60 overflow-y-auto space-y-2">
              {scanResultsArray.length > 0 ? (
                scanResultsArray.map(device => (
                  <div key={device.deviceId} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex-1">
                      <div className="font-medium">
                        {device.name}
                      </div>
                      <div className="text-sm text-muted-foreground">{device.deviceId}</div>
                    </div>
                    <Button 
                      size="sm" 
                      onClick={() => connectToDevice(device)}
                      disabled={isConnecting}
                    >
                      {isConnecting ? 'Conectando...' : 'Conectar'}
                    </Button>
                  </div>
                ))
              ) : (
                !isScanning && (
                  <p className="text-center text-muted-foreground py-4">
                    No se encontraron dispositivos. <br/>
                    Verifica que tu dispositivo esté encendido y cerca.
                  </p>
                )
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleScanModalClose}>
              {isScanning ? 'Cancelar Búsqueda' : 'Cerrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
BleConnector.displayName = "BleConnector";

function createWebBluetoothAdapter(webBleDevicesRef: React.MutableRefObject<Map<string, BluetoothDevice>>): BleClient {
  let onDisconnectCallback: (() => void) | null = null;
  let txCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  let rxCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;

  const handleGattServerDisconnected = (event: Event) => {
    const device = event.target as BluetoothDevice;
    console.log(`GATT server disconnected for device: ${device.id}`);
    webBleDevicesRef.current.delete(device.id);
    if (onDisconnectCallback) {
      onDisconnectCallback();
    }
    txCharacteristic = null;
    rxCharacteristic = null;
  };
  
  return {
    initialize: () => Promise.resolve(),

    requestDevice: async (options) => {
       try {
            const device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: options?.acceptAllDevices,
                optionalServices: options?.optionalServices
            });
            webBleDevicesRef.current.set(device.id, device);
            return {
                deviceId: device.id,
                name: device.name,
            };
        } catch (error) {
            if ((error as Error).name === 'NotFoundError' || (error as Error).name === 'NotAllowedError') {
                throw new Error('User cancelled device selection or no devices found.');
            }
            throw error;
        }
    },
    
    connect: async (deviceId, onDisconnect, targetDevice) => {
      let deviceToConnect = targetDevice;
      
      if (!deviceToConnect) {
        deviceToConnect = webBleDevicesRef.current.get(deviceId);
      }
      
      if (!deviceToConnect) {
        throw new Error("Device not found. Must scan for it first.");
      }
      
      if (!deviceToConnect.gatt) {
        throw new Error("GATT not available on this device.");
      }

      if (deviceToConnect.gatt.connected) {
        console.log("Already connected to GATT server.");
        return;
      }
      
      onDisconnectCallback = onDisconnect || null;
      deviceToConnect.addEventListener('gattserverdisconnected', handleGattServerDisconnected);
      
      try {
        const server = await deviceToConnect.gatt.connect();
        const service = await server.getPrimaryService(UART_SERVICE_UUID);
        txCharacteristic = await service.getCharacteristic(UART_TX_CHARACTERISTIC_UUID);
        rxCharacteristic = await service.getCharacteristic(UART_RX_CHARACTERISTIC_UUID);
      } catch (error) {
        deviceToConnect.removeEventListener('gattserverdisconnected', handleGattServerDisconnected);
        throw new Error(`Error connecting and getting services/characteristics: ${(error as Error).message}`);
      }
    },
    
    disconnect: async (deviceId) => {
      const device = webBleDevicesRef.current.get(deviceId);
      if (!device?.gatt?.connected) return;
      
      device.removeEventListener('gattserverdisconnected', handleGattServerDisconnected);
      device.gatt.disconnect();
    },
    
    startNotifications: async (deviceId, serviceUUID, characteristicUUID, callback) => {
       if (!txCharacteristic) {
        throw new Error("TX characteristic not initialized.");
      }
      
      try {
        txCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
          const target = event.target as BluetoothRemoteGATTCharacteristic;
          if (target.value) {
            callback(target.value);
          }
        });
        
        await txCharacteristic.startNotifications();
      } catch (error) {
        throw new Error(`Error starting notifications: ${(error as Error).message}`);
      }
    },
    
    write: async (deviceId, serviceUUID, characteristicUUID, value) => {
        if (!rxCharacteristic) {
            throw new Error("RX characteristic not initialized.");
        }
        const device = webBleDevicesRef.current.get(deviceId);
        if (!device?.gatt?.connected) {
             throw new Error("GATT Server is disconnected. Cannot perform GATT operations. (Re)connect first with device.gatt.connect.");
        }
        try {
            const dataToWrite = typeof value === 'string' ? new TextEncoder().encode(value) : value;
            await rxCharacteristic.writeValue(dataToWrite);
        } catch(error) {
            throw new Error(`Error writing to characteristic: ${(error as Error).message}`);
        }
    },
    isGattServerDisconnected: () => {
        // This is a simplification. We'd need to track the specific connected device.
        const firstDevice = webBleDevicesRef.current.values().next().value;
        return !firstDevice?.gatt?.connected;
    }
  };
}

    