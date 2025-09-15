'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { BleDevice as CapacitorBleDevice } from '@capacitor-community/bluetooth-le';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';

// Interfaces
interface BleDevice {
  deviceId: string;
  name?: string;
}

export interface SensorData {
    ph?: number;
    do_conc?: number;
    do_sat?: number;
    temp?: number;
    timestamp?: string;
    status?: string;
    readings_count?: { ph: number; do: number };
    errors_count?: { ph: number; do: number };
    wifi_status?: 'connected' | 'disconnected' | 'connecting';
}

// Configuración de servicios BLE
const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notificaciones (ESP32 -> App)
const UART_RX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Escrituras (App -> ESP32)

const CONNECTION_TIMEOUT_MS = 15000;
const CHUNK_SIZE = 512; // MTU size
const CHUNK_DELAY_MS = 100;

export type ConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'reconnecting';

export interface BleConnectorRef {
  startScan: () => void;
  disconnect: () => Promise<void>;
  sendWifiConfig: (ssid: string, psk: string) => Promise<void>;
  connectionState: ConnectionState;
}

interface BleConnectorProps {
  onConnectionStateChanged: (state: ConnectionState) => void;
  onSensorData: (data: SensorData) => void;
  onDeviceListChange: (devices: BleDevice[]) => void;
}

