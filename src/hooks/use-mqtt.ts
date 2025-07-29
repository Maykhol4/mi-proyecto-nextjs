'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import mqtt, { MqttClient, ISubscriptionGrant } from 'mqtt';
import { useToast } from './use-toast';
import { type SensorData } from '@/app/ble-connector';

type MqttStatus = 'Conectando' | 'Conectado' | 'Desconectado' | 'Error';

const MQTT_BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';

export function useMqtt(deviceId: string | null, enabled: boolean) {
  const { toast } = useToast();
  const [connectionStatus, setConnectionStatus] = useState<MqttStatus>('Desconectado');
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const clientRef = useRef<MqttClient | null>(null);
  const isConnectingRef = useRef<boolean>(false);

  const safeJsonParse = (messageStr: string): SensorData | null => {
    try {
      if (!messageStr || !messageStr.trim()) return null;
      const parsed = JSON.parse(messageStr.trim()) as SensorData;
      if (typeof parsed !== 'object' || parsed === null) {
        console.warn('Parsed data is not an object:', parsed);
        return null;
      }
      return parsed;
    } catch (error) {
      console.error('Error parsing JSON:', error, 'Message:', messageStr);
      return null;
    }
  };


  useEffect(() => {
    if (!enabled || !deviceId) {
      if (clientRef.current) {
        clientRef.current.end(true);
        clientRef.current = null;
        setConnectionStatus('Desconectado');
      }
      return;
    }

    if (clientRef.current || isConnectingRef.current) return;

    isConnectingRef.current = true;
    setConnectionStatus('Conectando');
    toast({ title: 'MQTT: Conectando...', description: `Intentando conectar a ${MQTT_BROKER_URL}` });
    
    const topic = deviceId;
    
    const client = mqtt.connect(MQTT_BROKER_URL, {
      connectTimeout: 10000,
      reconnectPeriod: 5000,
    });
    clientRef.current = client;

    client.on('connect', () => {
      isConnectingRef.current = false;
      setConnectionStatus('Conectado');
      toast({ title: 'MQTT: Conectado', description: 'Conexión con el broker exitosa.' });
      
      client.subscribe(topic, { qos: 1 }, (err, granted) => {
        if (err || (granted && granted[0].qos > 2)) {
          console.error('Error de suscripción o QoS denegada:', err, granted);
           toast({
            title: "Error de Suscripción",
            description: `El broker rechazó la suscripción al topic: ${topic}`,
            variant: "destructive",
          });
          client.end();
        } else {
          console.log(`Suscrito exitosamente a: ${topic}`);
          toast({
            title: "Suscripción Exitosa",
            description: `Escuchando datos en ${topic}`,
          });
        }
      });
    });

    client.on('message', (receivedTopic, payload) => {
      if (receivedTopic !== topic) return;
      
      const messageStr = payload?.toString();
      if (!messageStr) return;

      const parsedData = safeJsonParse(messageStr);
      if(parsedData) {
        setSensorData(parsedData);
      }
    });

    client.on('error', (error) => {
      console.error('MQTT Client Error:', error);
      isConnectingRef.current = false;
      setConnectionStatus('Error');
      toast({
        title: "Error de Conexión MQTT",
        description: error.message || "No se pudo conectar al broker.",
        variant: "destructive",
      });
      client.end();
    });

    client.on('close', () => {
      if (connectionStatus !== 'Desconectado') {
        setConnectionStatus('Desconectado');
        toast({
          title: 'MQTT: Desconectado',
          description: 'Se ha perdido la conexión con el broker.',
          variant: 'destructive'
        });
      }
    });

    return () => {
      if (clientRef.current) {
        clientRef.current.end(true);
        clientRef.current = null;
      }
      isConnectingRef.current = false;
    };
  }, [deviceId, enabled, toast, connectionStatus]);

  return { connectionStatus, sensorData };
}
