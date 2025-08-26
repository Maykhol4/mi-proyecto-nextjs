
import time
import json
import random
import bluetooth
from machine import reset, Pin
from wifi_manager import WiFiManager
from ble_uart_peripheral import BLEUART  
import ubinascii

# --- CONFIGURACIÓN MQTT ---
MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT = 1883
MQTT_TOPIC = "aquadata/sensor-data"
CLIENT_ID = f"aquadata-esp32-{ubinascii.hexlify(reset.unique_id()).decode()}"

# --- VARIABLES GLOBALES ---
sensor_data = {
    "ph": None,
    "do_conc": None,
    "do_sat": None,
    "temp": None,
    "timestamp": "--:--:--",
    "status": "⚪ Sensor reading error",
    "readings_count": {"ph": 0, "do": 0},
    "errors_count": {"ph": 0, "do": 0},
    "wifi_status": "disconnected"
}

ble = bluetooth.BLE()
wifi_manager = WiFiManager()
uart = None
command_buffer = ""
mqtt_client = None

# --- FUNCIONES ---

def connect_mqtt():
    """Conecta al broker MQTT si no está conectado."""
    global mqtt_client
    if mqtt_client:
        try:
            mqtt_client.ping()
            return True # Ya conectado y funcionando
        except (OSError, AttributeError):
            print("MQTT ping failed, will attempt reconnect.")
            mqtt_client = None
    
    if wifi_manager.is_connected():
        try:
            print(f"Connecting to MQTT Broker: {MQTT_BROKER}...")
            from umqtt.simple import MQTTClient
            mqtt_client = MQTTClient(CLIENT_ID, MQTT_BROKER, port=MQTT_PORT, keepalive=60)
            mqtt_client.set_callback(lambda t, m: None) # Callback vacío para evitar errores
            mqtt_client.connect()
            print(f"✅ MQTT Connected. Publishing to topic: {MQTT_TOPIC}")
            return True
        except Exception as e:
            print(f"❌ MQTT Connection Error: {e}")
            mqtt_client = None
    return False

def handle_ble_command(command_str):
    """Procesar comandos recibidos por BLE."""
    global sensor_data
    try:
        print(f"📨 Command received: {command_str}")
        
        try:
            cmd_data = json.loads(command_str)
            cmd_type = cmd_data.get("type", "").lower()
            print(f"✅ JSON parsed successfully. Type: '{cmd_type}'")
        except (ValueError, TypeError):
            print("❌ JSON parse error.")
            send_ble_response({"type": "error", "message": "Invalid JSON format"})
            return
        
        if cmd_type == "wifi_config":
            ssid = cmd_data.get("ssid")
            password = cmd_data.get("password")
            if ssid:
                print(f"🔧 Configuring WiFi for SSID: {ssid}")
                send_ble_response({"type": "wifi_config_response", "status": "info", "message": f"Attempting to connect to {ssid}..."})
                wifi_manager.disconnect()
                time.sleep(2)
                
                connection_success = wifi_manager.connect(ssid, password)
                
                # Esperar un poco para que la IP se asigne
                time.sleep(5)
                
                updated_status = get_wifi_status()
                sensor_data["wifi_status"] = updated_status
                
                if connection_success and updated_status == 'connected':
                    send_ble_response({"type": "wifi_config_response", "status": "success", "message": f"Successfully connected to {ssid}"})
                    connect_mqtt()
                else:
                    send_ble_response({"type": "wifi_config_response", "status": "error", "message": f"Failed to connect to {ssid}. Check credentials."})
            else:
                send_ble_response({"type": "wifi_config_response", "status": "error", "message": "SSID is required."})

        elif cmd_type == "wifi_disconnect":
            print("🔧 WiFi disconnect command received")
            wifi_manager.disconnect()
            sensor_data["wifi_status"] = "disconnected"
            send_ble_response({"type": "wifi_disconnect_response", "status": "success", "message": "WiFi disconnected."})

        else:
            send_ble_response({"type": "error", "message": f"Unknown command type: {cmd_type}"})
            
    except Exception as e:
        print(f"❌ Command processing error: {e}")
        send_ble_response({"type": "error", "message": "An internal error occurred."})


def send_ble_response(response_data):
    """Enviar respuesta en formato JSON por BLE."""
    global uart
    if uart and uart.is_connected():
        try:
            json_response = json.dumps(response_data) + "\n"
            uart.write(json_response.encode('utf-8'))
            print(f"📤 BLE Response Sent: {response_data.get('type', 'unknown')}")
        except Exception as e:
            print(f"❌ BLE send response error: {e}")
    else:
        print("⚠️ Cannot send BLE response: Not connected.")


def on_ble_rx():
    """Callback para datos recibidos por BLE. Acumula hasta recibir un newline."""
    global command_buffer, uart
    try:
        data = uart.read()
        if data:
            command_buffer += data.decode('utf-8')
            
            # Procesar todos los comandos completos en el buffer
            while '\n' in command_buffer:
                command, command_buffer = command_buffer.split('\n', 1)
                if command.strip():
                    handle_ble_command(command.strip())
            
            # Prevenir buffer overflow
            if len(command_buffer) > 512:
                print("⚠️ RX Buffer overflow, clearing.")
                command_buffer = ""
    except Exception as e:
        print(f"❌ BLE RX error: {e}")
        command_buffer = "" # Limpiar en caso de error


