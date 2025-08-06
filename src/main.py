import time
import json
import random
import bluetooth
from machine import reset
from wifi_manager import WiFiManager
from ble_uart_peripheral import BLEUART  
import ubinascii

# --- CONFIGURACIÓN MQTT ---
MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT = 1883
MQTT_TOPIC = "aquadata/sensor-data"
CLIENT_ID = f"aquadata-esp32-{ubinascii.hexlify(reset.unique_id()).decode()}"

# Variables globales para datos de sensores
sensor_data = {
    "ph": None,
    "do_conc": None,
    "do_sat": None,
    "temp": None,
    "timestamp": "",
    "status": "🟢 All systems normal",
    "readings_count": {"ph": 0, "do": 0},
    "errors_count": {"ph": 0, "do": 0},
    "simulation_cycle": 0,
    "wifi_status": "disconnected"
}

simulation_counter = 0
ble = bluetooth.BLE()
wifi_manager = WiFiManager()
uart = None
command_buffer = ""
mqtt_client = None

def connect_mqtt():
    """Conecta al broker MQTT si no está conectado."""
    global mqtt_client
    if mqtt_client is not None:
        try:
            mqtt_client.ping()
            return True
        except (OSError, AttributeError):
            print("MQTT ping failed, reconnecting...")
            mqtt_client = None
    
    if wifi_manager.is_connected():
        try:
            print(f"Connecting to MQTT Broker: {MQTT_BROKER}...")
            from umqtt.simple import MQTTClient
            mqtt_client = MQTTClient(CLIENT_ID, MQTT_BROKER, port=MQTT_PORT, keepalive=60)
            mqtt_client.connect()
            print(f"✅ MQTT Connected. Publishing to topic: {MQTT_TOPIC}")
            return True
        except Exception as e:
            print(f"❌ MQTT Connection Error: {e}")
            mqtt_client = None
            return False
    return False

def handle_ble_command(command_str):
    """Procesar comandos recibidos por BLE"""
    global sensor_data
    try:
        print(f"📨 Command received: {command_str}")
        
        try:
            cmd_data = json.loads(command_str)
            print(f"✅ JSON parsed successfully: {cmd_data.get('type', 'unknown')}")
        except ValueError: # Changed to ValueError for broader compatibility
            print(f"❌ JSON parse error")
            response = {"type": "error", "message": "Invalid JSON format"}
            send_ble_response(response)
            return
        
        cmd_type = cmd_data.get("type", "").lower()
        
        if cmd_type == "wifi_config":
            print(f"🔧 WiFi config command received")
            ssid = cmd_data.get("ssid")
            password = cmd_data.get("password")
            if ssid:
                print(f"🔧 Configuring WiFi for SSID: {ssid}")
                wifi_manager.disconnect()
                time.sleep(2)
                wifi_manager.connect(ssid, password)
                
                time.sleep(1)
                updated_status = get_wifi_status()
                sensor_data["wifi_status"] = updated_status

                response = {"type": "wifi_config_response", "status": "success", "message": f"Attempting to connect to {ssid}"}
                send_ble_response(response)
                
                if wifi_manager.is_connected():
                    connect_mqtt()
            else:
                send_ble_response({"type": "wifi_config_response", "status": "error", "message": "SSID is required"})
        
        else:
            response = {"type": "error", "message": f"Unknown command: {cmd_type}"}
            send_ble_response(response)
            
    except Exception as e:
        print(f"❌ Command error: {e}")
        response = {"type": "error", "message": "Command processing error"}
        send_ble_response(response)

def send_ble_response(response):
    """Enviar respuesta por BLE"""
    global uart
    try:
        if uart and len(uart._connections) > 0:
            json_response = json.dumps(response) + "\n"
            uart.write(json_response.encode('utf-8'))
            print(f"📤 BLE Response sent: {response.get('type', 'unknown')}")
        else:
            print("⚠️ No BLE connection for response")
    except Exception as e:
        print(f"❌ BLE Send error: {e}")

def on_ble_rx():
    """Callback para datos recibidos por BLE"""
    global command_buffer, uart
    try:
        while uart.any():
            chunk = uart.read().decode('utf-8')
            command_buffer += chunk
        
        while '\n' in command_buffer:
            command, command_buffer = command_buffer.split('\n', 1)
            if command.strip():
                handle_ble_command(command.strip())
        
        if len(command_buffer) > 500:
            print("⚠️ Buffer overflow, clearing...")
            command_buffer = ""
            
    except Exception as e:
        print(f"❌ RX Buffer error: {e}")
        command_buffer = ""

