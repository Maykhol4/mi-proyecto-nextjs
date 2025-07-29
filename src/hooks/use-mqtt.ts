
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import mqtt, { MqttClient } from 'mqtt';
import { useToast } from './use-toast';
import { type SensorData } from '@/app/ble-connector';

type MqttStatus = 'Conectando' | 'Conectado' | 'Desconectado' | 'Error';

const MQTT_BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';
const MESSAGE_DELIMITER = '\n'; // Delimitador para mensajes completos

export function useMqtt(deviceId: string | null, enabled: boolean) {
  const { toast } = useToast();
  const [connectionStatus, setConnectionStatus] = useState<MqttStatus>('Desconectado');
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const clientRef = useRef<MqttClient | null>(null);
  const isConnectingRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  
  // Buffer para acumular mensajes fragmentados por tópico
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
      // Limpiar buffers
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
      
      // Validar que empiece con { y termine con }
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
        console.warn('Mensaje no parece ser JSON válido:', trimmed);
        return null;
      }
      
      const parsed = JSON.parse(trimmed) as SensorData;
      
      // Validación básica de estructura de SensorData
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

  // Función para procesar mensajes fragmentados
  const processFragmentedMessage = useCallback((topic: string, newFragment: string) => {
    if (!isMountedRef.current) return;
    
    // Obtener el buffer actual para este tópico
    const currentBuffer = messageBufferRef.current.get(topic) || '';
    
    // Agregar el nuevo fragmento al buffer
    const updatedBuffer = currentBuffer + newFragment;
    
    // Buscar mensajes completos (terminados en delimitador)
    const messages = updatedBuffer.split(MESSAGE_DELIMITER);
    
    // El último elemento podría ser un fragmento incompleto
    const incompleteFragment = messages.pop() || '';
    
    // Procesar todos los mensajes completos
    messages.forEach(completeMessage => {
      if (completeMessage.trim()) {
        const parsedData = safeJsonParse(completeMessage);
        if (parsedData && isMountedRef.current) {
          console.log('Mensaje MQTT procesado exitosamente:', parsedData);
          setSensorData(parsedData);
        }
      }
    });
    
    // Guardar el fragmento incompleto para el próximo mensaje
    if (incompleteFragment) {
      messageBufferRef.current.set(topic, incompleteFragment);
    } else {
      // Si no hay fragmento incompleto, limpiar el buffer para este tópico
      messageBufferRef.current.delete(topic);
    }
    
    // Limitar el tamaño del buffer para evitar acumulación excesiva
    const MAX_BUFFER_SIZE = 10000; // 10KB por tópico
    const buffer = messageBufferRef.current.get(topic);
    if (buffer && buffer.length > MAX_BUFFER_SIZE) {
      console.warn(`Buffer demasiado grande para tópico ${topic}, limpiando...`);
      messageBufferRef.current.delete(topic);
    }
  }, [safeJsonParse]);

  // Función para limpiar buffers antiguos (prevenir memory leaks)
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
      connectTimeout: 30000,
      reconnectPeriod: 5000,
      keepalive: 60,
      clean: true
    });
    clientRef.current = client;

    client.on('connect', () => {
      if (!isMountedRef.current) return;
      
      console.log('Conectado al broker MQTT');
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
            title: "MQTT Conectado",
            description: `Escuchando datos del dispositivo ${deviceId}`,
          });
        }
      });
    });

    client.on('message', (receivedTopic, payload) => {
      if (!isMountedRef.current || receivedTopic !== topic) return;
      
      const messageFragment = payload?.toString();
      if (!messageFragment) return;
      
      console.log(`Fragmento recibido en ${receivedTopic}:`, messageFragment);
      
      // Procesar el fragmento usando el sistema de buffer
      processFragmentedMessage(receivedTopic, messageFragment);
    });

    client.on('error', (error) => {
      console.error('Error de cliente MQTT:', error);
      if (isMountedRef.current) {
        safeSetConnectionStatus('Error');
        toast({
          title: "Error de Conexión MQTT",
          description: "No se pudo conectar al broker MQTT",
          variant: "destructive",
        });
      }
    });

    client.on('close', () => {
      console.log('Conexión MQTT cerrada');
      if (isMountedRef.current) {
        safeSetConnectionStatus('Desconectado');
      }
    });

    client.on('disconnect', () => {
      console.log('Cliente MQTT desconectado');
      if (isMountedRef.current) {
        safeSetConnectionStatus('Desconectado');
      }
    });

    client.on('reconnect', () => {
      console.log('Intentando reconectar MQTT...');
      if (isMountedRef.current) {
        safeSetConnectionStatus('Conectando');
      }
    });

    // Limpiar buffers antiguos periódicamente
    const cleanupInterval = setInterval(cleanupOldBuffers, 300000); // cada 5 minutos

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
