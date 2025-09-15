'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wifi, Save, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface WifiConfigModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (ssid: string, psk: string) => void;
}

export function WifiConfigModal({ isOpen, onOpenChange, onSave }: WifiConfigModalProps) {
  const { toast } = useToast();
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSave = () => {
    if (!wifiSsid.trim()) {
      toast({
        title: 'Campo Requerido',
        description: 'Por favor, introduce el nombre de la red (SSID).',
        variant: 'destructive',
      });
      return;
    }
    onSave(wifiSsid, wifiPassword);
    onOpenChange(false);
  };
  
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Reset state on close
      setWifiSsid('');
      setWifiPassword('');
      setShowPassword(false);
    }
    onOpenChange(open);
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2 text-xl">
            <Wifi className="w-5 h-5" />
            <span>Configurar WiFi del Dispositivo</span>
          </DialogTitle>
          <DialogDescription>
            Introduce las credenciales de la red WiFi a la que se conectará tu dispositivo AQUADATA.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="ssid" className="font-semibold">Nombre de Red (SSID)</Label>
            <Input
              id="ssid"
              value={wifiSsid}
              onChange={(e) => setWifiSsid(e.target.value)}
              placeholder="Ej: MiRedWiFi"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña de la Red</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={wifiPassword}
                onChange={(e) => setWifiPassword(e.target.value)}
                placeholder="Introduce la contraseña"
                className="pr-10"
                autoComplete="current-password"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute inset-y-0 right-0 h-full px-3 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword(p => !p)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                <span className="sr-only">{showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}</span>
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave}>
            <Save className="mr-2 h-4 w-4" />
            Guardar y Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
