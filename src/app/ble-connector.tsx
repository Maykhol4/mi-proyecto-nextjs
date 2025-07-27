'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Bluetooth, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

// --- DEFINICIONES DE TIPO MANUALES ---
interface BleDevice {
  deviceId: string;
  name?: string;
}

interface ScanResult {
  device: BleDevice;
  localName?: string;
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
  connect(deviceId: string, onDisconnect?: () => void): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  startNotifications(
    deviceId: string,
    service: string,
    characteristic: string,
    onPacket: (value: DataView) => void
  ): Promise<void>;
  requestLEScan?(options: { services?: string[] }, onResult: (result: ScanResult) => void): Promise<void>;
  stopLEScan?(): Promise<void>;
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
const SCAN_DURATION_MS = 10000; // Aumentado a 10 segundos
const CONNECTION_TIMEOUT_MS = 15000; // Timeout para conexión

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
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<BleDevice[]>([]);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  
  // Referencias para evitar memory leaks
  const bleClientRef = useRef<BleClient | null>(null);
  const connectedDeviceRef = useRef<BleDevice | null>(null);
  const receivedDataBuffer = useRef('');
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup al desmontar el componente
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Limpiar timeouts
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
      // Desconectar si está conectado
      if (connectedDeviceRef.current && bleClientRef.current) {
        bleClientRef.current.disconnect(connectedDeviceRef.current.deviceId).catch(console.error);
      }
    };
  }, []);

  // Inicialización de BLE con mejor manejo de errores
  useEffect(() => {
    const initializeBle = async () => {
      if (typeof window === 'undefined') return;

      try {
        // Detectar si estamos en una plataforma nativa
        const { Capacitor } = await import('@capacitor/core');
        
        if (Capacitor.isNativePlatform()) {
          // Plataforma nativa - usar plugin de Capacitor
          const { BleClient } = await import('@capacitor-community/bluetooth-le');
          bleClientRef.current = BleClient;
          await bleClientRef.current.initialize({ androidNeverForLocation: true });
          
          if (isMountedRef.current) {
            setIsBleInitialized(true);
            toast({ 
              title: 'BLE Inicializado', 
              description: 'Usando plugin nativo de Capacitor.' 
            });
          }
        } else {
          // Plataforma web - usar Web Bluetooth API
          if (!navigator.bluetooth) {
            throw new Error('Web Bluetooth no es compatible con este navegador.');
          }
          
          bleClientRef.current = createWebBluetoothAdapter();
          await bleClientRef.current.initialize();
          
          if (isMountedRef.current) {
            setIsBleInitialized(true);
            toast({ 
              title: 'BLE Inicializado', 
              description: 'Usando Web Bluetooth API.' 
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

  // Callback para manejo de desconexión
  const onDisconnected = useCallback(() => {
    if (!isMountedRef.current) return;
    
    connectedDeviceRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
    setInitialSensorData();
    
    // Limpiar timeout de conexión si existe
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    
    toast({
      title: 'Desconectado',
      description: 'El dispositivo Bluetooth se ha desconectado.',
    });
  }, [toast, setIsConnected, setInitialSensorData]);

  // Manejo de datos recibidos con mejor validación
  const handleData = useCallback((data: SensorData) => {
    if (isMountedRef.current) {
      setSensorData(data);
    }
  }, [setSensorData]);

  // Procesamiento de notificaciones BLE
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
              const jsonData: SensorData = JSON.parse(message);
              handleData(jsonData);
            } catch (parseError) {
              console.warn('Error parseando JSON:', parseError, 'Mensaje:', `"${message}"`);
            }
          }
        });
      }
    } catch (error) {
      console.error('Error procesando notificación BLE:', error);
    }
  }, [handleData]);

  // Función para detener escaneo de forma segura
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

  // Conexión a dispositivo específico con timeout y validación de servicio
  const connectToDevice = async (device: BleDevice) => {
    if (!bleClientRef.current || !isMountedRef.current) return;

    setIsScanModalOpen(false);
    setIsConnecting(true);

    // Detener escaneo si está activo
    if (isScanning) {
      await stopScanning();
    }

    // Configurar timeout para la conexión
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
      // Intentar conectar
      await bleClientRef.current.connect(device.deviceId, onDisconnected);
      connectedDeviceRef.current = device;

      // Verificar que el dispositivo tiene el servicio UART
      try {
        await bleClientRef.current.startNotifications(
          device.deviceId, 
          UART_SERVICE_UUID, 
          UART_TX_CHARACTERISTIC_UUID, 
          handleNotifications
        );
      } catch (serviceError) {
        // El dispositivo no tiene el servicio requerido
        throw new Error('El dispositivo no tiene el servicio UART Nordic requerido.');
      }

      // Limpiar timeout y actualizar estado
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }

      if (isMountedRef.current) {
        setIsConnected(true);
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

  // Manejo de conexión principal
  const handleConnect = async () => {
    if (!bleClientRef.current || !isBleInitialized || !isMountedRef.current) {
      toast({ 
        variant: 'destructive', 
        title: 'Bluetooth no listo', 
        description: 'El adaptador Bluetooth no se ha inicializado.' 
      });
      return;
    }

    // Para Web Bluetooth - flujo directo
    if (!bleClientRef.current.requestLEScan) {
      setIsConnecting(true);
      try {
        const device = await bleClientRef.current.requestDevice({
          acceptAllDevices: true,
          optionalServices: [UART_SERVICE_UUID],
        });
        await connectToDevice(device);
      } catch (error) {
        console.error("Error solicitando dispositivo:", error);
        if (isMountedRef.current) {
          const errorMessage = (error as Error).message;
          if (errorMessage.includes('User cancelled')) {
            toast({ 
              title: 'Selección Cancelada', 
              description: 'No se seleccionó ningún dispositivo.' 
            });
          } else {
            toast({ 
              variant: 'destructive', 
              title: 'Error de Solicitud', 
              description: errorMessage 
            });
          }
        }
      } finally {
        if (isMountedRef.current) {
          setIsConnecting(false);
        }
      }
      return;
    }

    // Para plataforma nativa - flujo de escaneo
    setIsScanning(true);
    setIsScanModalOpen(true);
    setScanResults([]);

    const onDeviceFound = (result: ScanResult) => {
      if (!isMountedRef.current) return;
      
      setScanResults(prev => {
        const exists = prev.find(d => d.deviceId === result.device.deviceId);
        if (!exists) {
          return [...prev, { 
            deviceId: result.device.deviceId, 
            name: result.device.name || result.localName || 'Dispositivo Desconocido'
          }];
        }
        return prev;
      });
    };

    try {
      await bleClientRef.current.requestLEScan({ services: [] }, onDeviceFound);

      scanTimeoutRef.current = setTimeout(async () => {
        await stopScanning();
        if (isMountedRef.current && scanResults.length === 0) {
          toast({ 
            title: "Búsqueda finalizada", 
            description: "No se encontraron dispositivos cercanos."
          });
        }
      }, SCAN_DURATION_MS);

    } catch (error) {
      console.error("Error iniciando escaneo:", error);
      if (isMountedRef.current) {
        toast({ 
          variant: 'destructive', 
          title: 'Error de Escaneo', 
          description: 'No se pudo iniciar la búsqueda de dispositivos.' 
        });
        setIsScanning(false);
        setIsScanModalOpen(false);
      }
    }
  };

  // Desconexión manual
  const handleDisconnect = async () => {
    if (bleClientRef.current && connectedDeviceRef.current) {
      try {
        await bleClientRef.current.disconnect(connectedDeviceRef.current.deviceId);
      } catch (error) {
        console.error("Error desconectando:", error);
      }
    }
    onDisconnected();
  };

  // Manejo de cierre de modal de escaneo
  const handleScanModalClose = async () => {
    if (isScanning) {
      await stopScanning();
    }
    setIsScanModalOpen(false);
  };

  // Estados para contenedores de portal
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
            <span>Conéctese a su dispositivo BLE</span>
          </div>
          <Button 
            onClick={handleConnect} 
            disabled={isConnecting || !isBleInitialized || isScanning} 
            className="w-full h-12 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold rounded-lg shadow-lg transition-all duration-200 transform hover:scale-105"
          >
            {(isConnecting || isScanning) ? (
              <>
                <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                {isScanning ? 'Buscando...' : 'Conectando...'}
              </>
            ) : (
              <>
                <Search className="w-5 h-5 mr-2" />
                Buscar Dispositivo
              </>
            )}
          </Button>
        </>,
        container
      )}

      {containerConnected && createPortal(
        <Button onClick={handleDisconnect} variant="destructive" size="sm">
          Desconectar
        </Button>,
        containerConnected
      )}

      <Dialog open={isScanModalOpen} onOpenChange={handleScanModalClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buscando Dispositivos BLE</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {isScanning && (
              <div className="flex items-center justify-center space-x-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Buscando dispositivos ({SCAN_DURATION_MS / 1000}s)...</span>
              </div>
            )}
            <div className="max-h-60 overflow-y-auto space-y-2">
              {scanResults.length > 0 ? (
                scanResults.map(device => (
                  <div key={device.deviceId} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex-1">
                      <div className="font-medium">{device.name}</div>
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
                    No se encontraron dispositivos. Asegúrese de que el dispositivo esté encendido y cerca.
                  </p>
                )
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleScanModalClose}>
              {isScanning ? 'Cancelar' : 'Cerrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// Adaptador para Web Bluetooth API
function createWebBluetoothAdapter(): BleClient {
  let webDevice: BluetoothDevice | null = null;
  let onDisconnectCallback: (() => void) | null = null;

  const handleGattServerDisconnected = () => {
    webDevice = null;
    if (onDisconnectCallback) {
      onDisconnectCallback();
      onDisconnectCallback = null;
    }
  };

  return {
    initialize: () => Promise.resolve(),
    
    requestDevice: async (options) => {
      try {
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: options?.acceptAllDevices || false,
          optionalServices: options?.optionalServices || [],
        });
        
        if (!device.id) {
          throw new Error("El dispositivo seleccionado no tiene un ID válido.");
        }
        
        webDevice = device;
        return { 
          deviceId: device.id, 
          name: device.name || 'Dispositivo Desconocido' 
        };
      } catch (error) {
        if ((error as Error).name === 'NotFoundError') {
          throw new Error('User cancelled device selection');
        }
        throw error;
      }
    },
    
    connect: async (deviceId, onDisconnect) => {
      if (!webDevice || webDevice.id !== deviceId) {
        throw new Error("Dispositivo no encontrado para conexión.");
      }
      
      if (!webDevice.gatt) {
        throw new Error("GATT no disponible en este dispositivo.");
      }
      
      onDisconnectCallback = onDisconnect || null;
      webDevice.addEventListener('gattserverdisconnected', handleGattServerDisconnected);
      
      try {
        await webDevice.gatt.connect();
      } catch (error) {
        webDevice.removeEventListener('gattserverdisconnected', handleGattServerDisconnected);
        throw new Error(`Error conectando: ${(error as Error).message}`);
      }
    },
    
    disconnect: async (deviceId) => {
      if (!webDevice?.gatt?.connected || webDevice.id !== deviceId) return;
      
      webDevice.removeEventListener('gattserverdisconnected', handleGattServerDisconnected);
      webDevice.gatt.disconnect();
      handleGattServerDisconnected();
    },
    
    startNotifications: async (deviceId, serviceUUID, characteristicUUID, callback) => {
      if (!webDevice?.gatt?.connected || webDevice.id !== deviceId) {
        throw new Error("Dispositivo no conectado.");
      }
      
      try {
        const service = await webDevice.gatt.getPrimaryService(serviceUUID);
        const characteristic = await service.getCharacteristic(characteristicUUID);
        
        characteristic.addEventListener('characteristicvaluechanged', (event) => {
          const target = event.target as BluetoothRemoteGATTCharacteristic;
          if (target.value) {
            callback(target.value);
          }
        });
        
        await characteristic.startNotifications();
      } catch (error) {
        throw new Error(`Error iniciando notificaciones: ${(error as Error).message}`);
      }
    }
  };
}
