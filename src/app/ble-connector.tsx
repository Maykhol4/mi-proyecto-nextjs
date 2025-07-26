'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Bluetooth, Settings } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

// --- DEFINICIONES DE TIPO MANUALES ---
// Esto evita la importación directa que causa errores en el servidor.
interface BleDevice {
  deviceId: string;
  name?: string;
}

// Interfaz unificada para nuestro adaptador
interface BluetoothAdapter {
  initialize: () => Promise<void>;
  requestDevice: (options: { name: string; services: string[] }) => Promise<BleDevice>;
  connect: (deviceId: string, onDisconnect: () => void) => Promise<void>;
  disconnect: (deviceId: string) => Promise<void>;
  startNotifications: (deviceId: string, service: string, characteristic: string, callback: (value: DataView) => void) => Promise<void>;
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

  const adapterRef = useRef<BluetoothAdapter | null>(null);
  const connectedDeviceRef = useRef<BleDevice | null>(null);
  const receivedDataBuffer = useRef('');

  useEffect(() => {
    const initializeBle = async () => {
      if (typeof window !== 'undefined') {
        try {
          // Detección de entorno: Capacitor o Web
          const { Capacitor } = await import('@capacitor/core');
          if (Capacitor.isNativePlatform()) {
            // Entorno Nativo (APK)
            const { BleClient } = await import('@capacitor-community/bluetooth-le');
            adapterRef.current = {
              initialize: () => BleClient.initialize({ androidNeverForLocation: true }),
              requestDevice: (opts) => BleClient.requestDevice({ name: opts.name, services: opts.services }),
              connect: BleClient.connect,
              disconnect: BleClient.disconnect,
              startNotifications: BleClient.startNotifications,
            };
            toast({ title: 'Modo Nativo', description: 'Usando el plugin de Capacitor BLE.' });
          } else {
            // Entorno Web (Navegador)
            if (navigator.bluetooth) {
              adapterRef.current = createWebBluetoothAdapter();
              toast({ title: 'Modo Web', description: 'Usando la Web Bluetooth API del navegador.' });
            } else {
               throw new Error('Bluetooth no es soportado en este navegador.');
            }
          }
          await adapterRef.current.initialize();
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
  
  const handleConnect = async () => {
    if (!adapterRef.current || !isBleInitialized) {
      toast({ variant: 'destructive', title: 'Bluetooth no listo', description: 'El adaptador Bluetooth no se ha inicializado.' });
      return;
    }
    
    setIsConnecting(true);
    try {
      const device = await adapterRef.current.requestDevice({
        name: deviceName,
        services: [UART_SERVICE_UUID],
      });
      connectedDeviceRef.current = device;
      await adapterRef.current.connect(device.deviceId, onDisconnected);
      await adapterRef.current.startNotifications(
        device.deviceId, UART_SERVICE_UUID, UART_TX_CHARACTERISTIC_UUID, handleNotifications
      );

      setIsConnected(true);
      toast({ title: '¡Conectado!', description: `Conectado exitosamente a ${deviceName}.` });
    } catch (error) {
      console.error('La conexión falló:', error);
      toast({ variant: 'destructive', title: 'Conexión Fallida', description: 'No se pudo encontrar o conectar al dispositivo.' });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (adapterRef.current && connectedDeviceRef.current) {
        try {
            await adapterRef.current.disconnect(connectedDeviceRef.current.deviceId);
        } catch(error) {
            console.error("Fallo al desconectar", error);
        }
    }
    onDisconnected(); // Asegurarse de que el estado se limpie
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
            <span>Conéctese a su dispositivo {deviceName}</span>
          </div>
          <Button onClick={handleConnect} disabled={isConnecting || !isBleInitialized} className="w-full h-12 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold rounded-lg shadow-lg transition-all duration-200 transform hover:scale-105">
            {isConnecting ? <><RefreshCw className="w-5 h-5 mr-2 animate-spin" />Conectando...</> : <><Bluetooth className="w-5 h-5 mr-2" />Conectar a {deviceName}</>}
          </Button>
          <div className="text-sm text-muted-foreground flex items-center justify-center space-x-1">
            <span>¿Nombre incorrecto?</span>
            <button onClick={() => setIsSettingsOpen(true)} className="text-blue-600 hover:text-blue-700 underline">Cambiar en configuración</button>
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

      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ajustes de Bluetooth</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="device-name" className="text-right">Nombre del Dispositivo</Label>
              <Input id="device-name" value={tempDeviceName} onChange={(e) => setTempDeviceName(e.target.value)} className="col-span-3"/>
            </div>
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


// --- Adaptador para Web Bluetooth API ---
function createWebBluetoothAdapter(): BluetoothAdapter {
  let webDevice: BluetoothDevice | null = null;
  let onDisconnectCallback: (() => void) | null = null;
  
  const handleGattServerDisconnected = () => {
    webDevice = null;
    if (onDisconnectCallback) {
      onDisconnectCallback();
    }
  };

  return {
    initialize: async () => {
      // No hay inicialización explícita para Web Bluetooth
      Promise.resolve();
    },
    requestDevice: async (options) => {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: options.name, services: options.services }],
        optionalServices: options.services,
      });
      if (!device.name || !device.id) {
        throw new Error("El dispositivo seleccionado no es válido.");
      }
      return { deviceId: device.id, name: device.name };
    },
    connect: async (deviceId, onDisconnect) => {
      // En Web Bluetooth, el 'device' ya se obtuvo en 'requestDevice'.
      // La conexión real ocurre al acceder al servidor GATT.
      const devices = await navigator.bluetooth.getDevices();
      webDevice = devices.find(d => d.id === deviceId) || null;

      if (!webDevice || !webDevice.gatt) {
        throw new Error("No se pudo obtener el dispositivo para la conexión GATT.");
      }
      
      onDisconnectCallback = onDisconnect;
      webDevice.addEventListener('gattserverdisconnected', handleGattServerDisconnected);
      
      await webDevice.gatt.connect();
    },
    disconnect: async (deviceId) => {
      if (!webDevice || !webDevice.gatt || !webDevice.gatt.connected) return;
      webDevice.gatt.disconnect();
      webDevice.removeEventListener('gattserverdisconnected', handleGattServerDisconnected);
      handleGattServerDisconnected(); // Forzar limpieza de estado
    },
    startNotifications: async (deviceId, serviceUUID, characteristicUUID, callback) => {
       if (!webDevice || !webDevice.gatt || !webDevice.gatt.connected) {
         throw new Error("Servidor GATT no conectado.");
       }
       const service = await webDevice.gatt.getPrimaryService(serviceUUID);
       const characteristic = await service.getCharacteristic(characteristicUUID);
       characteristic.addEventListener('characteristicvaluechanged', (event) => {
         const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
         if (value) {
            callback(value);
         }
       });
       await characteristic.startNotifications();
    },
  };
}
