# main.py - ESP32 con MicroPython - Versión Robusta y Simplificada
import network
import uasyncio
from umqtt.simple import MQTTClient
import ujson
import utime
import machine
import ubinascii
import urandom

# --- CONFIGURACIÓN ---
WIFI_SSID = "TP-Link_DF16"
WIFI_PASSWORD = "29768387"

MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT = 1883
CLIENT_ID = f"aquadata-esp32-{ubinascii.hexlify(machine.unique_id()).decode()}"
MQTT_STREAM_TOPIC = f"aquadata/{CLIENT_ID}/data/stream"
MQTT_STATUS_TOPIC = f"aquadata/{CLIENT_ID}/status"

PUBLISH_INTERVAL_S = 5

# --- ESTADO GLOBAL ---
wlan = network.WLAN(network.STA_IF)
wlan.active(True)
mqtt_client = None

simulation_cycle = 0
readings_count = {'ph': 0, 'do': 0}
errors_count = {'ph': 0, 'do': 0}

# --- FUNCIONES ---

async def connect_to_wifi():
    """Se conecta a la red WiFi de forma asíncrona."""
    print(f"Conectando a WiFi: {WIFI_SSID}...")
    wlan.connect(WIFI_SSID, WIFI_PASSWORD)
    
    max_wait = 20
    while max_wait > 0:
        if wlan.isconnected():
            print(f"WiFi conectado. IP: {wlan.ifconfig()[0]}")
            return True
        max_wait -= 1
        print("Esperando conexión WiFi...")
        await uasyncio.sleep(1)
        
    print("Error: Fallo al conectar a WiFi.")
    return False

def connect_to_mqtt():
    """Se conecta al broker MQTT. Devuelve True si es exitoso, False si no."""
    global mqtt_client
    try:
        print(f"Conectando a MQTT: {MQTT_BROKER}...")
        mqtt_client = MQTTClient(CLIENT_ID, MQTT_BROKER, port=MQTT_PORT, keepalive=60)
        
        # Last Will and Testament: Notifica si el dispositivo se desconecta inesperadamente.
        lwt_message = ujson.dumps({"status": "offline", "reason": "unexpected_disconnect"})
        mqtt_client.set_last_will(MQTT_STATUS_TOPIC, lwt_message, retain=True)
        
        mqtt_client.connect()
        
        # Publicar estado 'online'
        online_message = ujson.dumps({"status": "online", "client_id": CLIENT_ID, "ip": wlan.ifconfig()[0]})
        mqtt_client.publish(MQTT_STATUS_TOPIC, online_message, retain=True)
        
        print(f"MQTT conectado. Publicando en: {MQTT_STREAM_TOPIC}")
        return True
    except Exception as e:
        print(f"Error conectando a MQTT: {e}")
        return False

def simulate_sensor_data():
    """Genera datos de sensores simulados."""
    global simulation_cycle, readings_count, errors_count
    simulation_cycle += 1
    readings_count['ph'] += 1
    readings_count['do'] += 1
    
    status = "🟢 All systems normal"
    if urandom.uniform(0, 1) > 0.95:
        status = "🟡 Minor warning detected"
        errors_count['ph'] += 1
    
    return {
        "ph": round(urandom.uniform(6.5, 8.0), 2),
        "do_conc": round(urandom.uniform(5.5, 8.5), 1),
        "do_sat": round(urandom.uniform(85.0, 105.0), 1),
        "temp": round(urandom.uniform(21.0, 24.5), 1),
        "timestamp": f"{utime.localtime()[3]:02}:{utime.localtime()[4]:02}:{utime.localtime()[5]:02}",
        "status": status,
        "readings_count": readings_count,
        "errors_count": errors_count,
        "simulation_cycle": simulation_cycle
    }

async def main_loop():
    """Bucle principal para conectar y publicar datos de forma robusta."""
    while True:
        if not wlan.isconnected():
            await connect_to_wifi()
            await uasyncio.sleep(2) # Pausa después de conectar
            continue

        if mqtt_client is None or not mqtt_client.is_conn_issue():
            if not connect_to_mqtt():
                print("Fallo en conexión MQTT. Reintentando en 10 segundos...")
                await uasyncio.sleep(10)
                continue
        
        try:
            # Generar y publicar datos
            sensor_data = simulate_sensor_data()
            message = ujson.dumps(sensor_data)
            
            # **CORRECCIÓN CLAVE**: Añadir el delimitador de nueva línea ('\n')
            # Esto es esencial para que el frontend procese el mensaje.
            message_with_delimiter = message + '\n'
            
            print(f"Publicando (Ciclo {simulation_cycle}): {message}")
            mqtt_client.publish(MQTT_STREAM_TOPIC, message_with_delimiter, retain=False)
            
            # **SOLUCIÓN ECONNRESET**: `check_msg` también gestiona el keep-alive (PINGs)
            mqtt_client.check_msg()

        except Exception as e:
            print(f"Error en el bucle principal: {e}. Desconectando para reconectar.")
            if mqtt_client:
                mqtt_client.disconnect()
            mqtt_client = None
        
        await uasyncio.sleep(PUBLISH_INTERVAL_S)

# --- EJECUCIÓN ---
if __name__ == "__main__":
    try:
        uasyncio.run(main_loop())
    except KeyboardInterrupt:
        print("Programa detenido.")
    except Exception as e:
        print(f"Error fatal en el sistema: {e}. Reiniciando en 10 segundos.")
        utime.sleep(10)
        machine.reset()
