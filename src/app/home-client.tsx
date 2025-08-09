
'use client';

import React, { useState, type FC, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Droplets,
  Thermometer,
  TestTube,
  Activity,
  Settings,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Bluetooth,
  TrendingUp,
  BluetoothConnected,
  Minus,
  IterationCw,
  Wifi,
  Save,
  BluetoothOff,
  MoreVertical,
  Cloud,
  CloudOff,
  WifiOff,
  Search,
  RefreshCw,
  Download,
  Trash2
} from 'lucide-react';
import type { SensorData, BleConnectorRef } from './ble-connector';
import { initialSensorData, BleConnector } from './ble-connector';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import { useMqtt } from '@/hooks/use-mqtt';
import { saveSensorDataToFirestore } from '@/lib/firebase';


// --- Reusable Components ---
const SensorCard: FC<{
  icon: React.ReactNode;
  title: string;
  value: number | null | undefined;
  unit: string;
  description?: string;
  status: 'normal' | 'warning' | 'critical' | 'error';
}> = ({ icon, title, value, unit, description, status }) => {
  const getStatusColor = () => {
    switch (status) {
      case 'critical': return 'border-destructive bg-destructive/10';
      case 'warning': return 'border-yellow-500 bg-yellow-500/10';
      case 'normal': return 'border-green-500 bg-green-500/10';
      default: return 'border-border bg-card';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'critical': return <XCircle className="w-5 h-5 text-destructive" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'normal': return <CheckCircle className="w-5 h-5 text-green-500" />;
      default: return <XCircle className="w-5 h-5 text-muted-foreground" />;
    }
  };
  
  const hasValue = typeof value === 'number';

  return (
    <Card className={`border-2 ${getStatusColor()} transition-all duration-300 hover:shadow-lg`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-lg">
          <div className="flex items-center space-x-2">{icon}<span>{title}</span></div>
          {getStatusIcon()}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-foreground mb-2">
          {hasValue ? value.toFixed(2) : <Minus className="inline-block h-8 w-8" />}
          <span className="text-xl ml-2 text-muted-foreground">{unit}</span>
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  );
};


const MqttConfigModal: FC<{
  isOpen: boolean;
  onClose: () => void;
  onConnect: () => void;
}> = ({ isOpen, onClose, onConnect }) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Cloud className="w-5 h-5" />
            <span>Conexión al Servidor MQTT</span>
          </DialogTitle>
          <DialogDescription>
            La aplicación se conectará al topic MQTT preconfigurado para recibir los datos de tu dispositivo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 text-sm text-muted-foreground">
            <p>Se utilizará la siguiente configuración:</p>
            <ul className="list-disc pl-5 space-y-1 bg-muted p-3 rounded-md">
                <li><span className="font-semibold">Broker:</span> wss://broker.hivemq.com:8884/mqtt</li>
                <li><span className="font-semibold">Topic:</span> aquadata/sensor-data</li>
            </ul>
            <p>Asegúrate de que tu dispositivo ESP32 esté publicando los datos en este topic.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onConnect}>
            <Cloud className="mr-2 h-4 w-4" />
            Confirmar y Conectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};


const WifiConfigModal: FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (ssid: string, psk: string) => void;
}> = ({isOpen, onClose, onSave}) => {
    const [ssid, setSsid] = useState('');
    const [password, setPassword] = useState('');

    const handleSave = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (!ssid.trim()) {
            return;
        }
        onSave(ssid, password);
        onClose();
    }

    const handleClose = () => {
        setSsid('');
        setPassword('');
        onClose();
    }

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center space-x-2">
                        <Wifi className="w-5 h-5" />
                        <span>Configurar WiFi del Dispositivo</span>
                    </DialogTitle>
                    <DialogDescription>
                        Introduce manualmente las credenciales de la red WiFi a la que se conectará el dispositivo ESP32.
                    </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label htmlFor="ssid">Nombre de Red (SSID)</Label>
                        <Input 
                            id="ssid" 
                            value={ssid} 
                            onChange={(e) => setSsid(e.target.value)} 
                            placeholder="Ej: MiRedWiFi" 
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password">Contraseña</Label>
                        <Input 
                            id="password" 
                            type="password" 
                            value={password} 
                            onChange={(e) => setPassword(e.target.value)} 
                            placeholder="Introduce la contraseña" 
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose}>
                        Cancelar
                    </Button>
                    <Button type="button" onClick={handleSave} disabled={!ssid.trim()}>
                        <Save className="mr-2 h-4 w-4" />
                        Guardar y Enviar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}


