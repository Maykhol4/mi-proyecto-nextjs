'use client';

import React, { useState, type FC, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Droplets,
  Settings,
  Bluetooth,
  BluetoothConnected,
  Wifi,
  Save,
  BluetoothOff,
  Search,
  RefreshCw,
  Eye,
  EyeOff
} from 'lucide-react';
import type { BleConnectorRef, ConnectionState } from './ble-connector';
import { BleConnector } from './ble-connector';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const WifiConfigModal: FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (ssid: string, psk: string) => void;
}> = ({isOpen, onClose, onSave}) => {
    const [ssid, setSsid] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

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
        setShowPassword(false);
        onClose();
    }
    
    const toggleShowPassword = () => setShowPassword(prev => !prev);

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="max-w-md">
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
                            value={ssid} 
                            onChange={(e) => setSsid(e.target.value)} 
                            placeholder="Ej: MiRedWiFi" 
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password">Contraseña</Label>
                        <div className="relative">
                            <Input 
                                id="password" 
                                type={showPassword ? 'text' : 'password'}
                                value={password} 
                                onChange={(e) => setPassword(e.target.value)} 
                                placeholder="Introduce la contraseña"
                                className="pr-10"
                            />
                            <Button 
                                type="button"
                                variant="ghost" 
                                size="icon"
                                className="absolute inset-y-0 right-0 h-full px-3"
                                onClick={toggleShowPassword}
                            >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                <span className="sr-only">{showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}</span>
                            </Button>
                        </div>
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
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isWifiModalOpen, setIsWifiModalOpen] = useState(false);
  
  const bleConnectorRef = useRef<BleConnectorRef>(null);
  
  const isConnected = connectionState === 'connected';
  const isConnectingOrScanning = connectionState === 'connecting' || connectionState === 'scanning';

  const handleSaveWifi = (ssid: string, psk: string) => {
      bleConnectorRef.current?.sendWifiConfig(ssid, psk);
  }

  const handleBleConnectClick = () => {
    bleConnectorRef.current?.startScan();
  };

  const handleDisconnect = () => {
    bleConnectorRef.current?.disconnect();
  };

  const getStatusBadge = () => {
    switch (connectionState) {
        case 'connected':
            return 'bg-blue-600 hover:bg-blue-700';
        case 'connecting':
        case 'scanning':
            return 'bg-yellow-500 hover:bg-yellow-600';
        case 'disconnected':
        default:
            return 'bg-red-600 hover:bg-red-700';
    }
  };
  
  const getConnectionStateText = () => {
      switch(connectionState) {
          case 'connected': return 'Conectado (BLE)';
          case 'connecting': return 'Conectando...';
          case 'scanning': return 'Buscando...';
          case 'disconnected': return 'Desconectado';
      }
  }


  return (
    <>
      <BleConnector
        ref={bleConnectorRef}
        onConnectionStateChanged={setConnectionState}
      />

      <WifiConfigModal 
        isOpen={isWifiModalOpen}
        onClose={() => setIsWifiModalOpen(false)}
        onSave={handleSaveWifi}
      />

      {connectionState === 'disconnected' ? (
        // --- Disconnected State UI ---
        <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-blue-800 flex items-center justify-center p-4">
          <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "url('data:image/svg+xml,%3Csvg width=\"60\" height=\"60\" viewBox=\"0 0 60 60\" xmlns=\"http://www.w3.org/2000/svg\"%3E%3Cg fill=\"none\" fill-rule=\"evenodd\"%3E%3Cg fill=\"%23ffffff\" fill-opacity=\"0.05\"%3E%3Cpath d=\"M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\"/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')" }}></div>
          <Card className="w-full max-w-md mx-auto bg-white/95 backdrop-blur-sm shadow-2xl border-0">
            <CardHeader className="text-center pb-8">
              <div className="mx-auto mb-6 w-20 h-20 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-full flex items-center justify-center shadow-lg"><Droplets className="w-10 h-10 text-white" /></div>
              <CardTitle className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">AQUADATA 2.0</CardTitle>
              <CardDescription className="text-muted-foreground mt-2 leading-relaxed">Herramienta de Configuración WiFi</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="text-center space-y-4">
                  <Button 
                    onClick={handleBleConnectClick} 
                    disabled={isConnectingOrScanning}
                    className="w-full h-12 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold rounded-lg shadow-lg transition-all duration-200 transform hover:scale-105"
                  >
                    {isConnectingOrScanning ? (
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
                  <div><h1 className="text-xl font-bold text-gray-900">AQUADATA 2.0</h1><p className="text-sm text-muted-foreground">Configurador WiFi</p></div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge variant={'default'} className={`flex items-center space-x-2 ${getStatusBadge()}`}>
                    {isConnected ? <BluetoothConnected className="w-4 h-4" /> : <Bluetooth className="w-4 h-4" />}
                    <span>{getConnectionStateText()}</span>
                  </Badge>
                  <Button onClick={handleDisconnect} variant="destructive" size="sm">
                    <BluetoothOff className="mr-2 h-4 w-4" />
                    Desconectar
                  </Button>
                </div>
              </div>
            </div>
          </header>

          <main className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <Card>
                <CardHeader>
                    <CardTitle className="text-center">Dispositivo Conectado</CardTitle>
                    <CardDescription className="text-center">
                        Ahora puedes enviar la configuración WiFi a tu dispositivo AQUADATA.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center">
                    <Button onClick={() => setIsWifiModalOpen(true)} size="lg">
                        <Settings className="mr-2 h-5 w-5" />
                        Configurar WiFi
                    </Button>
                </CardContent>
            </Card>
          </main>
        </div>
      )}
    </>
  );
}
