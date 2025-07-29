'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import mqtt, { MqttClient } from 'mqtt';
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
  const isMountedRef = useRef<boolean>(true);

  const safeSetConnectionStatus = useCallback((status: MqttStatus) => {
    if (isMountedRef.current) {
      setConnectionStatus(status);
    }
  }, []);
  
  const safeJsonParse = useCallback((messageStr: string): SensorData | null => {
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
  }, []);


  const cleanupConnection = useCallback(() => {
    if (clientRef.current) {
      const client = clientRef.current;
      clientRef.current = null;
      isConnectingRef.current = false;
      client.removeAllListeners();
      if (client.connected) {
        client.end(true, () => console.log('MQTT client disconnected.'));
      }
    }
  }, []);


  useEffect(() => {
    isMountedRef.current = true;
    
    if (!enabled || !deviceId) {
      cleanupConnection();
      safeSetConnectionStatus('Desconectado');
      return;
    }

    if (clientRef.current || isConnectingRef.current) return;

    isConnectingRef.current = true;
    safeSetConnectionStatus('Conectando');
    
    // El topic correcto que contiene el flujo de datos en tiempo real
    const topic = `aquadata/${deviceId}/data/stream`;
    
    const client = mqtt.connect(MQTT_BROKER_URL, {
      connectTimeout: 30000,
      reconnectPeriod: 5000,
      keepalive: 60,
      clean: true
    });
    clientRef.current = client;

    client.on('connect', () => {
      if (!isMountedRef.current) return;
      
      console.log('Connected to MQTT broker');
      isConnectingRef.current = false;
      safeSetConnectionStatus('Conectado');
      
      client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) {
          console.error('Error subscribing to topic:', err);
          toast({
            title: "Error de Suscripción",
            description: `No se pudo suscribir al topic: ${topic}`,
            variant: "destructive",
          });
        } else {
          console.log(`Suscrito exitosamente a: ${topic}`);
          toast({
            title: "Conectado a MQTT",
            description: `Escuchando datos de ${deviceId}`,
          });
        }
      });
    });

    client.on('message', (receivedTopic, payload) => {
      if (!isMountedRef.current || receivedTopic !== topic) return;
      
      const messageStr = payload?.toString();
      if (!messageStr) return;

      const parsedData = safeJsonParse(messageStr);
      if(parsedData && isMountedRef.current) {
          console.log('MQTT message successfully processed:', parsedData);
          setSensorData(parsedData);
      }
    });

    client.on('error', (error) => {
      console.error('MQTT Client Error:', error);
      if (isMountedRef.current) {
        safeSetConnectionStatus('Error');
        toast({
          title: "Error de Conexión MQTT",
          description: "No se pudo conectar al broker MQTT.",
          variant: "destructive",
        });
      }
    });

    client.on('close', () => {
      if (isMountedRef.current) {
        safeSetConnectionStatus('Desconectado');
      }
    });

    return () => {
      isMountedRef.current = false;
      cleanupConnection();
    };
  }, [deviceId, enabled, toast, cleanupConnection, safeSetConnectionStatus, safeJsonParse]);

  useEffect(() => {
    return () => { 
      isMountedRef.current = false; 
    };
  }, []);

  return { connectionStatus, sensorData };
}
