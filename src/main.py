# main.py - ESP32 con MicroPython - Versión Híbrida y Robusta
import network
import uasyncio
from umqtt.simple import MQTTClient
import ujson
import utime
import machine
import ubinascii
import random
import bluetooth
from ble_uart_peripheral import BLEUART

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
ble_uart = None
operation_mode = "hybrid"  # 'hybrid', 'ble_only', 'mqtt_only'

simulation_cycle = 0
readings_count = {'ph': 0, 'do': 0}
errors_count = {'ph': 0, 'do': 0}

# --- MANEJO DE COMANDOS BLE ---
def handle_ble_command(command_str):
    """Procesar comandos recibidos por BLE."""
    global operation_mode, WIFI_SSID, WIFI_PASSWORD
    try:
        cmd_data = ujson.loads(command_str)
        cmd_type = cmd_data.get("type", "").lower()
        print(f"📨 Comando BLE recibido: {cmd_type}")

        response = {"status": "success", "type": f"{cmd_type}_response"}

        if cmd_type == "wifi_config":
            WIFI_SSID = cmd_data.get("ssid")
            WIFI_PASSWORD = cmd_data.get("password")
            response["message"] = f"WiFi credentials updated for SSID: {WIFI_SSID}"
            print(response["message"])
            # Forzar reconexión en el siguiente ciclo
            if wlan.isconnected():
                wlan.disconnect()

        elif cmd_type == "wifi_disconnect":
            if wlan.isconnected():
                wlan.disconnect()
                response["message"] = "WiFi disconnected."
            else:
                response["message"] = "WiFi already disconnected."
            print(response["message"])

        elif cmd_type == "restart":
            response["message"] = "Restarting device..."
            send_ble_response(response)
            utime.sleep(1)
            machine.reset()

        elif cmd_type == "set_mode":
            new_mode = cmd_data.get("mode")
            if new_mode in ["hybrid", "ble_only", "mqtt_only"]:
                operation_mode = new_mode
                response["message"] = f"Operation mode set to {operation_mode}"
            else:
                response["status"] = "error"
                response["message"] = f"Invalid mode: {new_mode}"
            print(response["message"])
            
        else:
            response["status"] = "error"
            response["message"] = f"Unknown command: {cmd_type}"

        send_ble_response(response)

    except Exception as e:
        print(f"❌ Error procesando comando BLE: {e}")
        send_ble_response({"status": "error", "message": str(e)})

def on_ble_rx():
    """Callback para cuando se reciben datos por BLE."""
    global ble_uart
    try:
        command_str = ble_uart.read().decode().strip()
        if command_str:
            handle_ble_command(command_str)
    except Exception as e:
        print(f"❌ Error en on_ble_rx: {e}")

def send_ble_response(response_data):
    """Envía una respuesta JSON por BLE si está conectado."""
    if ble_uart and ble_uart.is_connected():
        try:
            message = ujson.dumps(response_data) + '\n'
            ble_uart.write(message)
            print(f"📤 Respuesta BLE enviada: {message.strip()}")
        except Exception as e:
            print(f"❌ Error enviando respuesta BLE: {e}")

# --- FUNCIONES DE RED ---

async def connect_to_wifi():
    """Se conecta a la red WiFi de forma asíncrona y robusta."""
    if wlan.isconnected() or not WIFI_SSID:
        return wlan.isconnected()
        
    print(f"📡 Conectando a WiFi: {WIFI_SSID}...")
    wlan.active(True)
    wlan.connect(WIFI_SSID, WIFI_PASSWORD)
    
    max_wait = 20
    while max_wait > 0:
        if wlan.isconnected():
            print(f"✅ WiFi conectado. IP: {wlan.ifconfig()[0]}")
            return True
        max_wait -= 1
        await uasyncio.sleep(1)
            
    print("❌ Fallo al conectar a WiFi.")
    return False

