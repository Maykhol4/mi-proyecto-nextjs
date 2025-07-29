'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import mqtt, { MqttClient } from 'mqtt';
import { useToast } from './use-toast';
import { type SensorData } from '@/app/ble-connector';

type MqttStatus = 'Conectando' | 'Conectado' | 'Desconectado' | 'Error';

// APUNTAMOS AL BROKER LOCAL SOBRE WEBSOCKET
const MQTT_BROKER_URL = `ws://localhost:8888`; 
const MESSAGE_DELIMITER = '\n'; 

export function useMqtt(deviceId: string | null, enabled: boolean) {
  const { toast } = useToast();
  const [connectionStatus, setConnectionStatus] = useState<MqttStatus>('Desconectado');
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const clientRef = useRef<MqttClient | null>(null);
  const isConnectingRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  
  const messageBufferRef = useRef<Map<string, string>>(new Map());
  
  const safeSetConnectionStatus = useCallback((status: MqttStatus) => {
    if (isMountedRef.current) {
      setConnectionStatus(status);
    }
  }, []);

  const cleanupConnection = useCallback(() => {
    if (clientRef.current) {
      const client = clientRef.current;
      clientRef.current = null;
      isConnectingRef.current = false;
      messageBufferRef.current.clear();
      
      client.removeAllListeners();
      if (client.connected) {
        client.end(true, () => console.log('Cliente MQTT desconectado.'));
      }
    }
  }, []);

  const safeJsonParse = useCallback((messageStr: string): SensorData | null => {
    try {
      if (!messageStr || !messageStr.trim()) return null;
      
      const trimmed = messageStr.trim();
      
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
        console.warn('Mensaje no parece ser JSON válido:', trimmed);
        return null;
      }
      
      const parsed = JSON.parse(trimmed) as SensorData;
      
      if (typeof parsed !== 'object' || parsed === null) {
        console.warn('Datos parseados no son un objeto:', parsed);
        return null;
      }
      
      return parsed;
    } catch (error) {
      console.error('Error parseando JSON:', error, 'Mensaje:', messageStr);
      return null;
    }
  }, []);

  const processFragmentedMessage = useCallback((topic: string, newFragment: string) => {
    if (!isMountedRef.current) return;
    
    const currentBuffer = messageBufferRef.current.get(topic) || '';
    const updatedBuffer = currentBuffer + newFragment;
    const messages = updatedBuffer.split(MESSAGE_DELIMITER);
    const incompleteFragment = messages.pop() || '';
    
    messages.forEach(completeMessage => {
      if (completeMessage.trim()) {
        const parsedData = safeJsonParse(completeMessage);
        if (parsedData && isMountedRef.current) {
          console.log('Mensaje MQTT procesado exitosamente:', parsedData);
          setSensorData(parsedData);
        }
      }
    });
    
    if (incompleteFragment) {
      messageBufferRef.current.set(topic, incompleteFragment);
    } else {
      messageBufferRef.current.delete(topic);
    }
    
    const MAX_BUFFER_SIZE = 10000;
    const buffer = messageBufferRef.current.get(topic);
    if (buffer && buffer.length > MAX_BUFFER_SIZE) {
      console.warn(`Buffer demasiado grande para tópico ${topic}, limpiando...`);
      messageBufferRef.current.delete(topic);
    }
  }, [safeJsonParse]);

  const cleanupOldBuffers = useCallback(() => {
    const MAX_TOPICS = 50;
    if (messageBufferRef.current.size > MAX_TOPICS) {
      console.warn('Demasiados tópicos en buffer, limpiando...');
      messageBufferRef.current.clear();
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
    
    const topic = `aquadata/${deviceId}/data`;
    const client = mqtt.connect(MQTT_BROKER_URL, {
      connectTimeout: 10000, // Timeout más corto para broker local
      reconnectPeriod: 2000,
      keepalive: 60,
      clean: true
    });
    clientRef.current = client;

    client.on('connect', () => {
      if (!isMountedRef.current) return;
      
      console.log('Conectado al broker MQTT local');
      isConnectingRef.current = false;
      safeSetConnectionStatus('Conectado');
      
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error('Error suscribiéndose al tópico:', err);
          toast({
            title: "Error de Suscripción",
            description: `No se pudo suscribir al tópico: ${topic}`,
            variant: "destructive",
          });
        } else {
          console.log(`Suscrito exitosamente al tópico: ${topic}`);
          toast({
            title: "MQTT Local Conectado",
            description: `Escuchando datos del dispositivo ${deviceId}`,
          });
        }
      });
    });

    client.on('message', (receivedTopic, payload) => {
      if (!isMountedRef.current || receivedTopic !== topic) return;
      
      const messageFragment = payload?.toString();
      if (!messageFragment) return;
      
      processFragmentedMessage(receivedTopic, messageFragment);
    });

    client.on('error', (error) => {
      console.error('Error de cliente MQTT:', error);
      if (isMountedRef.current) {
        safeSetConnectionStatus('Error');
        toast({
          title: "Error de Conexión MQTT",
          description: "No se pudo conectar al broker local.",
          variant: "destructive",
        });
      }
    });

    client.on('close', () => {
      if (isMountedRef.current) {
        safeSetConnectionStatus('Desconectado');
      }
    });

    const cleanupInterval = setInterval(cleanupOldBuffers, 300000);

    return () => {
      isMountedRef.current = false;
      clearInterval(cleanupInterval);
      cleanupConnection();
    };
  }, [deviceId, enabled, toast, cleanupConnection, safeSetConnectionStatus, processFragmentedMessage, cleanupOldBuffers]);

  useEffect(() => {
    return () => { 
      isMountedRef.current = false; 
    };
  }, []);

  return { connectionStatus, sensorData };
}
