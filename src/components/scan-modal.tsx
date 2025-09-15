'use client';

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Search, RefreshCw, Zap, Bluetooth } from 'lucide-react';
import type { BleDevice, ConnectionState } from '@/lib/ble-types';

interface ScanModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  devices: BleDevice[];
  connectionState: ConnectionState;
  scanProgress: number;
  onConnect: (device: BleDevice) => void;
  onStopScan: () => void;
}

const getSignalStrength = (rssi: number) => {
  if (rssi > -60) return { strength: 'Excelente', color: 'text-green-500', bars: 4 };
  if (rssi > -70) return { strength: 'Buena', color: 'text-green-400', bars: 3 };
  if (rssi > -80) return { strength: 'Regular', color: 'text-yellow-500', bars: 2 };
  return { strength: 'Débil', color: 'text-red-500', bars: 1 };
};

export function ScanModal({
  isOpen,
  onOpenChange,
  devices,
  connectionState,
  scanProgress,
  onConnect,
  onStopScan,
}: ScanModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
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
                  <Card key={device.deviceId} className="hover:bg-accent transition-colors cursor-pointer" onClick={() => onConnect(device)}>
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
                                    style={{ height: `${(i + 1) * 3 + 4}px` }}
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
                          {connectionState === 'connecting' ? '...' : 'Conectar'}
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
          <Button variant="outline" onClick={onStopScan} className="w-full">
            {connectionState === 'scanning' ? 'Cancelar Búsqueda' : 'Cerrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