def connect_to_mqtt():
    """Se conecta al broker MQTT. Devuelve True si es exitoso."""
    global mqtt_client
    try:
        mqtt_client = MQTTClient(CLIENT_ID, MQTT_BROKER, port=MQTT_PORT, keepalive=60)
        mqtt_client.connect()
        print(f"✅ MQTT conectado a {MQTT_BROKER}")
        return True
    except Exception as e:
        print(f"❌ Error conectando a MQTT: {e}")
        mqtt_client = None
        return False

def is_mqtt_connected():
    """Verifica si MQTT está conectado intentando un ping."""
    if mqtt_client is None: return False
    try:
        mqtt_client.ping()
        return True
    except (OSError, AttributeError):
        return False

# --- SIMULACIÓN Y LÓGICA DE DATOS ---

def simulate_sensor_data():
    """Genera datos de sensores simulados."""
    global simulation_cycle, readings_count, errors_count
    simulation_cycle += 1
    
    # Simulación de valores
    ph_value = round(random.uniform(6.5, 8.0), 2)
    do_conc = round(random.uniform(5.0, 9.0), 2)
    do_sat = round(random.uniform(85.0, 110.0), 1)
    temp = round(random.uniform(20.0, 26.0), 1)

    # Simulación de errores
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
    
    # Determinar estado
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

# --- BUCLE PRINCIPAL ---

async def main_loop():
    """Bucle principal para conectar y publicar datos de forma robusta."""
    global ble_uart, mqtt_client
    
    # Inicializar BLE
    ble = bluetooth.BLE()
    ble_uart = BLEUART(ble, name="AQUADATA-2.0")
    ble_uart.irq(handler=on_ble_rx)
    print("🔵 BLE UART Inicializado. Anunciando como 'AQUADATA-2.0'")

    print(f"🚀 Iniciando sistema AquaData. Modo inicial: {operation_mode}")
    
    while True:
        try:
            # --- Gestión de Conexiones ---
            wifi_is_up = wlan.isconnected()
            if operation_mode in ["hybrid", "mqtt_only"] and not wifi_is_up:
                await connect_to_wifi()
                wifi_is_up = wlan.isconnected()

            mqtt_is_up = is_mqtt_connected()
            if wifi_is_up and operation_mode in ["hybrid", "mqtt_only"] and not mqtt_is_up:
                connect_to_mqtt()

            # --- Recopilación y Envío de Datos ---
            sensor_data = simulate_sensor_data()
            message = ujson.dumps(sensor_data)
            message_with_delimiter = message + '\n'

            # 1. Enviar por Bluetooth
            if operation_mode in ["hybrid", "ble_only"] and ble_uart.is_connected():
                try:
                    ble_uart.write(message_with_delimiter)
                    print(f"📤 BLE (Ciclo {simulation_cycle}): Datos enviados.")
                except Exception as e:
                    print(f"❌ Error enviando por BLE: {e}")

            # 2. Enviar por MQTT
            if operation_mode in ["hybrid", "mqtt_only"] and wifi_is_up and is_mqtt_connected():
                try:
                    mqtt_client.publish(MQTT_TOPIC, message_with_delimiter, retain=False)
                    print(f"📤 MQTT (Ciclo {simulation_cycle}): Datos publicados.")
                except Exception as e:
                    print(f"❌ Error publicando en MQTT: {e}")
                    mqtt_client = None # Forzar reconexión

        except OSError as e:
            print(f"‼️ Error de red/OS: {e}. Reiniciando conexiones...")
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
        
        await uasyncio.sleep(PUBLISH_INTERVAL_S)

# --- EJECUCIÓN ---
if __name__ == "__main__":
    try:
        uasyncio.run(main_loop())
    except KeyboardInterrupt:
        print("\n🛑 Programa detenido.")
    except Exception as e:
        print(f"‼️ Error crítico: {e}")
        utime.sleep(10)
        machine.reset()

    