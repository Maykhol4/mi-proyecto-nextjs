'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { BleDevice as CapacitorBleDevice, ScanResult } from '@capacitor-community/bluetooth-le';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';

// Interfaces
interface BleDevice {
  deviceId: string;
  name?: string;
}

// Configuración de servicios BLE
const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // ESP32 -> App
const UART_RX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // App -> ESP32

const SCAN_DURATION_MS = 10000;
const CONNECTION_TIMEOUT_MS = 15000;
const CHUNK_SIZE = 512; // MTU size
const CHUNK_DELAY_MS = 100;

export type ConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected';

export interface BleConnectorRef {
  startScan: () => void;
  disconnect: () => void;
  sendWifiConfig: (ssid: string, psk: string) => Promise<void>;
  connectionState: ConnectionState;
  devices: BleDevice[];
  connectToDevice: (device: BleDevice) => void;
}

interface BleConnectorProps {
  onConnectionStateChange: (state: ConnectionState) => void;
}

export const BleConnector = React.forwardRef<BleConnectorRef, BleConnectorProps>(
  ({ onConnectionStateChanged }, ref) => {
    const { toast } = useToast();
    const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
    const [devices, setDevices] = useState<BleDevice[]>([]);
    const [isScanModalOpen, setIsScanModalOpen] = useState(false);
    
    const connectedDeviceRef = useRef<CapacitorBleDevice | null>(null);
    const receivedDataBuffer = useRef('');
    const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isConnectingRef = useRef(false);
    const isMountedRef = useRef(true);
    const isNative = Capacitor.isNativePlatform();

    useEffect(() => {
        isMountedRef.current = true;
        
        const init = async () => {
            if (isNative) {
                try {
                    await BleClient.initialize({ androidNeverForLocation: true });
                } catch(e) {
                    console.error("Error initializing BLE", e);
                    toast({ title: "Error de Bluetooth", description: "No se pudo inicializar el Bluetooth.", variant: "destructive" });
                }
            }
        }
        init();

        return () => {
            isMountedRef.current = false;
            if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
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
    
    // Procesa respuestas de comandos, no datos de sensores
    const handleNotifications = useCallback((value: DataView) => {
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
                        // Solo maneja respuestas a comandos
                        if (jsonData.type && jsonData.type.includes('_response')) {
                            toast({
                                title: 'Respuesta del Dispositivo',
                                description: jsonData.message || 'Comando procesado.',
                                variant: jsonData.status === 'success' ? 'default' : 'destructive',
                            });
                        }
                    } catch (parseError) {
                        console.warn('Error parseando JSON de respuesta:', parseError, 'Mensaje:', `"${message}"`);
                    }
                }
            });
        }
    }, [toast]);
    
    const disconnect = useCallback(async () => {
        if (connectedDeviceRef.current) {
            try {
                await BleClient.disconnect(connectedDeviceRef.current.deviceId);
            } catch (error) {
                console.error("Error on disconnect", error);
            }
        }
        connectedDeviceRef.current = null;
        isConnectingRef.current = false;
        updateConnectionState('disconnected');
        toast({ title: 'Desconectado', description: 'Se ha desconectado del dispositivo.' });
    }, [updateConnectionState, toast]);

    const connectToDevice = useCallback(async (device: BleDevice) => {
        if (isConnectingRef.current) {
            return;
        }
        isConnectingRef.current = true;
        setIsScanModalOpen(false);
        updateConnectionState('connecting');

        connectionTimeoutRef.current = setTimeout(() => {
            isConnectingRef.current = false;
            updateConnectionState('disconnected');
            toast({ title: 'Timeout', description: 'La conexión tardó demasiado.', variant: 'destructive' });
            if (connectedDeviceRef.current) {
                BleClient.disconnect(connectedDeviceRef.current.deviceId);
            }
        }, CONNECTION_TIMEOUT_MS);
        
        try {
            await BleClient.connect(device.deviceId, (deviceId) => {
                // This callback is called when the device disconnects
                if (connectedDeviceRef.current?.deviceId === deviceId) {
                    disconnect();
                }
            });

            if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
            connectedDeviceRef.current = device as CapacitorBleDevice;
            
            try {
                await BleClient.requestMtu(device.deviceId, CHUNK_SIZE);
            } catch (e) {
                console.warn("MTU request failed", e);
            }
            
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
            toast({ title: 'Conexión Fallida', description: (error as Error).message, variant: 'destructive' });
        }

    }, [updateConnectionState, handleNotifications, disconnect, toast]);

    const stopScan = useCallback(async () => {
        if (scanTimeoutRef.current) {
            clearTimeout(scanTimeoutRef.current);
            scanTimeoutRef.current = null;
        }
        try {
            await BleClient.stopLEScan();
        } catch (error) {
            console.warn("Error stopping scan", error);
        }
        if (isMountedRef.current) {
            setIsScanModalOpen(false);
            if (connectionState === 'scanning') {
                updateConnectionState('disconnected');
            }
        }
    }, [connectionState, updateConnectionState]);

    const startScan = useCallback(async () => {
        setDevices([]);
        updateConnectionState('scanning');
        setIsScanModalOpen(true);
        
        try {
            await BleClient.requestLEScan(
                { services: [], allowDuplicates: false },
                (result) => {
                    if (result.device.name) {
                       setDevices(prev => {
                            if (!prev.some(d => d.deviceId === result.device.deviceId)) {
                                return [...prev, { deviceId: result.device.deviceId, name: result.device.name }];
                            }
                            return prev;
                        });
                    }
                }
            );

            scanTimeoutRef.current = setTimeout(stopScan, SCAN_DURATION_MS);
        } catch (error) {
            console.error("Scan error", error);
            toast({ title: 'Error de Escaneo', description: (error as Error).message, variant: 'destructive' });
            updateConnectionState('disconnected');
            setIsScanModalOpen(false);
        }
    }, [updateConnectionState, stopScan, toast]);

    const sendCommand = async (command: object) => {
      if (!connectedDeviceRef.current) {
          toast({ variant: 'destructive', title: 'Error', description: 'No hay un dispositivo conectado.' });
          return;
      }
      
      const jsonCommand = JSON.stringify(command) + '\n';
      const encoder = new TextEncoder();
      const encodedData = encoder.encode(jsonCommand);

      try {
          for (let i = 0; i < encodedData.byteLength; i += (CHUNK_SIZE - 3)) { // -3 for ATT headers
              const chunkBuffer = encodedData.slice(i, i + (CHUNK_SIZE - 3));
              
              await BleClient.write(
                  connectedDeviceRef.current.deviceId,
                  UART_SERVICE_UUID,
                  UART_RX_CHARACTERISTIC_UUID,
                  new DataView(chunkBuffer.buffer)
              );

              if (encodedData.byteLength > (CHUNK_SIZE-3)) {
                await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY_MS));
              }
          }
      } catch (error) {
          console.error("Error enviando comando:", error);
          toast({ variant: 'destructive', title: 'Error de Envío', description: (error as Error).message });
          if ((error as Error).message.toLowerCase().includes('disconnected')) {
              disconnect();
          }
      }
    };
    
    const sendWifiConfig = async (ssid: string, psk: string) => {
        await sendCommand({ type: 'wifi_config', ssid: ssid, password: psk });
    };

    React.useImperativeHandle(ref, () => ({
      startScan,
      disconnect,
      sendWifiConfig,
      connectionState,
      devices,
      connectToDevice,
    }));

    return (
      <Dialog open={isScanModalOpen} onOpenChange={(isOpen) => { if (!isOpen) stopScan(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispositivos BLE Encontrados</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {connectionState === 'scanning' && (
              <div className="flex items-center justify-center space-x-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Buscando dispositivos...</span>
              </div>
            )}
            <div className="max-h-60 overflow-y-auto space-y-2">
              {devices.length > 0 ? (
                devices.map(device => (
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
                      disabled={connectionState === 'connecting'}
                    >
                      {connectionState === 'connecting' ? 'Conectando...' : 'Conectar'}
                    </Button>
                  </div>
                ))
              ) : (
                connectionState !== 'scanning' && (
                  <p className="text-center text-muted-foreground py-4">
                    No se encontraron dispositivos. <br/>
                    Verifica que tu dispositivo esté encendido y cerca.
                  </p>
                )
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={stopScan}>
              {connectionState === 'scanning' ? 'Cancelar Búsqueda' : 'Cerrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);
BleConnector.displayName = "BleConnector";