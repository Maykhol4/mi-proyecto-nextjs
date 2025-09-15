'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
} from 'lucide-react';
import { useBle } from '@/hooks/use-ble';
import { ScanModal } from '@/components/scan-modal';
import { WifiConfigModal } from '@/components/wifi-config-modal';
import { SCAN_DURATION_MS } from '@/lib/ble-types';

export default function HomeClient() {
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

  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
    startScan();
    if (isNative) {
      setIsScanModalOpen(true);
      startProgressTracking();
      scanTimeoutRef.current = setTimeout(() => {
        stopScan();
        setIsScanModalOpen(false);
      }, SCAN_DURATION_MS);
    }
  }, [startScan, isNative, startProgressTracking, stopScan]);

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
  }, [connectionState]);

  const handleSaveWifi = (ssid: string, psk: string) => {
    sendCommand({ type: 'wifi_config', ssid, password: psk });
  };
  
  const wifiStatus = lastSensorData?.wifi_status || 'disconnected';

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
            onClick={handleStartScan}
            disabled={connectionState === 'scanning' || connectionState === 'connecting'}
            className="w-full h-12"
          >
            {connectionState === 'scanning' ? (
              <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /><span>Buscando...</span></>
            ) : (
              <><Search className="w-5 h-5 mr-2" /><span>Buscar Dispositivo</span></>
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
          <Button onClick={() => setIsWifiModalOpen(true)} size="lg" className="w-full h-12">
            <Settings className="mr-2 h-5 w-5" />
            Configurar WiFi del Dispositivo
          </Button>
          <Button onClick={() => disconnect(false)} variant="destructive" className="w-full h-12">
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