def get_wifi_status():
    """Obtener el estado de la conexión WiFi."""
    return "connected" if wifi_manager.is_connected() else "disconnected"


def read_real_sensors():
    """Simula la lectura de datos de sensores."""
    ph_value = round(7.2 + 1.5 * (random.random() - 0.5), 2)
    temp = round(22.5 + 5.0 * (random.random() - 0.5), 1)
    do_conc = round(10.0 - (temp - 20) * 0.4 + 2.0 * (random.random() - 0.5), 1)
    
    # Simular fallas de lectura ocasionales
    if random.random() < 0.05: ph_value = None
    if random.random() < 0.05: do_conc, temp = None, None
        
    if do_conc and temp:
      theoretical_max = 10.5 - (temp - 20) * 0.3
      do_sat = round((do_conc / theoretical_max) * 100, 1) if theoretical_max > 0 else None
    else:
      do_sat = None
      
    return ph_value, do_conc, do_sat, temp


def get_status_indicator(ph, do_conc, do_sat):
    """Determina el estado general basado en los valores de los sensores."""
    if ph is None or do_conc is None: return "⚪ Sensor reading error"
    if (ph < 6.0 or ph > 9.0) or (do_conc < 4.0) or (do_sat and do_sat < 60): return "🔴 Critical levels detected"
    if (ph < 6.5 or ph > 8.5) or (do_conc < 6.0) or (do_sat and do_sat < 80): return "🟡 Warning levels detected"
    return "🟢 All systems normal"


def send_sensor_data():
    """Envía los datos del sensor a través de BLE y MQTT si están disponibles."""
    global mqtt_client
    json_data = json.dumps(sensor_data) + "\n"
    
    # 1. Enviar por BLE (siempre que haya conexión)
    if uart and uart.is_connected():
        try:
            uart.write(json_data.encode('utf-8'))
        except Exception as e:
            print(f"❌ BLE send data error: {e}")
            
    # 2. Enviar por MQTT (de forma oportunista)
    if mqtt_client and wifi_manager.is_connected():
        try:
            mqtt_client.publish(MQTT_TOPIC, json_data)
        except Exception as e:
            print(f"❌ MQTT send data error: {e}. Will try to reconnect.")
            mqtt_client = None # Forzar reconexión en el siguiente ciclo


def format_uptime(uptime_ms):
    """Formatea milisegundos a HH:MM:SS."""
    uptime_s = uptime_ms // 1000
    seconds = uptime_s % 60
    minutes = (uptime_s // 60) % 60
    hours = (uptime_s // 3600)
    return "{:02d}:{:02d}:{:02d}".format(hours, minutes, seconds)


def main_loop():
    """Bucle principal de la aplicación."""
    global sensor_data, uart, mqtt_client
    
    print("🔵 Initializing BLEUART...")
    try:
        uart = BLEUART(ble, name="AQUADATA-2.0", rxbuf=512)
        uart.irq(handler=on_ble_rx)
        print("✅ BLEUART initialized and advertising.")
    except Exception as e:
        print(f"❌ FATAL: BLE could not be initialized: {e}")
        time.sleep(5)
        reset()
        
    print("📶 Attempting WiFi auto-connect...")
    wifi_manager.auto_connect() # No bloqueante, solo intenta
    
    start_time = time.ticks_ms()
    last_mqtt_attempt = 0
    
    while True:
        try:
            # 1. Leer sensores
            ph, do_conc, do_sat, temp = read_real_sensors()
            
            # 2. Actualizar contadores y estado
            if ph is not None: sensor_data["readings_count"]["ph"] += 1
            else: sensor_data["errors_count"]["ph"] += 1
            
            if do_conc is not None: sensor_data["readings_count"]["do"] += 1
            else: sensor_data["errors_count"]["do"] += 1
            
            sensor_data.update({
                "ph": ph, "do_conc": do_conc, "do_sat": do_sat, "temp": temp,
                "timestamp": format_uptime(time.ticks_diff(time.ticks_ms(), start_time)),
                "status": get_status_indicator(ph, do_conc, do_sat),
                "wifi_status": get_wifi_status()
            })
            
            # 3. Intentar conexión MQTT si es necesario (cada 30s)
            current_time = time.ticks_ms()
            if sensor_data["wifi_status"] == "connected" and not mqtt_client:
                if time.ticks_diff(current_time, last_mqtt_attempt) > 30000:
                    connect_mqtt()
                    last_mqtt_attempt = current_time
            
            # 4. Enviar datos (BLE y/o MQTT)
            send_sensor_data()
            
            # 5. Esperar para el siguiente ciclo
            time.sleep(3)
            
        except KeyboardInterrupt:
            print("🛑 Program stopped by user.")
            break
        except Exception as e:
            print(f"❌ Main loop error: {e}")
            time.sleep(5) # Pausa para evitar un bucle de reinicio rápido


if __name__ == "__main__":
    main_loop()
    if uart:
        uart.close()
    print("Program finished.")

    