def get_wifi_status():
    """Obtener el estado detallado de WiFi"""
    try:
        if wifi_manager.is_connected():
            return "connected"
        return "disconnected"
    except Exception:
        return "disconnected"

def simulate_sensors():
    """Simular todos los sensores"""
    global simulation_counter
    ph_value = round(7.2 + 0.8 * (random.random() - 0.5) + 0.3 * (simulation_counter % 100) / 100, 2)
    temp = round(22.5 + 2.0 * (random.random() - 0.5) + 1.5 * (simulation_counter % 288) / 288, 1)
    do_conc = round(10.0 - (temp - 20) * 0.4 + 2.0 * (random.random() - 0.5) - 0.5 * random.random(), 1)
    theoretical_max = 10.5 - (temp - 20) * 0.3
    do_sat = round((do_conc / theoretical_max) * 100, 1)
    return ph_value, do_conc, do_sat, temp

def get_status_indicator(ph, do_conc, do_sat):
    if (ph < 6.0 or ph > 9.0) or (do_conc < 4.0) or (do_sat < 60):
        return "🔴 Critical levels detected"
    elif (ph < 6.5 or ph > 8.5) or (do_conc < 6.0) or (do_sat < 80):
        return "🟡 Warning levels detected"
    return "🟢 All systems normal"

def send_sensor_data_ble():
    """Enviar datos de sensores por BLE"""
    if uart and len(uart._connections) > 0:
        try:
            json_data = json.dumps(sensor_data) + "\n"
            uart.write(json_data.encode('utf-8'))
            return True
        except Exception as e:
            print(f"❌ BLE send error: {e}")
    return False

def send_sensor_data_mqtt():
    """Enviar datos de sensores por MQTT"""
    global mqtt_client
    if mqtt_client and wifi_manager.is_connected():
        try:
            json_data = json.dumps(sensor_data) + "\n"
            mqtt_client.publish(MQTT_TOPIC, json_data)
            return True
        except Exception as e:
            print(f"❌ MQTT send error: {e}. Reconnecting...")
            mqtt_client = None
            connect_mqtt()
    return False

def main_loop():
    """Bucle principal"""
    global sensor_data, simulation_counter, uart
    
    print("🔵 Initializing BLEUART...")
    try:
        uart = BLEUART(ble, name="AQUADATA-2.0", rxbuf=256)
        uart.irq(handler=on_ble_rx)
        print("✅ BLEUART initialized")
    except Exception as e:
        print(f"❌ BLE init error: {e}")
        return
    
    print("📶 Trying WiFi auto-connect...")
    if wifi_manager.auto_connect():
        connect_mqtt()
    
    readings = {"ph": 0, "do": 0}
    errors = {"ph": 0, "do": 0}
    
    print("🔬 AQUADATA 2.0 - Simplified BLE + MQTT")
    print("=" * 60)
    
    while True:
        try:
            simulation_counter += 1
            wifi_status_detailed = get_wifi_status()
            
            if wifi_status_detailed == "connected" and mqtt_client is None:
                connect_mqtt()

            current_time = time.localtime()
            timestamp = "{:02d}:{:02d}:{:02d}".format(current_time[3], current_time[4], current_time[5])
            
            ph_value, do_conc, do_sat, temp = simulate_sensors()
            
            readings["ph"] += 1
            readings["do"] += 1
            
            sensor_data.update({
                "ph": ph_value,
                "do_conc": do_conc,
                "do_sat": do_sat,
                "temp": temp,
                "timestamp": timestamp,
                "status": get_status_indicator(ph_value, do_conc, do_sat),
                "readings_count": readings.copy(),
                "errors_count": errors.copy(),
                "simulation_cycle": simulation_counter,
                "wifi_status": wifi_status_detailed
            })
            
            send_sensor_data_ble()
            send_sensor_data_mqtt()
            
            time.sleep(3)
            
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"❌ Main loop error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    print("=" * 60)
    print("    🌊 AQUADATA 2.0 - Simplified Mode 🌊")
    print("=" * 60)
    
    try:
        main_loop()
    except KeyboardInterrupt:
        print(f"\n🛑 AQUADATA 2.0 STOPPED")
    except Exception as e:
        print(f"\n❌ Critical error: {e}")
    finally:
        try:
            wifi_manager.disconnect()
            if mqtt_client:
                mqtt_client.disconnect()
            if uart:
                uart.close()
            ble.active(False)
            print("🔵 BLE, WiFi, and MQTT deactivated")
        except:
            pass
        print("=" * 60)
        print("Thanks for using AQUADATA 2.0! 👋🌊")
        print("=" * 60)
