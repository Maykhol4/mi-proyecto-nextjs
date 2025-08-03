
'use client';

import { useState, useEffect, useRef } from 'react';
import mqtt, { MqttClient } from 'mqtt';
import { useToast } from './use-toast';
import { type SensorData } from '@/app/ble-connector';

type MqttStatus = 'Conectando' | 'Conectado' | 'Desconectado' | 'Error';

const MQTT_BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';
const MQTT_TOPIC = 'aquadata/sensor-data';
// Definir un Client ID único para la aplicación web
const MQTT_CLIENT_ID = `aquadata-webapp-${Math.random().toString(16).substr(2, 8)}`;


export function useMqtt(enabled: boolean) {
  const { toast } = useToast();
  const [connectionStatus, setConnectionStatus] = useState<MqttStatus>('Desconectado');
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const clientRef = useRef<MqttClient | null>(null);
  const receivedDataBuffer = useRef('');

  const safeJsonParse = (messageStr: string): SensorData | null => {
    try {
      const data = JSON.parse(messageStr);
      // Validar que el objeto parseado contenga al menos un campo esperado
      if (data && (typeof data.ph !== 'undefined' || typeof data.do_conc !== 'undefined')) {
        // Aseguramos que los campos coincidan con la interfaz SensorData
        return {
          ph: data.ph,
          do_conc: data.do_conc,
          do_sat: data.do_sat,
          temp: data.temp,
          timestamp: data.timestamp,
          status: data.status,
          readings_count: data.readings_count,
          errors_count: data.errors_count,
          simulation_cycle: data.simulation_cycle,
          wifi_status: data.wifi_status
        };
      }
      return null;
    } catch (error) {
      console.warn('Error parsing JSON:', error, 'Message:', `"${messageStr}"`);
      return null;
    }
  };

  useEffect(() => {
    if (!enabled) {
      if (clientRef.current) {
        console.log('MQTT: Desconectando por deshabilitación.');
        clientRef.current.end(true);
        clientRef.current = null;
        setConnectionStatus('Desconectado');
      }
      return;
    }

    if (clientRef.current) return;

    setConnectionStatus('Conectando');
    toast({ title: 'MQTT: Conectando...', description: `A ${MQTT_BROKER_URL}` });
    
    const client = mqtt.connect(MQTT_BROKER_URL, {
      clientId: MQTT_CLIENT_ID,
      connectTimeout: 10000,
      reconnectPeriod: 5000,
    });
    clientRef.current = client;

    client.on('connect', () => {
      setConnectionStatus('Conectado');
      toast({ title: 'MQTT: ¡Conectado!', description: 'Conexión con el broker exitosa.' });
      
      client.subscribe(MQTT_TOPIC, { qos: 0 }, (err) => {
        if (err) {
          console.error('Error de suscripción:', err);
           toast({
            title: "Error de Suscripción",
            description: `No se pudo suscribir a ${MQTT_TOPIC}.`,
            variant: "destructive",
          });
          client.end();
        } else {
          console.log(`Suscrito exitosamente a: ${MQTT_TOPIC}`);
          toast({
            title: "Suscripción Exitosa",
            description: `Escuchando datos del sensor.`,
          });
        }
      });
    });

    client.on('message', (receivedTopic, payload) => {
      receivedDataBuffer.current += payload.toString();
      
      // Procesar todos los mensajes completos en el buffer
      let lastNewline;
      while ((lastNewline = receivedDataBuffer.current.indexOf('\n')) !== -1) {
        const messageStr = receivedDataBuffer.current.substring(0, lastNewline);
        receivedDataBuffer.current = receivedDataBuffer.current.substring(lastNewline + 1);

        if (messageStr) {
          const parsedData = safeJsonParse(messageStr);
          if (parsedData) {
            console.log('Datos recibidos y parseados:', parsedData);
            setSensorData(parsedData);
          }
        }
      }
    });

    client.on('error', (error) => {
      console.error('MQTT Client Error:', error);
      setConnectionStatus('Error');
      toast({
        title: "Error de Conexión MQTT",
        description: error.message || "No se pudo conectar al broker.",
        variant: "destructive",
      });
      client.end();
    });

    client.on('close', () => {
      if (clientRef.current) {
        setConnectionStatus('Desconectado');
        clientRef.current = null;
      }
    });

    return () => {
      if (clientRef.current) {
        console.log('MQTT: Desconectando (limpieza de efecto).');
        clientRef.current.end(true);
        clientRef.current = null;
      }
    };
  }, [enabled, toast]);

  return { connectionStatus, sensorData };
}

    