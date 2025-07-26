'use client';

import React, { useState, type FC } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
} from 'lucide-react';
import type { SensorData } from './ble-connector';
import { initialSensorData } from './ble-connector';

// Carga dinámica del conector BLE. Este es el paso CRÍTICO.
// `ssr: false` asegura que este componente NUNCA se ejecute en el servidor.
const BleConnector = dynamic(() => import('./ble-connector').then(mod => mod.BleConnector), {
  ssr: false,
  loading: () => <Button disabled className="w-full h-12">Cargando Módulo Bluetooth...</Button>,
});

// --- Reusable Components ---
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
          {value !== null ? value.toFixed(2) : <Minus className="inline-block h-8 w-8" />}
          <span className="text-xl ml-2 text-muted-foreground">{unit}</span>
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  );
};


// --- Main UI Component ---
export default function HomeClient() {
  const [sensorData, setSensorData] = useState<SensorData>(initialSensorData);
  const [isConnected, setIsConnected] = useState(false);
  
  const getSensorStatus = (
    value: number | null, criticalMin?: number, criticalMax?: number, warningMin?: number, warningMax?: number
  ): 'critical' | 'warning' | 'normal' | 'error' => {
    if (value === null) return 'error';
    if ((criticalMin !== undefined && value < criticalMin) || (criticalMax !== undefined && value > criticalMax)) return 'critical';
    if ((warningMin !== undefined && value < warningMin) || (warningMax !== undefined && value > warningMax)) return 'warning';
    return 'normal';
  };

  const phStatus = getSensorStatus(sensorData.ph, 6.0, 9.0, 6.5, 8.5);
  const doStatus = getSensorStatus(sensorData.do_conc, 4.0, undefined, 6.0, undefined);
  const tempStatus = getSensorStatus(sensorData.temp, 15, 30, 18, 28);
  const satStatus = getSensorStatus(sensorData.do_sat, 80, 120, 90, 110);
  
  const getStatusColor = (status: string) => {
    if (status.includes('🟢')) return 'border-l-green-500';
    if (status.includes('🟡')) return 'border-l-yellow-500';
    if (status.includes('🔴')) return 'border-l-red-500';
    return 'border-l-gray-400';
  };

  return (
    <>
      {/* El BleConnector está aislado y solo se carga en el cliente.
          Maneja toda la lógica de BT y se comunica mediante props. */}
      <BleConnector
        setSensorData={setSensorData}
        setIsConnected={setIsConnected}
        setInitialSensorData={() => setSensorData(initialSensorData)}
      />

      {!isConnected ? (
        // --- Disconnected State UI ---
        <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-blue-800 flex items-center justify-center p-4">
          <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "url('data:image/svg+xml,%3Csvg width=\"60\" height=\"60\" viewBox=\"0 0 60 60\" xmlns=\"http://www.w3.org/2000/svg\"%3E%3Cg fill=\"none\" fill-rule=\"evenodd\"%3E%3Cg fill=\"%23ffffff\" fill-opacity=\"0.05\"%3E%3Cpath d=\"M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\"/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')" }}></div>
          <Card className="w-full max-w-md mx-auto bg-white/95 backdrop-blur-sm shadow-2xl border-0">
            <CardHeader className="text-center pb-8">
              <div className="mx-auto mb-6 w-20 h-20 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-full flex items-center justify-center shadow-lg"><Droplets className="w-10 h-10 text-white" /></div>
              <CardTitle className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">AQUADATA 2.0</CardTitle>
              <CardDescription className="text-muted-foreground mt-2 leading-relaxed">Sistema Avanzado de Monitoreo de Calidad del Agua</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* El BleConnector renderizará aquí sus botones usando un Portal. */}
                <div id="ble-actions-container" className="text-center space-y-4"></div>
                <div className="border-t pt-4">
                    <div className="flex items-center justify-center space-x-4 text-sm text-muted-foreground">
                        <div className="flex items-center space-x-1"><div className="w-2 h-2 bg-green-500 rounded-full"></div><span>Tiempo Real</span></div>
                        <div className="flex items-center space-x-1"><div className="w-2 h-2 bg-blue-500 rounded-full"></div><span>Múltiples Sensores</span></div>
                        <div className="flex items-center space-x-1"><div className="w-2 h-2 bg-purple-500 rounded-full"></div><span>Alertas Nativas</span></div>
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
                <div className="flex items-center space-x-4">
                  <Badge variant={isConnected ? 'default' : 'destructive'} className="flex items-center space-x-1">{isConnected ? <BluetoothConnected className="w-3 h-3" /> : <Bluetooth className="w-3 h-3" />}<span>{isConnected ? 'Conectado' : 'Desconectado'}</span></Badge>
                  {/* El BleConnector renderizará aquí sus botones usando un Portal. */}
                  <div id="ble-actions-container-connected" className="flex items-center space-x-2"></div>
                </div>
              </div>
            </div>
          </header>

          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <Card className={`mb-8 border-l-4 ${getStatusColor(sensorData.status)}`}>
              <CardContent className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center space-x-2"><CheckCircle className="w-5 h-5 text-green-500" /><span className="font-semibold">Estado:</span><span className="text-green-600">{sensorData.status}</span></div>
                  <div className="flex items-center space-x-2"><Activity className="w-5 h-5 text-primary" /><span className="font-semibold">Última lectura:</span><span className="text-primary">{sensorData.timestamp}</span></div>
                  <div className="flex items-center space-x-2"><IterationCw className="w-5 h-5 text-primary" /><span className="font-semibold">Ciclo de simulación:</span><span className="text-primary">#{sensorData.simulation_cycle}</span></div>
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
              <CardHeader><CardTitle className="flex items-center space-x-2"><TrendingUp className="w-5 h-5" /><span>Estadísticas del Dispositivo</span></CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="text-center p-4 bg-blue-50 rounded-lg"><div className="text-2xl font-bold text-blue-600">{sensorData.readings_count.ph}</div><div className="text-sm text-muted-foreground mt-1">Lecturas pH exitosas</div></div>
                  <div className="text-center p-4 bg-cyan-50 rounded-lg"><div className="text-2xl font-bold text-cyan-600">{sensorData.readings_count.do}</div><div className="text-sm text-muted-foreground mt-1">Lecturas DO exitosas</div></div>
                  <div className="text-center p-4 bg-red-50 rounded-lg"><div className="text-2xl font-bold text-red-600">{sensorData.errors_count.ph}</div><div className="text-sm text-muted-foreground mt-1">Errores pH</div></div>
                  <div className="text-center p-4 bg-orange-50 rounded-lg"><div className="text-2xl font-bold text-orange-600">{sensorData.errors_count.do}</div><div className="text-sm text-muted-foreground mt-1">Errores DO</div></div>
                </div>
              </CardContent>
            </Card>
          </main>
        </div>
      )}
    </>
  );
}
