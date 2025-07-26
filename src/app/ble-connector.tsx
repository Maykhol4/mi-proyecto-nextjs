'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Bluetooth, Settings } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

// --- DEFINICIONES DE TIPO MANUALES PARA EVITAR IMPORTACIÓN EN SERVIDOR ---
// Esto es crucial para prevenir el 'Internal Server Error'.
interface BleDevice {
  deviceId: string;
  name?: string;
}

interface BleClient {
  initialize: (options?: { androidNeverForLocation: boolean }) => Promise<void>;
  requestDevice: (options: { name?: string; services?: string[]; optionalServices?: string[] }) => Promise<BleDevice>;
  connect: (deviceId: string, onDisconnect?: (deviceId: string) => void) => Promise<void>;
  disconnect: (deviceId: string) => Promise<void>;
  startNotifications: (deviceId: string, service: string, characteristic: string, callback: (value: DataView) => void) => Promise<void>;
  stopNotifications: (deviceId: string, service: string, characteristic: string) => Promise<void>;
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

  const bleClientRef = useRef<BleClient | null>(null);
  const connectedDeviceRef = useRef<BleDevice | null>(null);
  const receivedDataBuffer = useRef('');

  // Efecto para inicializar BLE de forma segura solo en el cliente.
  useEffect(() => {
    const initializeBle = async () => {
      // La comprobación `typeof window` asegura que este código nunca se ejecute en el servidor.
      if (typeof window !== 'undefined') {
        try {
          // La importación dinámica está dentro del `useEffect` para aislarla del servidor.
          const { BleClient } = await import('@capacitor-community/bluetooth-le');
          bleClientRef.current = BleClient;
          await bleClientRef.current.initialize({ androidNeverForLocation: true });
          setIsBleInitialized(true);
        } catch (error) {
          console.error('Error inicializando BleClient:', error);
          // Opcional: Mostrar un toast si la inicialización falla (e.g., BT desactivado).
        }
      }
    };
    
    initializeBle();

    const savedName = localStorage.getItem('bleDeviceName');
    if (savedName) {
      setDeviceName(savedName);
      setTempDeviceName(savedName);
    }
  }, []); // El array vacío asegura que se ejecute solo una vez.

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
    if (!isBleInitialized || !bleClientRef.current) {
      toast({
        variant: 'destructive',
        title: 'Bluetooth no está listo',
        description: 'El cliente Bluetooth no está inicializado. Por favor, inténtalo de nuevo.',
      });
      return;
    }
    
    setIsConnecting(true);
    try {
      const device = await bleClientRef.current.requestDevice({
        name: deviceName,
        services: [UART_SERVICE_UUID],
      });
      connectedDeviceRef.current = device;
      await bleClientRef.current.connect(device.deviceId, onDisconnected);
      await bleClientRef.current.startNotifications(
        device.deviceId, UART_SERVICE_UUID, UART_TX_CHARACTERISTIC_UUID, handleNotifications
      );

      setIsConnected(true);
      toast({
        title: '¡Conectado!',
        description: `Conectado exitosamente a ${deviceName}.`,
      });
    } catch (error) {
      console.error('La conexión falló:', error);
      toast({ variant: 'destructive', title: 'Conexión Fallida', description: 'No se pudo encontrar o conectar al dispositivo.' });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (bleClientRef.current && connectedDeviceRef.current) {
        try {
            await bleClientRef.current.disconnect(connectedDeviceRef.current.deviceId);
        } catch(error) {
            console.error("Fallo al desconectar (Capacitor)", error);
            onDisconnected();
        }
    } else {
      onDisconnected();
    }
  };

  const handleSaveSettings = () => {
    setDeviceName(tempDeviceName);
    localStorage.setItem('bleDeviceName', tempDeviceName);
    setIsSettingsOpen(false);
    toast({ title: 'Ajustes Guardados', description: `Nombre del dispositivo actualizado a ${tempDeviceName}.` });
  };
  
  // Estados para los portales
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
