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
  
  // Función segura para actualizar el estado solo si el componente está montado
  const safeSetConnectionStatus = useCallback((status: MqttStatus) => {
    if (isMountedRef.current) {
      setConnectionStatus(status);
    }
  }, []);

  // Función para limpiar la conexión de forma segura
  const cleanupConnection = useCallback(() => {
    if (clientRef.current) {
      const client = clientRef.current;
      clientRef.current = null;
      isConnectingRef.current = false;
      
      // Remover todos los listeners antes de cerrar
      client.removeAllListeners();
      
      if (client.connected) {
        client.end(true, () => {
          console.log('Cliente MQTT desconectado correctamente.');
        });
      }
    }
  }, []);

  // Función robusta para parsear mensajes JSON con detección de múltiples mensajes
  const safeJsonParse = useCallback((messageStr: string): SensorData | null => {
    try {
      // Validaciones múltiples antes del parse
      if (!messageStr || typeof messageStr !== 'string') {
        console.warn('Mensaje MQTT no válido: no es una cadena');
        return null;
      }
      
      const trimmedMessage = messageStr.trim();
      if (!trimmedMessage) {
        console.warn('Mensaje MQTT vacío o con solo espacios, omitido');
        return null;
      }
      
      // NUEVO: Detectar múltiples JSONs concatenados
      if (trimmedMessage.indexOf('}{') !== -1) {
        console.warn('Mensaje MQTT contiene múltiples JSONs concatenados, usando el primero');
        const firstJsonEnd = trimmedMessage.indexOf('}{') + 1;
        const firstJson = trimmedMessage.substring(0, firstJsonEnd);
        return safeJsonParse(firstJson); // Recursivo para el primer JSON
      }
      
      // Verificar que al menos parece JSON (empieza con { o [)
      if (!trimmedMessage.startsWith('{') && !trimmedMessage.startsWith('[')) {
        console.warn('Mensaje MQTT no parece ser JSON válido:', trimmedMessage.substring(0, 50));
        return null;
      }
      
      // NUEVO: Verificar que termina correctamente
      if (trimmedMessage.startsWith('{') && !trimmedMessage.endsWith('}')) {
        console.warn('Mensaje MQTT JSON aparenta estar truncado:', trimmedMessage.substring(0, 50));
        return null;
      }
      
      // NUEVO: Verificar tamaño razonable (evitar mensajes extremadamente largos)
      if (trimmedMessage.length > 2048) {
        console.warn(`Mensaje MQTT muy largo (${trimmedMessage.length} chars), posible corrupción`);
        return null;
      }
      
      const jsonData = JSON.parse(trimmedMessage);
      
      // Validación adicional del objeto parseado
      if (jsonData === null || jsonData === undefined) {
        console.warn('Mensaje MQTT parseado resulta en null/undefined');
        return null;
      }
      
      // NUEVO: Validar que tiene la estructura esperada de SensorData
      if (typeof jsonData === 'object' && jsonData !== null) {
        const requiredFields = ['ph', 'do_conc', 'temp'];
        const hasRequiredFields = requiredFields.some(field => field in jsonData);
        
        if (!hasRequiredFields) {
          console.warn('Mensaje MQTT no contiene campos de sensor esperados:', Object.keys(jsonData));
          return null;
        }
      }
      
      return jsonData as SensorData;
      
    } catch (error) {
      // Manejo más detallado del error
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      
      // NUEVO: Identificar tipo específico de error JSON
      let errorType = 'unknown';
      if (error instanceof SyntaxError) {
        if (errorMessage.includes('Unexpected end')) {
          errorType = 'truncated_json';
        } else if (errorMessage.includes('Unexpected token')) {
          errorType = 'malformed_json';
        } else {
          errorType = 'syntax_error';
        }
      }
      
      console.error('Error parseando mensaje MQTT:', {
        errorType,
        error: errorMessage,
        message: messageStr.substring(0, 200), // Más caracteres para debug
        messageLength: messageStr.length,
        startsWithBrace: messageStr.startsWith('{'),
        endsWithBrace: messageStr.endsWith('}'),
        containsMultiple: messageStr.indexOf('}{') !== -1
      });
      return null;
    }
  }, []);

  useEffect(() => {
    // Marcar como montado
    isMountedRef.current = true;
    
    if (!enabled || !deviceId) {
      cleanupConnection();
      safeSetConnectionStatus('Desconectado');
      return;
    }

    // Evitar múltiples conexiones simultáneas
    if (clientRef.current || isConnectingRef.current) {
      return;
    }

    isConnectingRef.current = true;
    safeSetConnectionStatus('Conectando');
    
    const topic = `aquadata/${deviceId}/data`;
    console.log(`Intentando conectar a MQTT: ${MQTT_BROKER_URL}`);

    const client = mqtt.connect(MQTT_BROKER_URL, {
      // Configuraciones adicionales para mayor robustez
      connectTimeout: 30000, // 30 segundos
      reconnectPeriod: 5000,  // 5 segundos
      keepalive: 60,
      clean: true
    });

    clientRef.current = client;

    client.on('connect', () => {
      if (!isMountedRef.current) return;
      
      console.log('Conectado exitosamente al broker MQTT.');
      isConnectingRef.current = false;
      safeSetConnectionStatus('Conectado');
      
      client.subscribe(topic, (err) => {
        if (!isMountedRef.current) return;
        
        if (!err) {
          console.log(`Suscrito exitosamente al topic: ${topic}`);
          toast({
            title: 'Conexión MQTT Exitosa',
            description: `Escuchando datos del dispositivo ${deviceId}.`,
          });
        } else {
          console.error('Error en suscripción MQTT:', err);
          safeSetConnectionStatus('Error');
          toast({
            variant: 'destructive',
            title: 'Error de Suscripción MQTT',
            description: `No se pudo suscribir al topic: ${err.message}`,
          });
        }
      });
    });

    client.on('message', (receivedTopic, payload) => {
      if (!isMountedRef.current || receivedTopic !== topic) return;
      
      try {
        const messageStr = payload?.toString();
        if (!messageStr) {
          console.warn('Payload MQTT vacío o nulo recibido');
          return;
        }
        
        const parsedData = safeJsonParse(messageStr);
        if (parsedData && isMountedRef.current) {
          console.log('Mensaje MQTT procesado exitosamente:', parsedData);
          setSensorData(parsedData);
        }
        
      } catch (error) {
        // Este catch adicional maneja cualquier error no capturado en safeJsonParse
        console.error('Error inesperado procesando mensaje MQTT:', error);
      }
    });

    client.on('error', (err) => {
      if (!isMountedRef.current) return;
      
      console.error('Error de conexión MQTT:', err);
      isConnectingRef.current = false;
      safeSetConnectionStatus('Error');
      
      toast({
        variant: 'destructive',
        title: 'Error de Conexión MQTT',
        description: err.message,
      });
      
      // Limpiar la referencia para permitir reconexión
      setTimeout(() => {
        if (clientRef.current === client) {
          clientRef.current = null;
        }
      }, 1000);
    });

    client.on('close', () => {
      if (!isMountedRef.current) return;
      
      console.log('Conexión MQTT cerrada.');
      isConnectingRef.current = false;
      
      // Solo cambiar estado si no estamos ya desconectados intencionalmente
      if (connectionStatus !== 'Desconectado') {
        safeSetConnectionStatus('Desconectado');
      }
    });

    client.on('disconnect', () => {
      if (!isMountedRef.current) return;
      
      console.log('Cliente MQTT desconectado.');
      isConnectingRef.current = false;
      safeSetConnectionStatus('Desconectado');
    });

    // Cleanup function
    return () => {
      isMountedRef.current = false;
      cleanupConnection();
    };
    
    // CRÍTICO: Removido connectionStatus de las dependencias para evitar loops
  }, [deviceId, enabled, toast, cleanupConnection, safeSetConnectionStatus, safeJsonParse]);

  // Efecto para marcar como desmontado en cleanup
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return { connectionStatus, sensorData };
}
