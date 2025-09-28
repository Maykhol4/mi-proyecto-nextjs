'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  RefreshCw,
  Bluetooth,
  Wifi,
  Search,
  XCircle,
  AlertCircle,
  Zap,
  WifiOff,
  BluetoothConnected,
  BluetoothOff,
  Settings,
  Waves,
  Shield,
  CheckCircle,
  Mountain,
  Send,
} from 'lucide-react';
import { useBle } from '@/hooks/use-ble';
import { ScanModal } from '@/components/scan-modal';
import { WifiConfigModal } from '@/components/wifi-config-modal';
import { SCAN_DURATION_MS } from '@/lib/ble-types';
import { useToast } from '@/hooks/use-toast';

export default function HomeClient() {
  const { toast } = useToast();
  const {
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
  } = useBle();
  
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [isWifiModalOpen, setIsWifiModalOpen] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [altitude, setAltitude] = useState('');
  const [configuredAltitude, setConfiguredAltitude] = useState<number | null>(null);

  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (lastSensorData) {
      let altitudeValue: number | undefined = undefined;

      if (lastSensorData.altitude_info && typeof lastSensorData.altitude_info.meters === 'number') {
        altitudeValue = lastSensorData.altitude_info.meters;
      } else if (typeof lastSensorData.altitude_meters === 'number') {
        altitudeValue = lastSensorData.altitude_meters;
      } else if (typeof (lastSensorData as any).altitude_m === 'number') {
        altitudeValue = (lastSensorData as any).altitude_m;
      }
      
      if (altitudeValue !== undefined) {
        setConfiguredAltitude(altitudeValue);
      }
    }
  }, [lastSensorData]);

  const startProgressTracking = useCallback(() => {
    setScanProgress(0);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    progressIntervalRef.current = setInterval(() => {
      setScanProgress(prev => {
        if (prev >= 100) {
          if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
          return 100;
        }
        return prev + (100 / (SCAN_DURATION_MS / 200));
      });
    }, 200);
  }, []);

  const handleStartScan = useCallback(() => {
    if (!isNative) {
      startScan();
      return;
    }
    
    startScan();
    setIsScanModalOpen(true);
    startProgressTracking();
  
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    scanTimeoutRef.current = setTimeout(() => {
      stopScan();
      setIsScanModalOpen(false);
    }, SCAN_DURATION_MS);
  }, [startScan, stopScan, isNative, startProgressTracking]);

  const handleStopScan = useCallback(() => {
    stopScan();
    setIsScanModalOpen(false);
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
  }, [stopScan]);

  const handleConnectToDevice = useCallback((device: any) => {
    handleStopScan();
    connectToDevice(device);
  }, [connectToDevice, handleStopScan]);

  useEffect(() => {
    if (connectionState === 'connected') {
      setIsScanModalOpen(false);
    }
    if (connectionState === 'disconnected') {
      setConfiguredAltitude(null);
    }
  }, [connectionState]);

  const handleSaveWifi = (ssid: string, psk: string) => {
    sendCommand({ type: 'wifi_config', ssid, password: psk });
  };

  const handleSendAltitude = () => {
    const altitudeValue = parseInt(altitude, 10);
    if (isNaN(altitudeValue)) {
      toast({
        title: 'Valor no válido',
        description: 'Por favor, introduce un número válido para la altitud.',
        variant: 'destructive',
      });
      return;
    }
    sendCommand({ type: 'altitude_config', altitude: altitudeValue });
    // Optimistic UI update
    setConfiguredAltitude(altitudeValue);
    setAltitude('');
  };
  
  const wifiStatus = lastSensorData?.wifi_status || 'disconnected';

  const getConnectionStatus = () => {
    switch (connectionState) {
      case 'connected': 
        return { 
          text: 'Conectado', 
          icon: <BluetoothConnected className="w-4 h-4" />, 
          color: 'bg-emerald-50 text-emerald-700 border-emerald-200' 
        };
      case 'connecting': 
        return { 
          text: 'Conectando...', 
          icon: <RefreshCw className="w-4 h-4 animate-spin" />, 
          color: 'bg-blue-50 text-blue-700 border-blue-200' 
        };
      case 'scanning': 
        return { 
          text: 'Buscando...', 
          icon: <Search className="w-4 h-4" />, 
          color: 'bg-amber-50 text-amber-700 border-amber-200' 
        };
      case 'error': 
        return { 
          text: 'Error', 
          icon: <XCircle className="w-4 h-4" />, 
          color: 'bg-red-50 text-red-700 border-red-200' 
        };
      default: 
        return { 
          text: 'Desconectado', 
          icon: <BluetoothOff className="w-4 h-4" />, 
          color: 'bg-gray-50 text-gray-600 border-gray-200' 
        };
    }
  };

  const getWifiStatus = () => {
    switch (wifiStatus) {
      case 'connected': 
        return { 
          text: 'WiFi Conectado', 
          icon: <Wifi className="w-4 h-4" />, 
          color: 'bg-emerald-50 text-emerald-700 border-emerald-200' 
        };
      case 'connecting': 
        return { 
          text: 'WiFi Conectando...', 
          icon: <RefreshCw className="w-4 h-4 animate-spin" />, 
          color: 'bg-amber-50 text-amber-700 border-amber-200' 
        };
      default: 
        return { 
          text: 'WiFi Desconectado', 
          icon: <WifiOff className="w-4 h-4" />, 
          color: 'bg-gray-50 text-gray-600 border-gray-200' 
        };
    }
  };

  const bleStatus = getConnectionStatus();
  const wifiInfo = getWifiStatus();

  const renderDisconnectedState = () => (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Hero Section */}
        <div className="text-center mb-8">
          <div className="relative mb-6">
            <div className="w-24 h-24 mx-auto bg-gradient-to-br from-blue-500 to-cyan-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/25">
              <Waves className="w-12 h-12 text-white" />
            </div>
            <div className="absolute -top-2 -right-2 w-6 h-6 bg-blue-500 rounded-full animate-pulse"></div>
          </div>
          <h1 className="text-4xl font-black text-gray-900 mb-3 tracking-tight">
            AQUADATA
            <span className="text-2xl font-medium text-blue-600 ml-2">2.0</span>
          </h1>
          <p className="text-lg text-gray-600 font-medium">Configurador WiFi IoT</p>
        </div>

        {/* Main Card */}
        <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm">
          <CardHeader className="pb-6">
            <div className="text-center space-y-3">
              <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full text-sm font-medium">
                <Shield className="w-4 h-4" />
                Conexión Bluetooth LE
              </div>
              <CardDescription className="text-base text-gray-600 leading-relaxed px-2">
                Conecta tu dispositivo ESP32 para configurar las credenciales de red WiFi de forma segura e inalámbrica
              </CardDescription>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-6">
            {/* Status Indicator */}
            <div className="flex items-center justify-center">
              <Badge variant="outline" className={`${bleStatus.color} px-4 py-2 text-sm font-medium border`}>
                {bleStatus.icon}
                <span className="ml-2">{bleStatus.text}</span>
              </Badge>
            </div>

            {/* Main Action Button */}
            <Button
              onClick={handleStartScan}
              disabled={connectionState === 'scanning' || connectionState === 'connecting'}
              size="lg"
              className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 shadow-lg shadow-blue-500/25 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              {connectionState === 'scanning' ? (
                <div className="flex items-center gap-3">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>Buscando dispositivos...</span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Search className="w-5 h-5" />
                  <span>Buscar Dispositivo</span>
                </div>
              )}
            </Button>

            {/* Error State */}
            {connectionState === 'error' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center gap-3 text-red-700">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Error de conexión</p>
                    <p className="text-sm text-red-600 mt-1">
                      Verifica que el Bluetooth esté activado y que el dispositivo esté disponible
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer Info */}
        <div className="text-center mt-6 text-sm text-gray-500">
          <p>Asegúrate de que tu dispositivo AQUADATA esté encendido</p>
        </div>
      </div>
    </div>
  );

  const renderConnectedState = () => (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 p-4">
      <div className="max-w-2xl mx-auto pt-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 px-4 py-2 rounded-full text-sm font-medium mb-4">
            <CheckCircle className="w-4 h-4" />
            Dispositivo Conectado
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Panel de Control</h1>
          <p className="text-gray-600">
            <span className="font-medium text-gray-800">{connectedDevice?.name}</span> está listo para configurar
          </p>
        </div>

        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Bluetooth className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Estado Bluetooth</p>
                  <Badge variant="outline" className={`${bleStatus.color} text-xs mt-1 border`}>
                    {bleStatus.icon}
                    <span className="ml-1">{bleStatus.text}</span>
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <Wifi className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Estado WiFi</p>
                  <Badge variant="outline" className={`${wifiInfo.color} text-xs mt-1 border`}>
                    {wifiInfo.icon}
                    <span className="ml-1">{wifiInfo.text}</span>
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Actions Cards */}
        <div className="space-y-6">
          <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm">
            <CardHeader>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Zap className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-xl font-bold text-gray-900 mb-2">
                    Configuración Inalámbrica
                  </CardTitle>
                  <CardDescription className="text-base text-gray-600 leading-relaxed">
                    Envía las credenciales de tu red WiFi al dispositivo AQUADATA para establecer la conexión a internet.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            
            <CardContent className="space-y-4">
              <Button 
                onClick={() => setIsWifiModalOpen(true)} 
                size="lg" 
                className="w-full h-12 text-base font-semibold bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 shadow-lg shadow-blue-500/20 transition-all duration-200 hover:scale-[1.01]"
              >
                <Settings className="mr-3 h-5 w-5" />
                Configurar Red WiFi
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm">
            <CardHeader>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-amber-500 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Mountain className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-xl font-bold text-gray-900 mb-2">
                    Ajuste de Altitud
                  </CardTitle>
                  <CardDescription className="text-base text-gray-600 leading-relaxed">
                    Calibra el sensor barométrico para lecturas más precisas. Introduce la altitud en metros.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 pt-2">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="altitude" className="sr-only">Nueva Altitud</Label>
                  <Input
                    id="altitude"
                    type="number"
                    placeholder="Ej: 550 (metros)"
                    value={altitude}
                    onChange={(e) => setAltitude(e.target.value)}
                    className="h-12 text-base"
                  />
                </div>
                <Button 
                  onClick={handleSendAltitude}
                  size="lg" 
                  className="h-12 font-semibold"
                  disabled={!altitude.trim()}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Enviar
                </Button>
              </div>
            </CardContent>
          </Card>

          <Button 
            onClick={() => disconnect(false)} 
            variant="outline" 
            size="lg"
            className="w-full h-12 text-base font-medium border-2 border-gray-200 hover:border-red-200 hover:bg-red-50 hover:text-red-700 transition-all duration-200"
          >
            <BluetoothOff className="mr-3 h-5 w-5" />
            Desconectar Dispositivo
          </Button>
        </div>

        {/* Device Info */}
        <div className="text-center mt-6 text-sm text-gray-500">
          <p>ID del dispositivo: <span className="font-mono text-gray-700">{connectedDevice?.deviceId}</span></p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {connectionState === 'connected' ? renderConnectedState() : renderDisconnectedState()}

      <ScanModal
        isOpen={isScanModalOpen}
        onOpenChange={setIsScanModalOpen}
        devices={devices}
        connectionState={connectionState}
        scanProgress={scanProgress}
        onConnect={handleConnectToDevice}
        onStopScan={handleStopScan}
      />

      <WifiConfigModal
        isOpen={isWifiModalOpen}
        onOpenChange={setIsWifiModalOpen}
        onSave={handleSaveWifi}
      />
    </>
  );
}
