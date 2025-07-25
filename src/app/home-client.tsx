
'use client';

import React, { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Droplets,
  Thermometer,
  TestTube,
  Activity,
  Settings,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Bluetooth,
  TrendingUp,
  BluetoothConnected,
  Minus,
  IterationCw,
} from 'lucide-react';
import type { BleDevice, BleClientInterface } from '@capacitor-community/bluetooth-le';

import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const UART_RX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

interface SensorData {
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

const initialSensorData: SensorData = {
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

const SensorCard: FC<{
  icon: React.ReactNode;
  title: string;
  value: number | null;
  unit: string;
  description?: string;
  status: 'normal' | 'warning' | 'critical' | 'error';
}> = ({ icon, title, value, unit, description, status }) => {
  const getStatusColor = () => {
    switch (status) {
      case 'critical':
        return 'border-destructive bg-destructive/10';
      case 'warning':
        return 'border-yellow-500 bg-yellow-500/10';
      case 'normal':
        return 'border-green-500 bg-green-500/10';
      default:
        return 'border-border bg-card';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'critical':
        return <XCircle className="w-5 h-5 text-destructive" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'normal':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      default:
        return <XCircle className="w-5 h-5 text-muted-foreground" />;
    }
  };

  return (
    <Card className={`border-2 ${getStatusColor()} transition-all duration-300 hover:shadow-lg`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-lg">
          <div className="flex items-center space-x-2">
            {icon}
            <span>{title}</span>
          </div>
          {getStatusIcon()}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-foreground mb-2">
          {value !== null ? value.toFixed(2) : <Minus className="inline-block h-8 w-8" />}
          <span className="text-xl ml-2 text-muted-foreground">{unit}</span>
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  );
};


export default function HomeClient() {
  const { toast } = useToast();
  const [sensorData, setSensorData] = useState<SensorData>(initialSensorData);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [deviceName, setDeviceName] = useState('AQUADATA-2.0');
  const [tempDeviceName, setTempDeviceName] = useState('AQUADATA-2.0');
  const [isBleInitialized, setIsBleInitialized] = useState(false);

  const bleDeviceRef = useRef<BleDevice | null>(null);
  const bleClientRef = useRef<BleClientInterface | null>(null);
  const receivedDataBuffer = useRef('');

  useEffect(() => {
    const initializeBle = async () => {
      try {
        const { BleClient } = await import('@capacitor-community/bluetooth-le');
        bleClientRef.current = BleClient;
        await bleClientRef.current.initialize({ androidNeverForLocation: true });
        setIsBleInitialized(true);
      } catch (error) {
        console.error('Error initializing BleClient', error);
        toast({
          variant: 'destructive',
          title: 'BLE Error',
          description: 'Could not initialize Bluetooth LE client. Please ensure Bluetooth is enabled and permissions are granted.',
        });
      }
    };
    
    // Ensure this runs only on the client
    if (typeof window !== 'undefined') {
      initializeBle();
    }
    
    const savedName = localStorage.getItem('bleDeviceName');
    if (savedName) {
      setDeviceName(savedName);
      setTempDeviceName(savedName);
    }
  }, [toast]);

  const onDisconnected = useCallback(() => {
    bleDeviceRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
    setSensorData(initialSensorData);
    toast({
      title: 'Disconnected',
      description: 'Bluetooth device has been disconnected.',
    });
  }, [toast]);

  const handleData = useCallback((data: SensorData) => {
    setSensorData(data);
  }, []);

  const handleConnect = async () => {
    if (!isBleInitialized || !bleClientRef.current) {
      toast({
        variant: 'destructive',
        title: 'Bluetooth Not Ready',
        description: 'Bluetooth LE client is not initialized yet. Please wait or try again.',
      });
      return;
    }
    
    const BleClient = bleClientRef.current;
    setIsConnecting(true);
    try {
      const device = await BleClient.requestDevice({
        name: deviceName,
        optionalServices: [UART_SERVICE_UUID],
      });
      
      bleDeviceRef.current = device;
      
      await BleClient.connect(device.deviceId, onDisconnected);
      
      const decoder = new TextDecoder();
      
      await BleClient.startNotifications(
        device.deviceId,
        UART_SERVICE_UUID,
        UART_TX_CHARACTERISTIC_UUID,
        (value) => {
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
                  console.error('Failed to parse JSON:', error, 'Message:', `"${message}"`);
                }
              }
            });
          }
        }
      );