// --- Main UI Component ---
export default function HomeClient() {
  const [bleSensorData, setBleSensorData] = useState<SensorData>(initialSensorData);
  const [isBleConnected, setIsBleConnected] = useState(false);
  const [isWifiModalOpen, setIsWifiModalOpen] = useState(false);
  const [isMqttModalOpen, setIsMqttModalOpen] = useState(false);
  const [mode, setMode] = useState<'ble' | 'mqtt' | 'disconnected'>('disconnected');
  const [historyData, setHistoryData] = useState<SensorData[]>([]);
  
  const { connectionStatus: mqttStatus, sensorData: mqttSensorData } = useMqtt(mode === 'mqtt');

  const bleConnectorRef = useRef<BleConnectorRef>(null);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  
  const sensorData = mode === 'mqtt' ? (mqttSensorData || initialSensorData) : bleSensorData;
  
  // Store data history and save to cloud
  useEffect(() => {
    // Save a record if we are in a connected mode and the incoming data has a timestamp
    if (mode !== 'disconnected' && sensorData && sensorData.timestamp && sensorData.timestamp !== initialSensorData.timestamp) {
      const now = new Date();
      // Add a full ISO timestamp for better CSV compatibility
      const dataPointWithTimestamp = {
        ...sensorData,
        iso_timestamp: now.toISOString() 
      };
      setHistoryData(prev => [...prev, dataPointWithTimestamp]);

      // Save to Firestore
      saveSensorDataToFirestore(dataPointWithTimestamp).catch(error => {
        console.error("Error saving to Firestore:", error);
        toast({
            variant: "destructive",
            title: "Error en la nube",
            description: "No se pudo guardar el dato en Firestore."
        });
      });
    }
  }, [sensorData, mode, toast]);


  const getSensorStatus = (
    value: number | null | undefined, criticalMin?: number, criticalMax?: number, warningMin?: number, warningMax?: number
  ): 'critical' | 'warning' | 'normal' | 'error' => {
    if (typeof value !== 'number') return 'error';
    if ((criticalMin !== undefined && value < criticalMin) || (criticalMax !== undefined && value > criticalMax)) return 'critical';
    if ((warningMin !== undefined && value < warningMin) || (warningMax !== undefined && value > warningMax)) return 'warning';
    return 'normal';
  };

  const phStatus = getSensorStatus(sensorData.ph, 6.0, 9.0, 6.5, 8.5);
  const doStatus = getSensorStatus(sensorData.do_conc, 4.0, undefined, 6.0, undefined);
  const tempStatus = getSensorStatus(sensorData.temp, 15, 30, 18, 28);
  const satStatus = getSensorStatus(sensorData.do_sat, 80, 120, 90, 110);
  
  const getStatusColor = (status?: string) => {
    if (typeof status !== 'string') return 'border-l-gray-400';
    if (status.includes('🟢')) return 'border-l-green-500';
    if (status.includes('🟡')) return 'border-l-yellow-500';
    if (status.includes('🔴')) return 'border-l-red-500';
    return 'border-l-gray-400';
  };

  const getWifiStatus = () => {
    if (mode === 'ble') {
      const status = sensorData?.wifi_status;
      if (status === 'connected') return { text: 'WiFi: Conectado', color: 'text-green-600' };
      if (status === 'connecting') return { text: 'WiFi: Conectando...', color: 'text-yellow-600' };
      return { text: 'WiFi: Desconectado', color: 'text-red-600' };
    }
    return null;
  };
  
  const getMqttStatusBadge = () => {
    switch (mqttStatus) {
        case 'Conectado':
            return 'bg-green-600 hover:bg-green-700';
        case 'Conectando':
            return 'bg-yellow-500 hover:bg-yellow-600';
        case 'Error':
        case 'Desconectado':
            return 'bg-red-600 hover:bg-red-700';
        default:
            return 'bg-gray-500 hover:bg-gray-600';
    }
  };

  const wifiStatus = getWifiStatus();

  const handleDisconnect = () => {
    if (mode === 'ble' && bleConnectorRef.current) {
      bleConnectorRef.current.handleDisconnect();
    }
    setMode('disconnected');
    setBleSensorData(initialSensorData);
    setIsBleConnected(false);
  };
  
  const handleSaveWifi = (ssid: string, psk: string) => {
      bleConnectorRef.current?.sendWifiConfig(ssid, psk);
  }

  const handleMqttConnect = () => {
    setMode('mqtt');
    setIsMqttModalOpen(false);
  };

  const handleBleConnect = (connected: boolean) => {
    setIsBleConnected(connected);
    if(connected) {
      setMode('ble');
    } else {
      setMode('disconnected');
    }
  }

  const handleBleConnectClick = () => {
    bleConnectorRef.current?.handleConnect();
  };

  const isBleConnecting = bleConnectorRef.current?.getIsConnecting() || false;
  
  const handleExportCsv = () => {
    if (historyData.length === 0) {
      toast({
        title: "No hay datos",
        description: "No hay datos históricos para exportar.",
        variant: "destructive"
      });
      return;
    }

    const headers = ['iso_timestamp', 'timestamp', 'ph', 'do_conc', 'do_sat', 'temp', 'status'];
    const csvRows = [
      headers.join(',')
    ];

    historyData.forEach(row => {
      const values = headers.map(header => {
        const value = (row as any)[header];
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value}"`; // Quote strings with commas
        }
        return value ?? ''; // Return empty string for null/undefined
      });
      csvRows.push(values.join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const dateStr = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
    const timeStr = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
    
    link.setAttribute("href", url);
    link.setAttribute("download", `aquadata_export_${dateStr}_${timeStr}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
        title: "Exportación Exitosa",
        description: `${historyData.length} registros exportados a CSV.`,
    });
  };

  const handleClearHistory = () => {
    if (historyData.length > 0) {
      setHistoryData([]);
      toast({
        title: "Historial Limpio",
        description: "Se han borrado los datos almacenados en esta sesión.",
      });
    }
  };


  return (
    <>
      <BleConnector
        ref={bleConnectorRef}
        setSensorData={setBleSensorData}
        setIsConnected={handleBleConnect}
        setInitialSensorData={() => setBleSensorData(initialSensorData)}
      />

      <WifiConfigModal 
        isOpen={isWifiModalOpen}
        onClose={() => setIsWifiModalOpen(false)}
        onSave={handleSaveWifi}
      />
      
      <MqttConfigModal
        isOpen={isMqttModalOpen}
        onClose={() => setIsMqttModalOpen(false)}
        onConnect={handleMqttConnect}
      />

      {mode === 'disconnected' ? (
        // --- Disconnected State UI ---
        <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-blue-800 flex items-center justify-center p-4">
          <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "url('data:image/svg+xml,%3Csvg width=\"60\" height=\"60\" viewBox=\"0 0 60 60\" xmlns=\"http://www.w3.org/2000/svg\"%3E%3Cg fill=\"none\" fill-rule=\"evenodd\"%3E%3Cg fill=\"%23ffffff\" fill-opacity=\"0.05\"%3E%3Cpath d=\"M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\"/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')" }}></div>
          <Card className="w-full max-w-md mx-auto bg-white/95 backdrop-blur-sm shadow-2xl border-0">
            <CardHeader className="text-center pb-8">
              <div className="mx-auto mb-6 w-20 h-20 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-full flex items-center justify-center shadow-lg"><Droplets className="w-10 h-10 text-white" /></div>
              <CardTitle className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">AQUADATA 2.0</CardTitle>
              <CardDescription className="text-muted-foreground mt-2 leading-relaxed">Sistema Avanzado de Monitoreo de Calidad del Agua</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="text-center space-y-4">
                  <Button 
                    onClick={handleBleConnectClick} 
                    disabled={isBleConnecting}
                    className="w-full h-12 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold rounded-lg shadow-lg transition-all duration-200 transform hover:scale-105"
                  >
                    {isBleConnecting ? (
                      <>
                        <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                        Buscando...
                      </>
                    ) : (
                      <>
                        <Search className="w-5 h-5 mr-2" />
                        Buscar Dispositivo (BLE)
                      </>
                    )}
                  </Button>
                </div>
                 <Button onClick={() => setIsMqttModalOpen(true)} className="w-full bg-green-600 hover:bg-green-700">
                    <Cloud className="mr-2 h-4 w-4" />
                    Conectar Online (MQTT)
                  </Button>
                <div className="border-t pt-4 mt-2">
                    <div className="flex items-center justify-center space-x-4 text-sm text-muted-foreground">
                        <div className="flex items-center space-x-1"><div className="w-2 h-2 bg-green-500 rounded-full"></div><span>Tiempo Real</span></div>
                        <div className="flex items-center space-x-1"><div className="w-2 h-2 bg-blue-500 rounded-full"></div><span>Múltiples Sensores</span></div>
                    </div>
                </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        // --- Connected State UI ---
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
          <header className="bg-white shadow-sm border-b sticky top-0 z-40">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center"><Droplets className="w-6 h-6 text-white" /></div>
                  <div><h1 className="text-xl font-bold text-gray-900">AQUADATA 2.0</h1><p className="text-sm text-muted-foreground">Monitor Web</p></div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge variant={'default'} className={`flex items-center space-x-2 ${mode === 'ble' ? 'bg-blue-600 hover:bg-blue-700' : getMqttStatusBadge()}`}>
                    {mode === 'ble' ? (isBleConnected ? <BluetoothConnected className="w-4 h-4" /> : <Bluetooth className="w-4 h-4" />) : <Cloud className="w-4 h-4" />}
                    <span>{mode === 'ble' ? (isBleConnected ? 'Conectado (BLE)' : 'Desconectado') : `MQTT: ${mqttStatus}`}</span>
                  </Badge>
                  
                  {isMobile ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setIsWifiModalOpen(true)} disabled={mode !== 'ble' || !isBleConnected}>
                          <Settings className="mr-2 h-4 w-4" />
                          <span>Ajustes WiFi</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={handleDisconnect}>
                          {mode === 'mqtt' ? <CloudOff className="mr-2 h-4 w-4" /> : <BluetoothOff className="mr-2 h-4 w-4" />}
                          <span>{mode === 'mqtt' ? 'Desconectar MQTT' : 'Desconectar'}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <>
                      <Button onClick={() => setIsWifiModalOpen(true)} variant="outline" size="sm" disabled={mode !== 'ble' || !isBleConnected}>
                          <Settings className="mr-2 h-4 w-4" />
                          Ajustes WiFi
                      </Button>
                      <Button onClick={handleDisconnect} variant="destructive" size="sm">
                        {mode === 'mqtt' ? <CloudOff className="mr-2 h-4 w-4" /> : <BluetoothOff className="mr-2 h-4 w-4" />}
                        {mode === 'mqtt' ? 'Desconectar MQTT' : 'Desconectar'}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </header>

          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <Card className={`mb-8 border-l-4 ${getStatusColor(sensorData.status)}`}>
              <CardContent className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center space-x-2"><CheckCircle className="w-5 h-5 text-green-500" /><span className="font-semibold">Estado:</span><span className="text-green-600">{sensorData.status || 'N/A'}</span></div>
                  <div className="flex items-center space-x-2"><Activity className="w-5 h-5 text-primary" /><span className="font-semibold">Última lectura:</span><span className="text-primary">{sensorData.timestamp}</span></div>
                  {wifiStatus && (
                    <div className={`flex items-center space-x-2 ${wifiStatus.color}`}>
                      <Wifi className="w-5 h-5" />
                      <span className="font-semibold">{wifiStatus.text}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <SensorCard icon={<TestTube className="w-5 h-5 text-blue-600" />} title="pH del Agua" value={sensorData.ph} unit="" description="Unidades de pH (6.5-8.5 óptimo)" status={phStatus} />
                <SensorCard icon={<Droplets className="w-5 h-5 text-cyan-600" />} title="Oxígeno Disuelto" value={sensorData.do_conc} unit="mg/L" description=">6.0 óptimo" status={doStatus} />
                <SensorCard icon={<TrendingUp className="w-5 h-5 text-purple-600" />} title="Saturación O₂" value={sensorData.do_sat} unit="%" description="80-120% óptimo" status={satStatus} />
                <SensorCard icon={<Thermometer className="w-5 h-5 text-orange-600" />} title="Temperatura" value={sensorData.temp} unit="°C" description="18-28°C óptimo" status={tempStatus} />
            </div>

            <Card className="mb-8">
              <CardHeader>
                <CardTitle>
                  <div className="flex items-center space-x-2">
                    <TrendingUp className="w-5 h-5" />
                    <span>Estadísticas del Dispositivo</span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="text-center p-4 bg-blue-50 rounded-lg"><div className="text-2xl font-bold text-blue-600">{sensorData.readings_count?.ph ?? 0}</div><div className="text-sm text-muted-foreground mt-1">Lecturas pH exitosas</div></div>
                  <div className="text-center p-4 bg-cyan-50 rounded-lg"><div className="text-2xl font-bold text-cyan-600">{sensorData.readings_count?.do ?? 0}</div><div className="text-sm text-muted-foreground mt-1">Lecturas DO exitosas</div></div>
                  <div className="text-center p-4 bg-red-50 rounded-lg"><div className="text-2xl font-bold text-red-600">{sensorData.errors_count?.ph ?? 0}</div><div className="text-sm text-muted-foreground mt-1">Errores pH</div></div>
                  <div className="text-center p-4 bg-orange-50 rounded-lg"><div className="text-2xl font-bold text-orange-600">{sensorData.errors_count?.do ?? 0}</div><div className="text-sm text-muted-foreground mt-1">Errores DO</div></div>
                </div>
              </CardContent>
              <CardFooter className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-4">
                 <Button onClick={handleExportCsv} variant="outline" size="sm" disabled={historyData.length === 0}>
                   <Download className="mr-2 h-4 w-4" />
                   Exportar CSV ({historyData.length})
                 </Button>
                 <Button onClick={handleClearHistory} variant="destructive" size="sm" disabled={historyData.length === 0}>
                   <Trash2 className="mr-2 h-4 w-4" />
                   Limpiar Historial
                 </Button>
              </CardFooter>
            </Card>
          </main>
        </div>
      )}
    </>
  );
}
