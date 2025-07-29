"use client";

import { useState, useEffect, useRef } from 'react';
import mqtt, { MqttClient } from 'mqtt';
import { useToast } from './use-toast';
import { initialSensorData, type SensorData } from '@/app/ble-connector';

type MqttStatus = 'Conectando' | 'Conectado' | 'Desconectado' | 'Error';

const MQTT_BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';

export function useMqtt(deviceId: string | null, enabled: boolean) {
  const { toast } = useToast();
  const [connectionStatus, setConnectionStatus] = useState<MqttStatus>('Desconectado');
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const clientRef = useRef<MqttClient | null>(null);

  useEffect(() => {
    if (!enabled || !deviceId) {
      if (clientRef.current) {
        clientRef.current.end(true, () => {
          setConnectionStatus('Desconectado');
          clientRef.current = null;
          console.log('Cliente MQTT desconectado intencionadamente.');
        });
      }
      return;
    }

    if (clientRef.current) {
      return;
    }

    setConnectionStatus('Conectando');
    const topic = `aquadata/${deviceId}/data`;
    
    console.log(`Intentando conectar a MQTT: ${MQTT_BROKER_URL}`);
    const client = mqtt.connect(MQTT_BROKER_URL);
    clientRef.current = client;

    client.on('connect', () => {
      console.log('Conectado exitosamente al broker MQTT.');
      setConnectionStatus('Conectado');
      client.subscribe(topic, (err) => {
        if (!err) {
          console.log(`Suscrito exitosamente al topic: ${topic}`);
          toast({
            title: 'Conexión MQTT Exitosa',
            description: `Escuchando datos del dispositivo ${deviceId}.`,
          });
        } else {
          console.error('Error en suscripción MQTT:', err);
          setConnectionStatus('Error');
          toast({
            variant: 'destructive',
            title: 'Error de Suscripción MQTT',
            description: `No se pudo suscribir al topic: ${err.message}`,
          });
        }
      });
    });

    client.on('message', (receivedTopic, payload) => {
      if (receivedTopic === topic) {
        try {
          const messageStr = payload.toString();
          const jsonData = JSON.parse(messageStr);
          console.log('Mensaje MQTT recibido:', jsonData);
          setSensorData(jsonData as SensorData);
        } catch (error) {
          console.error('Error parseando mensaje MQTT:', error);
        }
      }
    });

    client.on('error', (err) => {
      console.error('Error de conexión MQTT:', err);
      setConnectionStatus('Error');
      toast({
        variant: 'destructive',
        title: 'Error de Conexión MQTT',
        description: err.message,
      });
      client.end();
      clientRef.current = null;
    });

    client.on('close', () => {
      console.log('Conexión MQTT cerrada.');
       if (connectionStatus !== 'Desconectado') {
         setConnectionStatus('Desconectado');
      }
    });

    return () => {
      if (client.connected) {
        client.end(true);
        clientRef.current = null;
      }
    };
  }, [deviceId, enabled, toast, connectionStatus]);

  return { connectionStatus, sensorData };
}
