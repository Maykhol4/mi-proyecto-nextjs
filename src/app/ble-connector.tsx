'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Bluetooth, Settings, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

// --- DEFINICIONES DE TIPO MANUALES ---
interface BleDevice {
  deviceId: string;
  name?: string;
}

interface ScanResult {
  device: BleDevice;
  localName?: string;
  // ...otros campos si son necesarios
}

interface BleClient {
  initialize(options?: { androidNeverForLocation?: boolean }): Promise<void>;
  requestDevice(options?: { services?: string[]; name?: string; namePrefix?: string, acceptAllDevices?: boolean, optionalServices?: string[] }): Promise<BleDevice>;
  connect(deviceId: string, onDisconnect?: () => void): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  startNotifications(
    deviceId: string,
    service: string,
    characteristic: string,
    onPacket: (value: DataView) => void
  ): Promise<void>;
  requestLEScan(options: { services?: string[] }, onResult: (result: ScanResult) => void): Promise<void>;
  stopLEScan(): Promise<void>;
}


export interface SensorData {
  ph: number | null;
  do_conc: number | null;
  do_sat: number | null;
  temp: number | null;
  timestamp: string;
  status: '🟢' | '🟡' | '🔴' | string;
  readings_count: { ph: number; do: number };
  errors_count: { ph: number; do: number };
  simulation_cycle: number;
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
  simulation_cycle: 0,
};

// --- Constantes ---
const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const SCAN_DURATION_MS = 5000;

// --- Props del Componente ---
interface BleConnectorProps {
  setSensorData: (data: SensorData) => void;
  setIsConnected: (isConnected: boolean) => void;
  setInitialSensorData: () => void;
}