      setIsConnected(true);
      toast({
        title: 'Connected!',
        description: `Successfully connected to ${deviceName}.`,
      });
    } catch (error) {
      console.error('Connection failed:', error);
      toast({
        variant: 'destructive',
        title: 'Connection Failed',
        description: (error as Error).message,
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    const BleClient = bleClientRef.current;
    if (bleDeviceRef.current && BleClient) {
        try {
            await BleClient.disconnect(bleDeviceRef.current.deviceId);
            // onDisconnected is called by the connect listener
        } catch(error) {
            console.error("Failed to disconnect", error);
            // Force disconnection state if error
            onDisconnected();
        }
    }
  };

  const handleSaveSettings = () => {
    setDeviceName(tempDeviceName);
    localStorage.setItem('bleDeviceName', tempDeviceName);
    setIsSettingsOpen(false);
    toast({
      title: 'Settings Saved',
      description: `Device name updated to ${tempDeviceName}.`,
    });
  };

  const getSensorStatus = (
    value: number | null,
    criticalMin?: number,
    criticalMax?: number,
    warningMin?: number,
    warningMax?: number
  ): 'critical' | 'warning' | 'normal' | 'error' => {
    if (value === null) return 'error';
    if ((criticalMin !== undefined && value < criticalMin) || (criticalMax !== undefined && value > criticalMax))
      return 'critical';
    if ((warningMin !== undefined && value < warningMin) || (warningMax !== undefined && value > warningMax))
      return 'warning';
    return 'normal';
  };

  const phStatus = getSensorStatus(sensorData.ph, 6.0, 9.0, 6.5, 8.5);
  const doStatus = getSensorStatus(sensorData.do_conc, 4.0, undefined, 6.0, undefined);
  const tempStatus = getSensorStatus(sensorData.temp, 15, 30, 18, 28);
  const satStatus = getSensorStatus(sensorData.do_sat, 80, 120, 90, 110);

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-blue-800 flex items-center justify-center p-4">
        <div 
          className="absolute inset-0 opacity-30"
          style={{ backgroundImage: "url('data:image/svg+xml,%3Csvg width=\"60\" height=\"60\" viewBox=\"0 0 60 60\" xmlns=\"http://www.w3.org/2000/svg\"%3E%3Cg fill=\"none\" fill-rule=\"evenodd\"%3E%3Cg fill=\"%23ffffff\" fill-opacity=\"0.05\"%3E%3Cpath d=\"M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\"/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')" }}
        ></div>
        <Card className="w-full max-w-md mx-auto bg-white/95 backdrop-blur-sm shadow-2xl border-0">
          <CardHeader className="text-center pb-8">
            <div className="mx-auto mb-6 w-20 h-20 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-full flex items-center justify-center shadow-lg">
              <Droplets className="w-10 h-10 text-white" />
            </div>
            <CardTitle className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
              AQUADATA 2.0
            </CardTitle>
            <CardDescription className="text-muted-foreground mt-2 leading-relaxed">
              Sistema Avanzado de Monitoreo de Calidad del Agua
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center space-x-2 text-muted-foreground">
                <Bluetooth className="w-5 h-5" />
                <span>Conéctese a su dispositivo {deviceName}</span>
              </div>
              <Button
                onClick={handleConnect}
                disabled={isConnecting || !isBleInitialized}
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold rounded-lg shadow-lg transition-all duration-200 transform hover:scale-105"
              >
                {isConnecting ? (
                  <>
                    <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                    Conectando...
                  </>
                ) : (
                  <>
                    <Bluetooth className="w-5 h-5 mr-2" />
                    Conectar a {deviceName}
                  </>
                )}
              </Button>
              <div className="text-sm text-muted-foreground flex items-center justify-center space-x-1">
                <span>¿Nombre incorrecto?</span>
                <button onClick={() => setIsSettingsOpen(true)} className="text-blue-600 hover:text-blue-700 underline">
                  Cambiar en configuración
                </button>
              </div>
            </div>
            <div className="border-t pt-4">
              <div className="flex items-center justify-center space-x-4 text-sm text-muted-foreground">
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span>Tiempo Real</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span>Múltiples Sensores</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                  <span>Alertas Nativas</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    if (status.includes('🟢')) return 'border-l-green-500';
    if (status.includes('🟡')) return 'border-l-yellow-500';
    if (status.includes('🔴')) return 'border-l-red-500';
    return 'border-l-gray-400';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <header className="bg-white shadow-sm border-b sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center">
                <Droplets className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">AQUADATA 2.0</h1>
                <p className="text-sm text-muted-foreground">Monitor Web</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <Badge variant={isConnected ? 'default' : 'destructive'} className="flex items-center space-x-1">
                {isConnected ? <BluetoothConnected className="w-3 h-3" /> : <Bluetooth className="w-3 h-3" />}
                <span>{isConnected ? 'Conectado' : 'Desconectado'}</span>
              </Badge>
              <Button variant="outline" size="icon" onClick={() => setIsSettingsOpen(true)}>
                <Settings className="w-4 h-4" />
                <span className="sr-only">Configuración</span>
              </Button>
              <Button onClick={handleDisconnect} variant="destructive" size="sm">
                Desconectar
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card className={`mb-8 border-l-4 ${getStatusColor(sensorData.status)}`}>
          <CardContent className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span className="font-semibold">Estado:</span>
                <span className="text-green-600">{sensorData.status}</span>
              </div>
              <div className="flex items-center space-x-2">
                <Activity className="w-5 h-5 text-primary" />
                <span className="font-semibold">Última lectura:</span>
                <span className="text-primary">{sensorData.timestamp}</span>
              </div>
              <div className="flex items-center space-x-2">
                <IterationCw className="w-5 h-5 text-primary" />
                <span className="font-semibold">Ciclo de simulación:</span>
                <span className="text-primary">#{sensorData.simulation_cycle}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <SensorCard icon={<TestTube className="w-5 h-5 text-blue-600" />} title="pH del Agua" value={sensorData.ph} unit="" description="Unidades de pH (6.5-8.5 óptimo)" status={phStatus} />
            <SensorCard icon={<Droplets className="w-5 h-5 text-cyan-600" />} title="Oxígeno Disuelto" value={sensorData.do_conc} unit="mg/L" description=">6.0 óptimo" status={doStatus} />
            <SensorCard icon={<TrendingUp className="w-5 h-5 text-purple-600" />} title="Saturación O₂" value={sensorData.do_sat} unit="%" description="80-120% óptimo" status={satStatus} />
            <SensorCard icon={<Thermometer className="w-5 h-5 text-orange-600" />} title="Temperatura" value={sensorData.temp} unit="°C" description="18-28°C óptimo" status={tempStatus} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <TrendingUp className="w-5 h-5" />
              <span>Estadísticas del Dispositivo</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{sensorData.readings_count.ph}</div>
                <div className="text-sm text-muted-foreground mt-1">Lecturas pH exitosas</div>
              </div>
              <div className="text-center p-4 bg-cyan-50 rounded-lg">
                <div className="text-2xl font-bold text-cyan-600">{sensorData.readings_count.do}</div>
                <div className="text-sm text-muted-foreground mt-1">Lecturas DO exitosas</div>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">{sensorData.errors_count.ph}</div>
                <div className="text-sm text-muted-foreground mt-1">Errores pH</div>
              </div>
              <div className="text-center p-4 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-600">{sensorData.errors_count.do}</div>
                <div className="text-sm text-muted-foreground mt-1">Errores DO</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
      
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bluetooth Settings</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="device-name" className="text-right">Device Name</Label>
              <Input
                id="device-name"
                value={tempDeviceName}
                onChange={(e) => setTempDeviceName(e.target.value)}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSettingsOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveSettings}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

    