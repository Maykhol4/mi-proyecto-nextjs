import { useState, useEffect, useCallback, useRef } from 'react';
import { BleClient, type BleDevice as CapacitorBleDevice } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { useToast } from '@/hooks/use-toast';
import type { BleDevice, SensorData, ConnectionState } from '@/lib/ble-types';
import {
  UART_SERVICE_UUID,
  UART_TX_CHARACTERISTIC_UUID,
  UART_RX_CHARACTERISTIC_UUID,
  CONNECTION_TIMEOUT_MS,
  CHUNK_SIZE,
  CHUNK_DELAY_MS,
} from '@/lib/ble-types';

export function useBle() {
  const { toast } = useToast();
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [devices, setDevices] = useState<BleDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<BleDevice | null>(null);
  const [lastSensorData, setLastSensorData] = useState<SensorData | null>(null);

  const connectedDeviceRef = useRef<CapacitorBleDevice | null>(null);
  const receivedDataBuffer = useRef('');
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectingRef = useRef(false);
  const isMountedRef = useRef(true);
  const expectDisconnectRef = useRef(false);
  const lastConnectedDeviceIdRef = useRef<string | null>(null);

  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    isMountedRef.current = true;
    const init = async () => {
      if (isNative) {
        try {
          await BleClient.initialize({ androidNeverForLocation: true });
        } catch (e) {
          toast({ title: "Error de Bluetooth", description: "No se pudo inicializar el Bluetooth.", variant: "destructive" });
          if (isMountedRef.current) setConnectionState('error');
        }
      }
    };
    init();

    return () => {
      isMountedRef.current = false;
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
      if (connectedDeviceRef.current) {
        BleClient.disconnect(connectedDeviceRef.current.deviceId).catch(console.error);
      }
    };
  }, [isNative, toast]);

  const handleNotifications = useCallback((value: DataView) => {
    const decoder = new TextDecoder();
    receivedDataBuffer.current += decoder.decode(value);

    let lastNewline;
    while ((lastNewline = receivedDataBuffer.current.indexOf('\n')) !== -1) {
      const message = receivedDataBuffer.current.substring(0, lastNewline);
      receivedDataBuffer.current = receivedDataBuffer.current.substring(lastNewline + 1);

      if (message.trim()) {
        try {
          console.log('Mensaje recibido:', message)
          const jsonData = JSON.parse(message) as SensorData;
          if (jsonData.type && (jsonData as any).type.includes('_response')) {
            toast({
              title: 'Respuesta del Dispositivo',
              description: (jsonData as any).message || 'Comando procesado.',
              variant: (jsonData as any).status === 'success' ? 'default' : 'destructive',
            });
          } else {
            if (isMountedRef.current) setLastSensorData(prev => ({ ...prev, ...jsonData }));
          }
        } catch (parseError) {
          console.warn('Error parseando JSON:', parseError, 'Mensaje:', `"${message}"`);
        }
      }
    }
  }, [toast]);

  const disconnect = useCallback(async (isExpected = false) => {
    const deviceId = connectedDeviceRef.current?.deviceId;
    if (!deviceId) return;

    if (!isExpected) {
      toast({ title: '🔌 Desconectado', description: 'Se ha desconectado del dispositivo.' });
    }

    try {
      await BleClient.stopNotifications(deviceId, UART_SERVICE_UUID, UART_TX_CHARACTERISTIC_UUID);
    } catch (e) { /* Ignorar errores */ }

    try {
      await BleClient.disconnect(deviceId);
    } catch (error) {
      console.error("Error on disconnect", error);
    }

    connectedDeviceRef.current = null;
    if (isMountedRef.current) {
      setConnectedDevice(null);
      setConnectionState('disconnected');
      setLastSensorData(prev => prev ? { ...prev, wifi_status: 'disconnected' } : null);
    }
    isConnectingRef.current = false;
  }, [toast]);
  
  const connectToDevice = useCallback(async (device: BleDevice, isReconnection = false) => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;

    if (!isReconnection) {
      if (isMountedRef.current) setConnectionState('connecting');
    }

    connectionTimeoutRef.current = setTimeout(() => {
      isConnectingRef.current = false;
      if (isMountedRef.current) setConnectionState('error');
      toast({ title: '⏱️ Timeout', description: 'La conexión tardó demasiado.', variant: 'destructive' });
      if (connectedDeviceRef.current?.deviceId) {
        BleClient.disconnect(connectedDeviceRef.current.deviceId);
      }
    }, CONNECTION_TIMEOUT_MS);

    try {
      await BleClient.connect(device.deviceId, (deviceId) => onDisconnected(deviceId));

      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);

      const bleDevice = device as CapacitorBleDevice;
      connectedDeviceRef.current = bleDevice;
      lastConnectedDeviceIdRef.current = device.deviceId;
      if (isMountedRef.current) setConnectedDevice(device);

      try {
        await BleClient.requestMtu(device.deviceId, CHUNK_SIZE);
      } catch (e) { console.warn("MTU request failed", e); }

      await BleClient.startNotifications(
        device.deviceId,
        UART_SERVICE_UUID,
        UART_TX_CHARACTERISTIC_UUID,
        handleNotifications
      );

      isConnectingRef.current = false;
      if (isMountedRef.current) setConnectionState('connected');
      toast({ title: '✅ ¡Conectado!', description: `Conectado a ${device.name || device.deviceId}`, duration: 3000 });

    } catch (error) {
      console.error("Connection failed", error);
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
      isConnectingRef.current = false;
      if (isMountedRef.current) setConnectionState('error');
      await disconnect(true); // isExpected = true para no mostrar doble toast
      toast({ title: '❌ Conexión Fallida', description: 'No se pudo conectar.', variant: 'destructive' });
    }
  }, [handleNotifications, toast, disconnect]);
  
  const onDisconnected = useCallback((deviceId: string) => {
      if (!isMountedRef.current) return;
  
      if (expectDisconnectRef.current && lastConnectedDeviceIdRef.current === deviceId) {
          expectDisconnectRef.current = false;
          if (isMountedRef.current) setConnectionState('connecting');
          toast({ title: 'Reconectando...', description: 'El dispositivo se reinició. Intentando reconectar.' });
  
          setTimeout(() => {
              if (isMountedRef.current && lastConnectedDeviceIdRef.current) {
                   connectToDevice({ deviceId: lastConnectedDeviceIdRef.current } as BleDevice, true);
              }
          }, 3000); 
  
      } else {
          if (connectedDeviceRef.current?.deviceId === deviceId) {
               disconnect(false);
          }
      }
  }, [disconnect, toast, connectToDevice]);

  const startScan = useCallback(async () => {
    if (connectionState === 'scanning' || connectionState === 'connecting') return;
    if (!isMountedRef.current) return;

    setDevices([]);
    setConnectionState('scanning');

    try {
      if (!isNative) {
        const device = await BleClient.requestDevice({
          acceptAllDevices: true,
          optionalServices: [UART_SERVICE_UUID]
        });
        if (device) {
          await connectToDevice(device as BleDevice);
        } else {
          if (isMountedRef.current) setConnectionState('disconnected');
        }
        return;
      }

      await BleClient.requestLEScan(
        { services: [], allowDuplicates: false },
        (result) => {
          if (result.device.name) {
            if (isMountedRef.current) {
              setDevices(prev => {
                const newDevice: BleDevice = {
                  deviceId: result.device.deviceId,
                  name: result.device.name,
                  rssi: result.rssi
                };
                if (!prev.some(d => d.deviceId === newDevice.deviceId)) {
                  return [...prev, newDevice].sort((a, b) => (b.rssi || -100) - (a.rssi || -100));
                }
                return prev;
              });
            }
          }
        }
      );
    } catch (error) {
      console.error("Scan error", error);
      toast({ title: 'Error de Escaneo', description: (error as Error).message, variant: 'destructive' });
      if (isMountedRef.current) setConnectionState('error');
    }
  }, [connectToDevice, toast, isNative, connectionState]);
  
  const stopScan = useCallback(async () => {
     if (isNative) {
       try { await BleClient.stopLEScan(); } catch (error) { console.warn("Error stopping scan", error); }
     }
     if (isMountedRef.current && connectionState === 'scanning') {
         setConnectionState('disconnected');
     }
  }, [isNative, connectionState]);


  const sendCommand = async (command: object) => {
    if (!connectedDeviceRef.current || connectionState !== 'connected') {
      toast({ variant: 'destructive', title: 'Error', description: 'No hay un dispositivo conectado.' });
      return;
    }

    if (command && (command as any).type === 'wifi_config') {
        expectDisconnectRef.current = true;
    }

    const jsonCommand = JSON.stringify(command) + '\n';
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(jsonCommand);

    try {
      for (let i = 0; i < encodedData.byteLength; i += (CHUNK_SIZE - 3)) {
        const chunkBuffer = encodedData.slice(i, i + (CHUNK_SIZE - 3));
        await BleClient.write(
          connectedDeviceRef.current.deviceId,
          UART_SERVICE_UUID,
          UART_RX_CHARACTERISTIC_UUID,
          new DataView(chunkBuffer.buffer)
        );
        if (encodedData.byteLength > (CHUNK_SIZE - 3)) {
          await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY_MS));
        }
      }
      toast({
        title: '📤 Comando Enviado',
        description: 'La configuración se envió al dispositivo.',
      });
    } catch (error) {
      console.error("Error enviando comando:", error);
      toast({ variant: 'destructive', title: 'Error de Envío', description: (error as Error).message });
      if ((error as Error).message.toLowerCase().includes('disconnected')) {
        onDisconnected(connectedDeviceRef.current.deviceId);
      }
    }
  };

  return {
    connectionState,
    devices,
    connectedDevice,
    lastSensorData,
    startScan,
    stopScan,
    connectToDevice,
    disconnect,
    sendCommand,
    isNative,
  };
}