export const BleConnector: React.FC<BleConnectorProps> = ({ 
  setSensorData,
  setIsConnected,
  setInitialSensorData
}) => {
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isBleInitialized, setIsBleInitialized] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [deviceName, setDeviceName] = useState('AQUADATA-2.0');
  const [tempDeviceName, setTempDeviceName] = useState('AQUADATA-2.0');
  
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<BleDevice[]>([]);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const bleClientRef = useRef<BleClient | null>(null);
  const connectedDeviceRef = useRef<BleDevice | null>(null);
  const receivedDataBuffer = useRef('');

  useEffect(() => {
    const initializeBle = async () => {
      if (typeof window !== 'undefined') {
        try {
          const { Capacitor } = await import('@capacitor/core');
          if (Capacitor.isNativePlatform()) {
            const { BleClient } = await import('@capacitor-community/bluetooth-le');
            bleClientRef.current = BleClient;
            await bleClientRef.current.initialize({ androidNeverForLocation: true });
            toast({ title: 'Modo Nativo', description: 'Usando el plugin de Capacitor BLE.' });
          } else {
            if (navigator.bluetooth) {
              bleClientRef.current = createWebBluetoothAdapter();
              await bleClientRef.current.initialize();
              toast({ title: 'Modo Web', description: 'Usando la Web Bluetooth API del navegador.' });
            } else {
               throw new Error('Bluetooth no es soportado en este navegador.');
            }
          }
          setIsBleInitialized(true);
        } catch (error) {
          console.error('Error inicializando Bluetooth:', error);
          toast({ variant: 'destructive', title: 'Error de Bluetooth', description: (error as Error).message });
        }
      }
    };
    
    initializeBle();

    const savedName = localStorage.getItem('bleDeviceName');
    if (savedName) {
      setDeviceName(savedName);
      setTempDeviceName(savedName);
    }
  }, [toast]);

  const onDisconnected = useCallback(() => {
    connectedDeviceRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
    setInitialSensorData();
    toast({
      title: 'Desconectado',
      description: 'El dispositivo Bluetooth ha sido desconectado.',
    });
  }, [toast, setIsConnected, setInitialSensorData]);

  const handleData = useCallback((data: SensorData) => {
    setSensorData(data);
  }, [setSensorData]);

  const handleNotifications = (value: DataView) => {
    const decoder = new TextDecoder();
    receivedDataBuffer.current += decoder.decode(value);
    const lastNewline = receivedDataBuffer.current.lastIndexOf('\n');
    if (lastNewline !== -1) {
      const completeMessages = receivedDataBuffer.current.substring(0, lastNewline);
      receivedDataBuffer.current = receivedDataBuffer.current.substring(lastNewline + 1);

      completeMessages.split('\n').forEach(message => {
        if (message) {
          try {
            const jsonData: SensorData = JSON.parse(message);
            handleData(jsonData);
          } catch (error) {
            console.error('Fallo al parsear JSON:', error, 'Mensaje:', `"${message}"`);
          }
        }
      });
    }
  };
  
  const connectToDevice = async (device: BleDevice) => {
    if (!bleClientRef.current) return;
    
    setIsScanModalOpen(false);
    setIsConnecting(true);
    
    if (isScanning && bleClientRef.current.stopLEScan) {
        await bleClientRef.current.stopLEScan();
        setIsScanning(false);
        if(scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    }

    try {
      await bleClientRef.current.connect(device.deviceId, onDisconnected);
      connectedDeviceRef.current = device;
      
      // La conexión fue exitosa, ahora verificamos que tiene el servicio UART
      await bleClientRef.current.startNotifications(
        device.deviceId, UART_SERVICE_UUID, UART_TX_CHARACTERISTIC_UUID, handleNotifications
      );

      setIsConnected(true);
      toast({ title: '¡Conectado!', description: `Conectado exitosamente a ${device.name || device.deviceId}.` });
    } catch (error) {
      console.error('La conexión falló:', error);
      toast({ variant: 'destructive', title: 'Conexión Fallida', description: 'No se pudo conectar o el dispositivo no tiene el servicio requerido.' });
      handleDisconnect(); // Asegurarse de limpiar el estado si falla
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnect = async () => {
    if (!bleClientRef.current || !isBleInitialized) {
      toast({ variant: 'destructive', title: 'Bluetooth no listo', description: 'El adaptador Bluetooth no se ha inicializado.' });
      return;
    }

    // El flujo para Web Bluetooth sigue siendo el mismo.
    if ('requestLEScan' in bleClientRef.current === false) {
      setIsConnecting(true);
      try {
        const device = await bleClientRef.current.requestDevice({
          acceptAllDevices: true,
          optionalServices: [UART_SERVICE_UUID],
        });
        await connectToDevice(device);
      } catch (error) {
        console.error("Fallo al solicitar dispositivo:", error);
        toast({ variant: 'destructive', title: 'Solicitud Fallida', description: 'No se seleccionó ningún dispositivo.' });
      } finally {
        setIsConnecting(false);
      }
      return;
    }

    // Nuevo flujo de escaneo para nativo.
    setIsScanning(true);
    setIsScanModalOpen(true);
    setScanResults([]);

    const onDeviceFound = (result: ScanResult) => {
      setScanResults(prev => {
        if (!prev.find(d => d.deviceId === result.device.deviceId)) {
          return [...prev, { deviceId: result.device.deviceId, name: result.device.name || result.localName }];
        }
        return prev;
      });
    };

    try {
      // Escanear sin filtros de servicio para encontrar todos los dispositivos
      await bleClientRef.current.requestLEScan({ services: [] }, onDeviceFound);
      
      scanTimeoutRef.current = setTimeout(async () => {
        if (bleClientRef.current?.stopLEScan) {
          await bleClientRef.current.stopLEScan();
          setIsScanning(false);
          if (scanResults.length === 0) {
            toast({ title: "Búsqueda finalizada", description: `No se encontraron dispositivos.`});
          }
        }
      }, SCAN_DURATION_MS);

    } catch(error) {
      console.error("Fallo al escanear:", error);
      toast({ variant: 'destructive', title: 'Error de Escaneo', description: 'No se pudo iniciar el escaneo.' });
      setIsScanning(false);
      setIsScanModalOpen(false);
    }
  };

  const handleDisconnect = async () => {
    if (bleClientRef.current && connectedDeviceRef.current) {
        try {
            await bleClientRef.current.disconnect(connectedDeviceRef.current.deviceId);
        } catch(error) {
            console.error("Fallo al desconectar", error);
        }
    }
    onDisconnected();
  };

  const handleSaveSettings = () => {
    setDeviceName(tempDeviceName);
    localStorage.setItem('bleDeviceName', tempDeviceName);
    setIsSettingsOpen(false);
    toast({ title: 'Ajustes Guardados', description: `Nombre del dispositivo actualizado a ${tempDeviceName}.` });
  };
  
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [containerConnected, setContainerConnected] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setContainer(document.getElementById('ble-actions-container'));
    setContainerConnected(document.getElementById('ble-actions-container-connected'));
  }, []);

  return (
    <>
      {container && createPortal(
        <>
          <div className="flex items-center justify-center space-x-2 text-muted-foreground">
            <Bluetooth className="w-5 h-5" />
            <span>Conéctese a su dispositivo AQUADATA</span>
          </div>
          <Button onClick={handleConnect} disabled={isConnecting || !isBleInitialized || isScanning} className="w-full h-12 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold rounded-lg shadow-lg transition-all duration-200 transform hover:scale-105">
            {isConnecting ? <><RefreshCw className="w-5 h-5 mr-2 animate-spin" />Conectando...</> : <><Search className="w-5 h-5 mr-2" />Buscar y Conectar</>}
          </Button>
          <div className="text-sm text-muted-foreground flex items-center justify-center space-x-1">
            <span>¿Problemas de conexión?</span>
            <button onClick={() => setIsSettingsOpen(true)} className="text-blue-600 hover:text-blue-700 underline">Cambiar nombre</button>
          </div>
        </>,
        container
      )}

      {containerConnected && createPortal(
        <>
            <Button variant="outline" size="icon" onClick={() => setIsSettingsOpen(true)}><Settings className="w-4 h-4" /><span className="sr-only">Configuración</span></Button>
            <Button onClick={handleDisconnect} variant="destructive" size="sm">Desconectar</Button>
        </>,
        containerConnected
      )}

      <Dialog open={isScanModalOpen} onOpenChange={setIsScanModalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Buscando Dispositivos...</DialogTitle></DialogHeader>
          <div className="py-4 space-y-4">
            {isScanning && <div className="flex items-center justify-center space-x-2"><RefreshCw className="w-4 h-4 animate-spin" /><span>Buscando por {SCAN_DURATION_MS / 1000}s...</span></div>}
            <div className="max-h-60 overflow-y-auto space-y-2">
              {scanResults.length > 0 ? scanResults.map(device => (
                <div key={device.deviceId} className="flex items-center justify-between p-2 border rounded-lg">
                  <span>{device.name || 'Dispositivo Desconocido'} <small className="text-muted-foreground">{device.deviceId}</small></span>
                  <Button size="sm" onClick={() => connectToDevice(device)}>Conectar</Button>
                </div>
              )) : (
                !isScanning && <p className="text-center text-muted-foreground">No se encontraron dispositivos. Asegúrese de que esté encendido y cerca.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsScanModalOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ajustes de Bluetooth</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="device-name" className="text-right">Nombre del Dispositivo</Label>
              <Input id="device-name" value={tempDeviceName} onChange={(e) => setTempDeviceName(e.target.value)} className="col-span-3"/>
            </div>
            <p className="col-span-4 text-sm text-muted-foreground text-center">Nota: Este nombre no se usa para filtrar en el escaneo nativo.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSettingsOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveSettings}>Guardar Cambios</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

function createWebBluetoothAdapter(): BleClient {
  let webDevice: BluetoothDevice | null = null;
  let onDisconnectCallback: (() => void) | null = null;
  
  const handleGattServerDisconnected = () => {
    webDevice = null;
    if (onDisconnectCallback) onDisconnectCallback();
  };

  return {
    initialize: () => Promise.resolve(),
    requestDevice: async (options) => {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: options.acceptAllDevices,
        optionalServices: options.optionalServices,
      });
      if (!device.name || !device.id) throw new Error("El dispositivo seleccionado no es válido.");
      webDevice = device;
      return { deviceId: device.id, name: device.name };
    },
    connect: async (deviceId, onDisconnect) => {
      if (!webDevice || webDevice.id !== deviceId || !webDevice.gatt) throw new Error("No se pudo obtener el dispositivo para la conexión GATT.");
      onDisconnectCallback = onDisconnect;
      webDevice.addEventListener('gattserverdisconnected', handleGattServerDisconnected);
      await webDevice.gatt.connect();
    },
    disconnect: async (deviceId) => {
      if (!webDevice?.gatt?.connected || webDevice.id !== deviceId) return;
      webDevice.gatt.disconnect();
      webDevice.removeEventListener('gattserverdisconnected', handleGattServerDisconnected);
      handleGattServerDisconnected();
    },
    startNotifications: async (deviceId, serviceUUID, characteristicUUID, callback) => {
       if (!webDevice?.gatt?.connected || webDevice.id !== deviceId) throw new Error("Servidor GATT no conectado.");
       const service = await webDevice.gatt.getPrimaryService(serviceUUID);
       const characteristic = await service.getCharacteristic(characteristicUUID);
       characteristic.addEventListener('characteristicvaluechanged', (event) => {
         const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
         if (value) callback(value);
       });
       await characteristic.startNotifications();
    },
    // Estas funciones no son parte de Web Bluetooth, las dejamos para compatibilidad de tipos
    requestLEScan: () => { throw new Error('requestLEScan no está implementado para Web Bluetooth'); },
    stopLEScan: () => { throw new Error('stopLEScan no está implementado para Web Bluetooth'); }
  };
}