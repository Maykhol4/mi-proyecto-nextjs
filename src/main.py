# main.py - ESP32 con MicroPython - Versión Híbrida y Robusta
import network
import uasyncio
from umqtt.simple import MQTTClient
import ujson
import utime
import machine
import ubinascii
import random

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
ble_uart = None  # Renombrado para claridad

simulation_cycle = 0
readings_count = {'ph': 0, 'do': 0}
errors_count = {'ph': 0, 'do': 0}

# --- FUNCIONES ---

async def connect_to_wifi():
    """Se conecta a la red WiFi de forma asíncrona y robusta."""
    if wlan.isconnected():
        return True
        
    print(f"📡 Conectando a WiFi: {WIFI_SSID}...")
    wlan.active(True)
    if not wlan.isconnected():
        wlan.connect(WIFI_SSID, WIFI_PASSWORD)
        max_wait = 20
        while max_wait > 0:
            if wlan.isconnected():
                print(f"✅ WiFi conectado. IP: {wlan.ifconfig()[0]}")
                return True
            max_wait -= 1
            print("⏳ Esperando conexión WiFi...")
            await uasyncio.sleep(1)
            
    if not wlan.isconnected():
        print("❌ Error: Fallo al conectar a WiFi.")
        return False
    return True

def connect_to_mqtt():
    """Se conecta al broker MQTT. Devuelve True si es exitoso, False si no."""
    global mqtt_client
    try:
        if mqtt_client:
            try:
                mqtt_client.disconnect()
            except:
                pass
        
        print(f"🧠 Conectando a MQTT: {MQTT_BROKER}...")
        mqtt_client = MQTTClient(CLIENT_ID, MQTT_BROKER, port=MQTT_PORT, keepalive=60)
        mqtt_client.connect()
        print(f"✅ MQTT conectado. Publicando en: {MQTT_TOPIC}")
        return True
    except Exception as e:
        print(f"❌ Error conectando a MQTT: {e}")
        mqtt_client = None
        return False

def simulate_sensor_data():
    """Genera datos de sensores simulados."""
    global simulation_cycle, readings_count, errors_count
    simulation_cycle += 1
    
    ph_value = round(random.uniform(6.5, 8.0), 2)
    do_conc = round(random.uniform(5.0, 9.0), 2)
    do_sat = round(random.uniform(85.0, 110.0), 1)
    temp = round(random.uniform(20.0, 26.0), 1)

    # Simular errores ocasionales
    if random.random() < 0.05:
        ph_value = None
        errors_count['ph'] += 1
    else:
        readings_count['ph'] += 1

    if random.random() < 0.05:
        do_conc = None
        errors_count['do'] += 1
    else:
        readings_count['do'] += 1

    status = "🟢 All systems normal"
    if ph_value is None or do_conc is None:
        status = "🔴 Sensor error detected"
    elif ph_value < 6.5 or ph_value > 8.5 or do_conc < 6.0:
        status = "🟡 Warning levels detected"

    return {
        "ph": ph_value,
        "do_conc": do_conc,
        "do_sat": do_sat,
        "temp": temp,
        "timestamp": f"{utime.localtime()[3]:02}:{utime.localtime()[4]:02}:{utime.localtime()[5]:02}",
        "status": status,
        "readings_count": readings_count.copy(),
        "errors_count": errors_count.copy(),
        "simulation_cycle": simulation_cycle,
        "wifi_status": "connected" if wlan.isconnected() else "disconnected"
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
    global ble_uart  # Asegurarse de usar la variable global
    
    from ble_uart_peripheral import BLEUART
    ble = bluetooth.BLE()
    ble_uart = BLEUART(ble, name="AQUADATA-2.0")
    print("🔵 BLE UART Inicializado. Nombre: AQUADATA-2.0")

    print("🚀 Iniciando sistema AquaData Híbrido...")
    
    while True:
        try:
            # --- Gestión de Conexiones ---
            wifi_is_up = wlan.isconnected()
            if not wifi_is_up:
                print("WiFi desconectado, reintentando en segundo plano...")
                await connect_to_wifi()
                # Actualizar estado después del intento
                wifi_is_up = wlan.isconnected()

            mqtt_is_up = is_mqtt_connected()
            if wifi_is_up and not mqtt_is_up:
                print("MQTT desconectado, reintentando...")
                connect_to_mqtt()

            # --- Recopilación y Envío de Datos ---
            sensor_data = simulate_sensor_data()
            message = ujson.dumps(sensor_data)
            message_with_delimiter = message + '\n'

            # 1. Enviar por Bluetooth si hay alguien conectado
            if ble_uart and ble_uart.is_connected():
                try:
                    ble_uart.write(message_with_delimiter)
                    print(f"📤 BLE (Ciclo {simulation_cycle}): Datos enviados.")
                except Exception as e:
                    print(f"❌ Error enviando por BLE: {e}")

            # 2. Enviar por MQTT si está conectado
            if wlan.isconnected() and is_mqtt_connected():
                try:
                    mqtt_client.publish(MQTT_TOPIC, message_with_delimiter, retain=False)
                    print(f"📤 MQTT (Ciclo {simulation_cycle}): Datos publicados.")
                except Exception as e:
                    print(f"❌ Error publicando en MQTT: {e}")
                    # Forzar reconexión en el siguiente ciclo
                    mqtt_client.disconnect()
                    mqtt_client = None

        except OSError as e:
            print(f"‼️ Error de red: {e}. Reiniciando conexiones...")
            if mqtt_client:
                try: mqtt_client.disconnect()
                except: pass
            mqtt_client = None
            if wlan.isconnected():
                wlan.disconnect()
            await uasyncio.sleep(5)
            
        except Exception as e:
            print(f"‼️ Error fatal en el bucle principal: {e}")
            await uasyncio.sleep(10)
        
        # Esperar para el siguiente ciclo
        await uasyncio.sleep(PUBLISH_INTERVAL_S)

# --- EJECUCIÓN ---
if __name__ == "__main__":
    try:
        wlan.active(True)
        uasyncio.run(main_loop())
    except KeyboardInterrupt:
        print("\n🛑 Programa detenido por el usuario.")
    except Exception as e:
        print(f"‼️ Error crítico: {e}")
        print("🔄 Reiniciando en 10 segundos...")
        utime.sleep(10)
        machine.reset()

    