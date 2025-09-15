'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wifi, Save, Eye, EyeOff } from 'lucide-react';

interface WifiConfigModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (ssid: string, psk: string) => void;
}

export function WifiConfigModal({ isOpen, onOpenChange, onSave }: WifiConfigModalProps) {
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSave = () => {
    if (wifiSsid) {
      onSave(wifiSsid, wifiPassword);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!wifiSsid}>
            <Save className="mr-2 h-4 w-4" />
            Guardar y Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
