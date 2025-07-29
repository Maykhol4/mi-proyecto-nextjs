'use client';

import { useState, useEffect, useRef } from 'react';
import mqtt, { MqttClient } from 'mqtt';
import { useToast } from './use-toast';
import { type SensorData } from '@/app/ble-connector';

type MqttStatus = 'Conectando' | 'Conectado' | 'Desconectado' | 'Error';

const MQTT_BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';

export function useMqtt(topic: string | null, enabled: boolean) {
  const { toast } = useToast();
  const [connectionStatus, setConnectionStatus] = useState<MqttStatus>('Desconectado');
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const clientRef = useRef<MqttClient | null>(null);
  const isConnectingRef = useRef<boolean>(false);

  const safeJsonParse = (messageStr: string): Partial<SensorData> | null => {
    try {
      // Directamente parseamos el JSON. La lógica de reconstrucción está en el 'on message'.
      return JSON.parse(messageStr);
    } catch (error) {
      console.error('Error parsing JSON:', error, 'Message:', `"${messageStr}"`);
      return null;
    }
  };

  useEffect(() => {
    if (!enabled || !topic) {
      if (clientRef.current) {
        console.log('MQTT: Desconectando por deshabilitación o falta de topic.');
        clientRef.current.end(true);
      }
      return;
    }

    if (clientRef.current || isConnectingRef.current) return;

    isConnectingRef.current = true;
    setConnectionStatus('Conectando');
    toast({ title: 'MQTT: Conectando...', description: `Intentando conectar a ${MQTT_BROKER_URL}` });
    
    const client = mqtt.connect(MQTT_BROKER_URL, {
      connectTimeout: 10000,
      reconnectPeriod: 5000,
    });
    clientRef.current = client;

    client.on('connect', () => {
      isConnectingRef.current = false;
      setConnectionStatus('Conectado');
      toast({ title: 'MQTT: ¡Conectado!', description: 'Conexión con el broker exitosa.' });
      
      client.subscribe(topic, { qos: 1 }, (err, granted) => {
        if (err || (granted && granted[0].qos > 2)) {
          console.error('Error de suscripción o QoS denegada:', err, granted);
           toast({
            title: "Error de Suscripción",
            description: `El broker rechazó la suscripción al topic.`,
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
      if (parsedData) {
        // SOLUCIÓN: Reconstruir el objeto de estado para asegurar que todos los campos se actualicen.
        // Esto previene que solo un campo (como 'ph') se muestre si el objeto llega incompleto.
        setSensorData(prevData => ({
            ...(prevData || {}),
            ph: parsedData.ph ?? prevData?.ph ?? null,
            do_conc: parsedData.do_conc ?? prevData?.do_conc ?? null,
            do_sat: parsedData.do_sat ?? prevData?.do_sat ?? null,
            temp: parsedData.temp ?? prevData?.temp ?? null,
            timestamp: parsedData.timestamp ?? prevData?.timestamp ?? '--:--:--',
            status: parsedData.status ?? prevData?.status ?? '⚪',
            readings_count: parsedData.readings_count ?? prevData?.readings_count,
            errors_count: parsedData.errors_count ?? prevData?.errors_count,
            simulation_cycle: parsedData.simulation_cycle ?? prevData?.simulation_cycle ?? 0,
        }));
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
      if (clientRef.current) {
        isConnectingRef.current = false;
        setConnectionStatus('Desconectado');
        clientRef.current = null;
        toast({
          title: 'MQTT: Desconectado',
          description: 'Se ha perdido la conexión con el broker.',
          variant: 'destructive'
        });
      }
    });

    return () => {
      if (clientRef.current) {
        console.log('MQTT: Desconectando (limpieza de efecto).');
        clientRef.current.end(true);
        clientRef.current = null;
        isConnectingRef.current = false;
      }
    };
  }, [topic, enabled, toast]);

  return { connectionStatus, sensorData };
}
