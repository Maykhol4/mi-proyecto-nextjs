# main.py - ESP32 con MicroPython - Versión Corregida y Robusta
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

simulation_cycle = 0
readings_count = {'ph': 0, 'do': 0}
errors_count = {'ph': 0, 'do': 0}

# --- FUNCIONES ---

async def connect_to_wifi():
    """Se conecta a la red WiFi y espera hasta que la conexión sea exitosa."""
    print(f"Conectando a la red WiFi: {WIFI_SSID}...")
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

def get_mqtt_client():
    """Crea y configura una nueva instancia del cliente MQTT."""
    client = MQTTClient(
        CLIENT_ID,
        MQTT_BROKER,
        port=MQTT_PORT,
        keepalive=60
    )
    # Configurar Last Will and Testament (LWT)
    will_message = ujson.dumps({"status": "offline", "reason": "unexpected_disconnect"})
    client.set_last_will(MQTT_STATUS_TOPIC, will_message, retain=True)
    return client

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

async def main():
    """Bucle principal que maneja la conexión y publicación de datos."""
    print("Iniciando sistema AquaData...")
    
    if not await connect_to_wifi():
        print("No se pudo conectar a WiFi. Reiniciando en 10s.")
        await uasyncio.sleep(10)
        machine.reset()

    mqtt_client = get_mqtt_client()

    while True:
        try:
            print("Intentando conectar al broker MQTT...")
            mqtt_client.connect()
            print(f"¡MQTT conectado! Publicando en: {MQTT_STREAM_TOPIC}")

            # Publicar estado 'online'
            online_message = ujson.dumps({"status": "online", "client_id": CLIENT_ID})
            mqtt_client.publish(MQTT_STATUS_TOPIC, online_message, retain=True)

            while True:
                # Generar y publicar datos
                sensor_data = simulate_sensor_data()
                message_json = ujson.dumps(sensor_data)
                
                # Publicar stream con delimitador para la app
                message_with_delimiter = message_json + '\n'
                mqtt_client.publish(MQTT_STREAM_TOPIC, message_with_delimiter)
                
                print(f"Publicado ciclo #{sensor_data['simulation_cycle']}")
                
                # Mantener la conexión activa
                mqtt_client.check_msg()
                
                await uasyncio.sleep(PUBLISH_INTERVAL_S)

        except Exception as e:
            print(f"Error de MQTT o de publicación: {e}. Reintentando en 10 segundos...")
            # Cerrar conexión si existe para evitar estados inconsistentes
            try:
                mqtt_client.disconnect()
            except:
                pass
            await uasyncio.sleep(10)
            # Re-crear el cliente puede ayudar a resolver problemas de estado
            mqtt_client = get_mqtt_client()

# --- EJECUCIÓN ---
if __name__ == "__main__":
    try:
        uasyncio.run(main())
    except KeyboardInterrupt:
        print("Programa detenido.")
    except Exception as e:
        print(f"Error fatal inesperado: {e}. Reiniciando...")
        machine.reset()
