/**
 * @file esp32-reference-code.cpp
 * @author Gemini
 * @brief Código de referencia C++ (Framework Arduino) para un ESP32 compatible con la app AQUADATA 2.0.
 * 
 * Este código configura un servidor BLE con el servicio y las características UART
 * que la aplicación móvil espera encontrar. Incluye la corrección del descriptor BLE2902
 * para asegurar la compatibilidad de las notificaciones.
 * 
 * Basado en los ejemplos de Neil Kolban y Evandro Copercini.
 */

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <ArduinoJson.h> // Necesario para parsear los comandos de la app

// --- Nombre del Dispositivo BLE ---
// Este es el nombre que aparecerá en la aplicación cuando busques dispositivos.
#define BLE_DEVICE_NAME "AQUADATA-2.0"

// --- Definiciones de UUIDs (Deben coincidir con la app) ---
// Estos identificadores únicos universales definen el "contrato" de comunicación
// entre la app y el ESP32. Deben ser exactamente los mismos en ambos lados.

// 1. UUID del Servicio Principal (UART Service)
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"

// 2. UUID de la Característica de Recepción (App -> ESP32)
//    La aplicación escribe (write) en esta característica para enviar comandos al ESP32.
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"

// 3. UUID de la Característica de Transmisión (ESP32 -> App)
//    El ESP32 envía notificaciones (notify) a través de esta característica para mandar datos/respuestas.
#define CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"


BLECharacteristic *pTxCharacteristic;
bool deviceConnected = false;
String rxBuffer = ""; // Buffer para acumular datos entrantes

// Clase para manejar los eventos de conexión/desconexión del servidor BLE
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println("Device Connected");
    }

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println("Device Disconnected");
      // Reiniciar la publicidad para que se pueda volver a conectar
      pServer->getAdvertising()->start();
    }
};

// Función para enviar una respuesta JSON a la app
void sendJsonResponse(const JsonDocument& doc) {
    if (deviceConnected) {
        String jsonString;
        serializeJson(doc, jsonString);
        jsonString += "\n"; // Asegurarse de que termina con un salto de línea
        pTxCharacteristic->setValue((uint8_t*)jsonString.c_str(), jsonString.length());
        pTxCharacteristic->notify();
        Serial.print("Respuesta enviada: ");
        Serial.println(jsonString);
    }
}


// Clase para manejar las escrituras en la característica RX
class MyCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
        std::string value = pCharacteristic->getValue();
        rxBuffer += String(value.c_str());

        // Procesar solo cuando se recibe un salto de línea
        if (rxBuffer.endsWith("\n")) {
            rxBuffer.trim(); // Limpiar espacios en blanco
            Serial.print("Comando JSON recibido: ");
            Serial.println(rxBuffer);

            JsonDocument doc;
            DeserializationError error = deserializeJson(doc, rxBuffer);
            
            rxBuffer = ""; // Limpiar buffer después de procesar

            JsonDocument responseDoc;
            if (error) {
                Serial.print("deserializeJson() failed: ");
                Serial.println(error.c_str());
                responseDoc["type"] = "command_response";
                responseDoc["status"] = "error";
                responseDoc["message"] = "Invalid JSON format.";
                sendJsonResponse(responseDoc);
                return;
            }

            String type = doc["type"];
            if (type == "wifi_config") {
                String ssid = doc["ssid"];
                String password = doc["password"];
                Serial.print("Configurando WiFi para SSID: ");
                Serial.println(ssid);
                
                // Aquí iría tu lógica para conectar al WiFi
                // WiFi.begin(ssid.c_str(), password.c_str());
                
                // Enviar respuesta de éxito (simulada)
                responseDoc["type"] = "wifi_config_response";
                responseDoc["status"] = "success";
                responseDoc["message"] = "WiFi credentials received and being processed.";
                sendJsonResponse(responseDoc);
            } else {
                responseDoc["type"] = "command_response";
                responseDoc["status"] = "error";
                responseDoc["message"] = "Unknown command type.";
                sendJsonResponse(responseDoc);
            }
        }
    }
};


void setup() {
  Serial.begin(115200);
  Serial.println("Starting BLE setup...");

  // 1. Inicializar dispositivo BLE
  BLEDevice::init(BLE_DEVICE_NAME);

  // 2. Crear el servidor BLE
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // 3. Crear el servicio BLE UART
  BLEService *pService = pServer->createService(SERVICE_UUID);

  // 4. Crear la característica de Transmisión (TX)
  pTxCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID_TX,
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  
  // !! SOLUCIÓN AL ERROR "GATT NOT SUPPORTED" !!
  // Añadir el descriptor 2902 es crucial para que las notificaciones funcionen
  pTxCharacteristic->addDescriptor(new BLE2902());

  // 5. Crear la característica de Recepción (RX)
  BLECharacteristic *pRxCharacteristic = pService->createCharacteristic(
                                             CHARACTERISTIC_UUID_RX,
                                             BLECharacteristic::PROPERTY_WRITE
                                           );
  pRxCharacteristic->setCallbacks(new MyCallbacks());

  // 6. Iniciar el servicio
  pService->start();

  // 7. Iniciar la publicidad (Advertising)
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID); // Anunciar el servicio
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  
  Serial.println("✅ BLE Server started and advertising. Ready to connect.");
}

void loop() {
  // El código principal se maneja a través de callbacks, 
  // pero puedes poner lógica adicional aquí si es necesario.
  
  // Ejemplo: enviar un "keep-alive" o un estado cada 10 segundos
  static unsigned long lastMessageTime = 0;
  if (deviceConnected && (millis() - lastMessageTime > 10000)) {
    String statusMessage = "{\"type\":\"status_update\",\"message\":\"AQUADATA device is alive.\"}\n";
    pTxCharacteristic->setValue((uint8_t*)statusMessage.c_str(), statusMessage.length());
    pTxCharacteristic->notify();
    lastMessageTime = millis();
    Serial.println("Sent keep-alive message.");
  }
  
  delay(100); 
}