export const BleConnector = React.forwardRef<BleConnectorRef, BleConnectorProps>(
  ({ onConnectionStateChanged, onSensorData, onDeviceListChange }, ref) => {
    const { toast } = useToast();
    const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
    
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
                } catch(e) {
                    toast({ title: "Error de Bluetooth", description: "No se pudo inicializar el Bluetooth.", variant: "destructive" });
                }
            }
        }
        init();

        return () => {
            isMountedRef.current = false;
            if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
            if (connectedDeviceRef.current) {
                BleClient.disconnect(connectedDeviceRef.current.deviceId).catch(console.error);
            }
        };
    }, [isNative, toast]);

    const updateConnectionState = useCallback((newState: ConnectionState) => {
        if (!isMountedRef.current) return;
        setConnectionState(newState);
        onConnectionStateChanged(newState);
    }, [onConnectionStateChanged]);
    
    const handleNotifications = useCallback((value: DataView) => {
        const decoder = new TextDecoder();
        receivedDataBuffer.current += decoder.decode(value);

        let lastNewline;
        while ((lastNewline = receivedDataBuffer.current.indexOf('\n')) !== -1) {
            const message = receivedDataBuffer.current.substring(0, lastNewline);
            receivedDataBuffer.current = receivedDataBuffer.current.substring(lastNewline + 1);

            if (message.trim()) {
                try {
                    const jsonData = JSON.parse(message);
                    console.log('📦 Mensaje recibido:', jsonData);
                    
                    if (jsonData.type && jsonData.type.includes('_response')) {
                         toast({
                            title: 'Respuesta del Dispositivo',
                            description: jsonData.message || 'Comando procesado.',
                            variant: jsonData.status === 'success' ? 'default' : 'destructive',
                        });
                    } else {
                        // Asumimos que son datos de sensor si no es una respuesta de comando
                        onSensorData(jsonData as SensorData);
                    }
                } catch (parseError) {
                    console.warn('Error parseando JSON:', parseError, 'Mensaje:', `"${message}"`);
                }
            }
        }
    }, [toast, onSensorData]);

    const disconnect = useCallback(async (isExpected = false) => {
        const deviceId = connectedDeviceRef.current?.deviceId;
        if (!deviceId) return;
        
        if (!isExpected) {
             toast({ title: 'Desconectado', description: 'Se ha desconectado del dispositivo.' });
        }
        
        try {
            await BleClient.stopNotifications(deviceId, UART_SERVICE_UUID, UART_TX_CHARACTERISTIC_UUID);
        } catch(e) { /* Ignorar errores */ }
       
        try {
            await BleClient.disconnect(deviceId);
        } catch (error) {
            console.error("Error on disconnect", error);
        }
        
        connectedDeviceRef.current = null;
        isConnectingRef.current = false;
        if (isMountedRef.current) {
             updateConnectionState('disconnected');
        }

    }, [updateConnectionState, toast]);


    const onDisconnected = useCallback((deviceId: string) => {
        if (!isMountedRef.current) return;
    
        if (expectDisconnectRef.current && lastConnectedDeviceIdRef.current === deviceId) {
            expectDisconnectRef.current = false;
            updateConnectionState('reconnecting');
            toast({ title: 'Reconectando...', description: 'El dispositivo se reinició. Intentando reconectar.' });
    
            setTimeout(() => {
                if (isMountedRef.current && lastConnectedDeviceIdRef.current) {
                     connectToDevice({ deviceId: lastConnectedDeviceIdRef.current }, true);
                }
            }, 3000); 
    
        } else {
            if (connectedDeviceRef.current?.deviceId === deviceId) {
                 disconnect(false);
            }
        }
    }, [updateConnectionState, toast, disconnect]);
    
    const connectToDevice = useCallback(async (device: BleDevice, isReconnection = false) => {
        if (isConnectingRef.current) return;
        isConnectingRef.current = true;
        
        if (!isReconnection) {
            updateConnectionState('connecting');
        }

        connectionTimeoutRef.current = setTimeout(() => {
            isConnectingRef.current = false;
            updateConnectionState('disconnected');
            toast({ title: 'Timeout', description: 'La conexión tardó demasiado.', variant: 'destructive' });
        }, CONNECTION_TIMEOUT_MS);
        
        try {
            await BleClient.connect(device.deviceId, onDisconnected);

            if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
            
            connectedDeviceRef.current = device as CapacitorBleDevice;
            lastConnectedDeviceIdRef.current = device.deviceId;
            
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
            updateConnectionState('connected');
            toast({ title: '¡Conectado!', description: `Conectado a ${device.name || device.deviceId}` });

        } catch (error) {
            console.error("Connection failed", error);
            if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
            isConnectingRef.current = false;
            updateConnectionState('disconnected');
            toast({ title: 'Conexión Fallida', description: 'El dispositivo no es compatible o no se pudo conectar.', variant: 'destructive' });
        }

    }, [updateConnectionState, handleNotifications, toast, onDisconnected]);


    const startScan = useCallback(async () => {
        onDeviceListChange([]);
        updateConnectionState('scanning');

        try {
            if (!isNative) {
                // Flujo Web
                const device = await BleClient.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: [UART_SERVICE_UUID]
                });
                if (device) {
                   await connectToDevice(device);
                } else {
                   updateConnectionState('disconnected');
                }
                return;
            }

            // Flujo Nativo
            await BleClient.requestLEScan(
                { services: [], allowDuplicates: false },
                (result) => {
                    if (result.device.name) {
                       onDeviceListChange(prev => {
                            if (!prev.some(d => d.deviceId === result.device.deviceId)) {
                                return [...prev, { deviceId: result.device.deviceId, name: result.device.name }];
                            }
                            return prev;
                        });
                    }
                }
            );

        } catch (error) {
            console.error("Scan error", error);
            toast({ title: 'Error de Escaneo', description: (error as Error).message, variant: 'destructive' });
            updateConnectionState('disconnected');
        }
    }, [updateConnectionState, toast, isNative, connectToDevice, onDeviceListChange]);

    const sendCommand = async (command: object) => {
      if (!connectedDeviceRef.current) {
          toast({ variant: 'destructive', title: 'Error', description: 'No hay un dispositivo conectado.' });
          return;
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
      } catch (error) {
          console.error("Error enviando comando:", error);
          toast({ variant: 'destructive', title: 'Error de Envío', description: (error as Error).message });
          if ((error as Error).message.toLowerCase().includes('disconnected')) {
              onDisconnected(connectedDeviceRef.current.deviceId);
          }
      }
    };
    
    const sendWifiConfig = async (ssid: string, psk: string) => {
        expectDisconnectRef.current = true;
        await sendCommand({ type: 'wifi_config', ssid: ssid, password: psk });
    };

    React.useImperativeHandle(ref, () => ({
      startScan,
      disconnect: () => disconnect(false),
      sendWifiConfig,
      connectionState,
    }));

    return null; // Este componente no renderiza nada
  }
);
BleConnector.displayName = "BleConnector";
