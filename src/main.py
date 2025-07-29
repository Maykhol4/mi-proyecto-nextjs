# main.py - ESP32 con MicroPython - Versión Robusta
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
MQTT_TOPIC = "aquadata/sensor-data"
PUBLISH_INTERVAL_S = 5

# --- ESTADO GLOBAL ---
wlan = network.WLAN(network.STA_IF)
mqtt_client = None

simulation_cycle = 0
readings_count = {'ph': 0, 'do': 0}
errors_count = {'ph': 0, 'do': 0}

# --- FUNCIONES ---

async def connect_to_wifi():
    """Se conecta a la red WiFi de forma asíncrona."""
    if wlan.isconnected():
        return True
        
    print(f"Conectando a WiFi: {WIFI_SSID}...")
    wlan.active(True)
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
        mqtt_client.connect()
        print(f"MQTT conectado. Publicando en: {MQTT_TOPIC}")
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
    if urandom.randint(0, 100) > 95:
        status = "🟡 Minor warning detected"
        errors_count['ph'] += 1
    
    ph_value = urandom.randint(650, 800) / 100.0
    do_value = urandom.randint(550, 850) / 100.0
    do_sat_value = urandom.randint(8500, 10500) / 100.0
    temp_value = urandom.randint(2100, 2450) / 100.0
    
    current_time = utime.localtime()
    
    return {
        "ph": round(ph_value, 2),
        "dissolved_oxygen": round(do_value, 1),
        "dissolved_oxygen_saturation": round(do_sat_value, 1),
        "temperature": round(temp_value, 1),
        "timestamp": f"{current_time[3]:02}:{current_time[4]:02}:{current_time[5]:02}",
        "status": status,
        "readings_count": readings_count.copy(),
        "errors_count": errors_count.copy(),
        "simulation_cycle": simulation_cycle
    }

def is_mqtt_connected():
    """Verifica si MQTT está conectado intentando un ping."""
    if mqtt_client is None:
        return False
    try:
        mqtt_client.ping()
        return True
    except:
        return False

async def main_loop():
    """Bucle principal para conectar y publicar datos de forma robusta."""
    print("Iniciando sistema AquaData...")
    
    while True:
        try:
            if not wlan.isconnected():
                print("WiFi desconectado, reintentando...")
                if not await connect_to_wifi():
                    await uasyncio.sleep(10)
                    continue

            if not is_mqtt_connected():
                print("MQTT desconectado, reintentando...")
                if mqtt_client:
                    try: mqtt_client.disconnect()
                    except: pass
                mqtt_client = None
                
                if not connect_to_mqtt():
                    await uasyncio.sleep(10)
                    continue
            
            sensor_data = simulate_sensor_data()
            message = ujson.dumps(sensor_data)
            
            # SOLUCIÓN: Añadir delimitador de nueva línea para el frontend
            message_with_delimiter = message + '\n'
            
            print(f"Publicando (Ciclo {simulation_cycle})")
            mqtt_client.publish(MQTT_TOPIC, message_with_delimiter, retain=False)
            
        except OSError as e:
            print(f"Error de red: {e}. Reiniciando conexiones...")
            if mqtt_client:
                try: mqtt_client.disconnect()
                except: pass
            mqtt_client = None
            wlan.disconnect()
            await uasyncio.sleep(2)
            
        except Exception as e:
            print(f"Error en el bucle principal: {e}")
            if mqtt_client:
                try: mqtt_client.disconnect()
                except: pass
            mqtt_client = None
            await uasyncio.sleep(5)
        
        await uasyncio.sleep(PUBLISH_INTERVAL_S)

# --- EJECUCIÓN ---
if __name__ == "__main__":
    try:
        wlan.active(True)
        uasyncio.run(main_loop())
    except KeyboardInterrupt:
        print("\nPrograma detenido por el usuario.")
    except Exception as e:
        print(f"Error fatal en el sistema: {e}")
        print("Reiniciando en 10 segundos...")
        utime.sleep(10)
        machine.reset()
