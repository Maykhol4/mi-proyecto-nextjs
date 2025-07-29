'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import mqtt, { MqttClient } from 'mqtt';
import { useToast } from './use-toast';
import { type SensorData } from '@/app/ble-connector';

type MqttStatus = 'Conectando' | 'Conectado' | 'Desconectado' | 'Error';

const MQTT_BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';
const MESSAGE_DELIMITER = '\n'; // Delimiter for complete messages

export function useMqtt(deviceId: string | null, enabled: boolean) {
  const { toast } = useToast();
  const [connectionStatus, setConnectionStatus] = useState<MqttStatus>('Desconectado');
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const clientRef = useRef<MqttClient | null>(null);
  const isConnectingRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  
  // Buffer to accumulate fragmented messages per topic
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
      // Clear buffers
      messageBufferRef.current.clear();
      
      client.removeAllListeners();
      if (client.connected) {
        client.end(true, () => console.log('MQTT client disconnected.'));
      }
    }
  }, []);

  const safeJsonParse = useCallback((messageStr: string): SensorData | null => {
    try {
      if (!messageStr || !messageStr.trim()) return null;
      
      const trimmed = messageStr.trim();
      
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
        console.warn('Message does not appear to be valid JSON:', trimmed);
        return null;
      }
      
      const parsed = JSON.parse(trimmed) as SensorData;
      
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
          console.log('MQTT message successfully processed:', parsedData);
          setSensorData(parsedData);
        }
      }
    });
    
    if (incompleteFragment) {
      messageBufferRef.current.set(topic, incompleteFragment);
    } else {
      messageBufferRef.current.delete(topic);
    }
    
    const MAX_BUFFER_SIZE = 10000; // 10KB per topic
    const buffer = messageBufferRef.current.get(topic);
    if (buffer && buffer.length > MAX_BUFFER_SIZE) {
      console.warn(`Buffer too large for topic ${topic}, clearing...`);
      messageBufferRef.current.delete(topic);
    }
  }, [safeJsonParse]);

  const cleanupOldBuffers = useCallback(() => {
    const MAX_TOPICS = 50;
    if (messageBufferRef.current.size > MAX_TOPICS) {
      console.warn('Too many topics in buffer, clearing...');
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
    
    // Subscribe to the real-time data stream topic
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
      
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error('Error subscribing to topic:', err);
          toast({
            title: "Subscription Error",
            description: `Could not subscribe to topic: ${topic}`,
            variant: "destructive",
          });
        } else {
          console.log(`Successfully subscribed to topic: ${topic}`);
          toast({
            title: "MQTT Connected",
            description: `Listening for data from device ${deviceId}`,
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
      console.error('MQTT Client Error:', error);
      if (isMountedRef.current) {
        safeSetConnectionStatus('Error');
        toast({
          title: "MQTT Connection Error",
          description: "Could not connect to the MQTT broker",
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
  }, [deviceId, enabled, toast, cleanupConnection, safeSetConnectionStatus, processFragmentedMessage, cleanupOldBuffers, safeJsonParse]);

  useEffect(() => {
    return () => { 
      isMountedRef.current = false; 
    };
  }, []);

  return { connectionStatus, sensorData };
}
