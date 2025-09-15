'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { BleClient, type BleDevice as CapacitorBleDevice } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { 
  RefreshCw, 
  Bluetooth, 
  Wifi, 
  Search,
  CheckCircle,
  XCircle,
  AlertCircle,
  Signal,
  Zap,
  Eye,
  EyeOff,
  Save,
  WifiOff,
  BluetoothConnected,
  BluetoothOff,
  Settings
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface BleDevice {
  deviceId: string;
  name?: string;
  rssi?: number;
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

const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notificaciones (ESP32 -> App)
const UART_RX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Escrituras (App -> ESP32)

const SCAN_DURATION_MS = 10000;
const CONNECTION_TIMEOUT_MS = 15000;
const CHUNK_SIZE = 512;
const CHUNK_DELAY_MS = 100;

export type ConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';


export default function HomeClient() {
    const { toast } = useToast();
    const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
    const [wifiStatus, setWifiStatus] = useState<SensorData['wifi_status']>('disconnected');
    const [devices, setDevices] = useState<BleDevice[]>([]);
    const [isScanModalOpen, setIsScanModalOpen] = useState(false);
    const [isWifiModalOpen, setIsWifiModalOpen] = useState(false);
    const [scanProgress, setScanProgress] = useState(0);
    const [connectedDevice, setConnectedDevice] = useState<BleDevice | null>(null);
    const [wifiSsid, setWifiSsid] = useState('');
    const [wifiPassword, setWifiPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const connectedDeviceRef = useRef<CapacitorBleDevice | null>(null);
    const receivedDataBuffer = useRef('');
    const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
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
                    setConnectionState('error');
                }
            }
        }
        init();

        return () => {
            isMountedRef.current = false;
            if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
            if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
            if (connectedDeviceRef.current) {
                BleClient.disconnect(connectedDeviceRef.current.deviceId).catch(console.error);
            }
        };
    }, [isNative, toast]);

    const handleSensorData = useCallback((data: SensorData) => {
        if (data.wifi_status) {
            setWifiStatus(data.wifi_status);
        }
    }, []);

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
                    if (jsonData.type && jsonData.type.includes('_response')) {
                         toast({
                            title: 'Respuesta del Dispositivo',
                            description: jsonData.message || 'Comando procesado.',
                            variant: jsonData.status === 'success' ? 'default' : 'destructive',
                        });
                    } else {
                        handleSensorData(jsonData as SensorData);
                    }
                } catch (parseError) {
                    console.warn('Error parseando JSON:', parseError, 'Mensaje:', `"${message}"`);
                }
            }
        }
    }, [toast, handleSensorData]);
    
    const disconnect = useCallback(async (isExpected = false) => {
        const deviceId = connectedDeviceRef.current?.deviceId;
        if (!deviceId) return;
        
        if (!isExpected) {
             toast({ title: '🔌 Desconectado', description: 'Se ha desconectado del dispositivo.' });
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
        setConnectedDevice(null);
        isConnectingRef.current = false;
        if (isMountedRef.current) {
             setConnectionState('disconnected');
             setWifiStatus('disconnected');
        }
    }, [toast]);

    const onDisconnected = useCallback((deviceId: string) => {
        if (!isMountedRef.current) return;
    
        if (expectDisconnectRef.current && lastConnectedDeviceIdRef.current === deviceId) {
            expectDisconnectRef.current = false;
            setConnectionState('connecting');
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
    }, [toast, disconnect]);
    
    const connectToDevice = useCallback(async (device: BleDevice, isReconnection = false) => {
        if (isConnectingRef.current) return;
        isConnectingRef.current = true;
        
        if (!isReconnection) {
            setConnectionState('connecting');
        }
        setIsScanModalOpen(false);

        connectionTimeoutRef.current = setTimeout(() => {
            isConnectingRef.current = false;
            setConnectionState('error');
            toast({ title: '⏱️ Timeout', description: 'La conexión tardó demasiado.', variant: 'destructive' });
            if (connectedDeviceRef.current?.deviceId) {
                BleClient.disconnect(connectedDeviceRef.current.deviceId);
            }
        }, CONNECTION_TIMEOUT_MS);
        
        try {
            await BleClient.connect(device.deviceId, onDisconnected);

            if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
            
            const bleDevice = device as CapacitorBleDevice;
            connectedDeviceRef.current = bleDevice;
            lastConnectedDeviceIdRef.current = device.deviceId;
            setConnectedDevice(device);
            
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
            setConnectionState('connected');
            toast({ title: '✅ ¡Conectado!', description: `Conectado a ${device.name || device.deviceId}`, duration: 3000 });

        } catch (error) {
            console.error("Connection failed", error);
            if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
            isConnectingRef.current = false;
            setConnectionState('error');
            await disconnect();
            toast({ title: '❌ Conexión Fallida', description: 'No se pudo conectar.', variant: 'destructive' });
        }

    }, [handleNotifications, toast, onDisconnected, disconnect]);

    const startProgressTracking = useCallback(() => {
        setScanProgress(0);
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = setInterval(() => {
            setScanProgress(prev => {
                if (prev >= 100) {
                    if(progressIntervalRef.current) clearInterval(progressIntervalRef.current);
                    return 100;
                }
                return prev + (100 / (SCAN_DURATION_MS / 200));
            });
        }, 200);
    }, []);

    const stopScan = useCallback(async () => {
        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        
        if (isNative) {
          try { await BleClient.stopLEScan(); } catch (error) { console.warn("Error stopping scan", error); }
        }
        
        if (isMountedRef.current) {
            setIsScanModalOpen(false);
            setScanProgress(0);
            if (connectionState === 'scanning') {
                setConnectionState('disconnected');
            }
        }
    }, [connectionState, isNative]);

    const startScan = useCallback(async () => {
        if (connectionState === 'scanning' || connectionState === 'connecting') return;

        setDevices([]);
        setConnectionState('scanning');
        
        try {
            if (!isNative) {
                const device = await BleClient.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: [UART_SERVICE_UUID]
                });
                if (device) {
                   await connectToDevice(device);
                } else {
                   setConnectionState('disconnected');
                }
                return;
            }

            setIsScanModalOpen(true);
            startProgressTracking();

            await BleClient.requestLEScan(
                { services: [], allowDuplicates: false },
                (result) => {
                    if (result.device.name) {
                       setDevices(prev => {
                            const newDevice: BleDevice = {
                                deviceId: result.device.deviceId,
                                name: result.device.name,
                                rssi: result.rssi
                            };
                            if (!prev.some(d => d.deviceId === newDevice.deviceId)) {
                                return [...prev, newDevice].sort((a,b) => (b.rssi || -100) - (a.rssi || -100));
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
            setConnectionState('error');
            setIsScanModalOpen(false);
        }
    }, [stopScan, toast, isNative, connectToDevice, startProgressTracking, connectionState]);

    const sendCommand = async (command: object) => {
      if (!connectedDeviceRef.current || connectionState !== 'connected') {
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
    
    const sendWifiConfig = async (ssid: string, psk: string) => {
        expectDisconnectRef.current = true;
        await sendCommand({ type: 'wifi_config', ssid: ssid, password: psk });
        setIsWifiModalOpen(false);
    };


    const getSignalStrength = (rssi: number) => {
        if (rssi > -60) return { strength: 'Excelente', color: 'text-green-500', bars: 4 };
        if (rssi > -70) return { strength: 'Buena', color: 'text-green-400', bars: 3 };
        if (rssi > -80) return { strength: 'Regular', color: 'text-yellow-500', bars: 2 };
        return { strength: 'Débil', color: 'text-red-500', bars: 1 };
    };

    const getConnectionStatus = () => {
        switch (connectionState) {
            case 'connected': return { text: 'Conectado', icon: <BluetoothConnected className="w-4 h-4" />, color: 'bg-primary/10 text-primary' };
            case 'connecting': return { text: 'Conectando...', icon: <RefreshCw className="w-4 h-4 animate-spin" />, color: 'bg-blue-100 text-blue-800' };
            case 'scanning': return { text: 'Buscando...', icon: <Search className="w-4 h-4" />, color: 'bg-yellow-100 text-yellow-800' };
            case 'error': return { text: 'Error', icon: <XCircle className="w-4 h-4" />, color: 'bg-red-100 text-red-800' };
            default: return { text: 'Desconectado', icon: <BluetoothOff className="w-4 h-4" />, color: 'bg-gray-100 text-gray-800' };
        }
    };
    
    const getWifiStatus = () => {
        switch (wifiStatus) {
            case 'connected': return { text: 'Conectado', icon: <Wifi className="w-4 h-4" />, color: 'bg-green-100 text-green-800' };
            case 'connecting': return { text: 'Conectando...', icon: <RefreshCw className="w-4 h-4 animate-spin" />, color: 'bg-yellow-100 text-yellow-800' };
            default: return { text: 'Desconectado', icon: <WifiOff className="w-4 h-4" />, color: 'bg-gray-100 text-gray-800' };
        }
    };

    const bleStatus = getConnectionStatus();
    const wifiInfo = getWifiStatus();

    const renderDisconnectedState = () => (
        <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
            <Card className="w-full max-w-md text-center shadow-lg animate-fade-in">
                <CardHeader>
                    <div className="mx-auto bg-primary/10 text-primary w-16 h-16 rounded-full flex items-center justify-center mb-4">
                        <Bluetooth className="w-8 h-8" />
                    </div>
                    <CardTitle className="text-2xl font-bold">AQUADATA 2.0</CardTitle>
                    <CardDescription>Herramienta de Configuración WiFi</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground mb-6">Conéctate a tu dispositivo ESP32 para configurar la red WiFi.</p>
                    <Button
                        onClick={startScan}
                        disabled={connectionState === 'scanning' || connectionState === 'connecting'}
                        className="w-full h-12"
                    >
                        {connectionState === 'scanning' ? (
                          <>
                            <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                            <span>Buscando...</span>
                          </>
                        ) : (
                          <>
                            <Search className="w-5 h-5 mr-2" />
                            <span>Buscar Dispositivo</span>
                          </>
                        )}
                    </Button>
                     {connectionState === 'error' && (
                        <div className="mt-4 flex items-center justify-center text-sm text-red-600 space-x-2">
                          <AlertCircle className="w-4 h-4" />
                          <p>Error de conexión. Inténtalo de nuevo.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );

    const renderConnectedState = () => (
        <div className="max-w-2xl mx-auto animate-fade-in">
            <Card className="shadow-lg">
                <CardHeader>
                    <div className="flex justify-between items-start">
                        <div>
                             <CardTitle className="text-2xl font-bold">Panel de Control</CardTitle>
                            <CardDescription>Dispositivo conectado: <span className="font-medium text-foreground">{connectedDevice?.name}</span></CardDescription>
                        </div>
                        <div className="flex items-center space-x-2">
                           <Badge variant="outline" className={`flex items-center space-x-2 ${wifiInfo.color}`}>{wifiInfo.icon}<span>{wifiInfo.text}</span></Badge>
                           <Badge variant="outline" className={`flex items-center space-x-2 ${bleStatus.color}`}>{bleStatus.icon}<span>{bleStatus.text}</span></Badge>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                        <div className="flex items-center space-x-3">
                           <Zap className="w-8 h-8 text-primary" />
                           <div>
                               <h3 className="font-semibold text-lg">Configuración WiFi</h3>
                               <p className="text-muted-foreground text-sm">Envía las credenciales de tu red al dispositivo AQUADATA.</p>
                           </div>
                        </div>
                    </div>
                     <Button
                        onClick={() => setIsWifiModalOpen(true)}
                        size="lg"
                        className="w-full h-12"
                      >
                        <Settings className="mr-2 h-5 w-5" />
                        Configurar WiFi del Dispositivo
                      </Button>
                      <Button
                        onClick={() => disconnect(false)}
                        variant="destructive"
                        className="w-full h-12"
                      >
                        <BluetoothOff className="mr-2 h-5 w-5" />
                        Desconectar
                      </Button>
                </CardContent>
            </Card>
        </div>
    );

    return (
      <>
        <div className="p-4 md:p-8">
            {connectionState === 'connected' ? renderConnectedState() : renderDisconnectedState()}
        </div>

        {/* Scan Modal */}
        <Dialog open={isScanModalOpen} onOpenChange={(isOpen) => { if (!isOpen) stopScan(); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center space-x-2">
                <Search className="w-5 h-5" />
                <span>Dispositivos BLE Encontrados</span>
              </DialogTitle>
            </DialogHeader>
            
            <div className="py-4 space-y-4">
              {connectionState === 'scanning' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-center space-x-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Buscando dispositivos cercanos...</span>
                  </div>
                  <Progress value={scanProgress} className="w-full" />
                </div>
              )}
              
              <div className="max-h-80 overflow-y-auto space-y-2">
                {devices.length > 0 ? (
                  devices.map(device => {
                    const signal = device.rssi ? getSignalStrength(device.rssi) : null;
                    return (
                      <Card key={device.deviceId} className="hover:bg-accent transition-colors cursor-pointer" onClick={() => connectToDevice(device)}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2 mb-1">
                                <Zap className="w-4 h-4 text-primary flex-shrink-0" />
                                <h3 className="font-medium truncate">{device.name}</h3>
                              </div>
                              <p className="text-xs text-muted-foreground truncate mb-2">
                                {device.deviceId}
                              </p>
                              {signal && (
                                <div className="flex items-center space-x-2">
                                  <div className="flex space-x-0.5 items-center">
                                    {[...Array(4)].map((_, i) => (
                                      <div
                                        key={i}
                                        className={`w-1 rounded-full ${i < signal.bars ? 'bg-current ' + signal.color : 'bg-gray-200'}`}
                                        style={{ height: `${(i+1)*3+4}px` }}
                                      />
                                    ))}
                                  </div>
                                  <span className={`text-xs font-medium ${signal.color}`}>
                                    {signal.strength}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    ({device.rssi} dBm)
                                  </span>
                                </div>
                              )}
                            </div>
                            <Button 
                              size="sm" 
                              variant="ghost"
                              disabled={connectionState === 'connecting'}
                              className="ml-3 flex-shrink-0"
                            >
                              {connectionState === 'connecting' ? '...' : 'Conectar' }
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  connectionState !== 'scanning' && (
                    <div className="text-center py-8">
                      <Bluetooth className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                      <p className="text-muted-foreground mb-2">No se encontraron dispositivos</p>
                      <p className="text-sm text-muted-foreground">Verifica que tu dispositivo esté encendido.</p>
                    </div>
                  )
                )}
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={stopScan} className="w-full">
                {connectionState === 'scanning' ? 'Cancelar Búsqueda' : 'Cerrar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* WiFi Configuration Modal */}
        <Dialog open={isWifiModalOpen} onOpenChange={setIsWifiModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center space-x-2">
                <Wifi className="w-5 h-5" />
                <span>Configurar WiFi del Dispositivo</span>
              </DialogTitle>
               <DialogDescription>
                  Introduce las credenciales de la red WiFi a la que se conectará el dispositivo ESP32.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
                <div className="space-y-2">
                    <Label htmlFor="ssid">Nombre de Red (SSID)</Label>
                    <Input 
                        id="ssid" 
                        value={wifiSsid} 
                        onChange={(e) => setWifiSsid(e.target.value)} 
                        placeholder="Ej: MiRedWiFi" 
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="password">Contraseña</Label>
                    <div className="relative">
                        <Input 
                            id="password" 
                            type={showPassword ? 'text' : 'password'}
                            value={wifiPassword} 
                            onChange={(e) => setWifiPassword(e.target.value)} 
                            placeholder="Introduce la contraseña"
                            className="pr-10"
                        />
                        <Button 
                            type="button"
                            variant="ghost" 
                            size="icon"
                            className="absolute inset-y-0 right-0 h-full px-3"
                            onClick={() => setShowPassword(p => !p)}
                        >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            <span className="sr-only">{showPassword ? 'Ocultar' : 'Mostrar'}</span>
                        </Button>
                    </div>
                </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setIsWifiModalOpen(false)}>Cancelar</Button>
              <Button onClick={() => sendWifiConfig(wifiSsid, wifiPassword)} disabled={!wifiSsid}>
                <Save className="mr-2 h-4 w-4" />
                Guardar y Enviar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
}