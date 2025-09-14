/**
 * @file esp32-reference-code.cpp
 * @author Gemini
 * @brief Código de referencia para un ESP32 en C++ (Framework Arduino) compatible con la app AQUADATA 2.0.
 * 
 * Este código implementa un servidor BLE que permite a la aplicación móvil conectarse
 * y enviar credenciales WiFi. El ESP32 recibe estas credenciales, intenta conectarse
 * a la red especificada y devuelve una respuesta a la app sobre el resultado.
 * 
 * Dependencias de la librería (PlatformIO):
 * - "nkolban/ESP32 BLE Arduino"
 * - "bblanchon/ArduinoJson"
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <WiFi.h>
#include <ArduinoJson.h>

// --- Definiciones de UUIDs (Deben coincidir con la app) ---
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e" // App -> ESP32
#define CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e" // ESP32 -> App

// --- Variables Globales ---
BLECharacteristic *pTxCharacteristic;
bool deviceConnected = false;
String command_buffer = "";

// --- Prototipos de Funciones ---
void sendBleResponse(const JsonObject& response);
void connectToWifi(const char* ssid, const char* password);

// --- Clases de Callbacks de BLE ---

// Callback para eventos de conexión/desconexión del servidor BLE
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println("Dispositivo conectado");
      // Si se desea, se puede detener el advertising para ahorrar energía
      // BLEDevice::startAdvertising(); 
    }

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println("Dispositivo desconectado");
      // Reiniciar el advertising para permitir nuevas conexiones
      pServer->getAdvertising()->start();
    }
};

// Callback para datos recibidos en la característica RX
class MyCharacteristicCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      std::string rxValue = pCharacteristic->getValue();

      if (rxValue.length() > 0) {
        Serial.print("Comando recibido: ");
        Serial.println(rxValue.c_str());

        // Acumular datos en el buffer
        command_buffer += rxValue.c_str();

        // Procesar si se recibe un newline
        if (command_buffer.endsWith("\n")) {
          // Eliminar el newline
          command_buffer.trim();
          
          StaticJsonDocument<256> doc;
          DeserializationError error = deserializeJson(doc, command_buffer);

          if (error) {
            Serial.print("deserializeJson() falló: ");
            Serial.println(error.c_str());
            StaticJsonDocument<128> errorDoc;
            JsonObject errorObj = errorDoc.to<JsonObject>();
            errorObj["type"] = "error";
            errorObj["message"] = "Invalid JSON format";
            sendBleResponse(errorObj);
            command_buffer = ""; // Limpiar buffer
            return;
          }
          
          const char* type = doc["type"];

          if (strcmp(type, "wifi_config") == 0) {
            const char* ssid = doc["ssid"];
            const char* password = doc["password"];
            connectToWifi(ssid, password);
          } else {
            Serial.print("Comando desconocido: ");
            Serial.println(type);
            StaticJsonDocument<128> unknownDoc;
            JsonObject unknownObj = unknownDoc.to<JsonObject>();
            unknownObj["type"] = "error";
            unknownObj["message"] = "Unknown command type";
            sendBleResponse(unknownObj);
          }

          // Limpiar el buffer después de procesar
          command_buffer = "";
        }
      }
    }
};

// --- Funciones Principales ---

void setup() {
  Serial.begin(115200);
  Serial.println("Iniciando ESP32 AQUADATA Configurator...");

  // 1. Crear el dispositivo BLE
  BLEDevice::init("AQUADATA-2.0");

  // 2. Crear el servidor BLE
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // 3. Crear el servicio UART
  BLEService *pService = pServer->createService(SERVICE_UUID);

  // 4. Crear característica TX (ESP32 -> App)
  pTxCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID_TX,
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  pTxCharacteristic->addDescriptor(new BLE2902());

  // 5. Crear característica RX (App -> ESP32)
  BLECharacteristic *pRxCharacteristic = pService->createCharacteristic(
                                         CHARACTERISTIC_UUID_RX,
                                         BLECharacteristic::PROPERTY_WRITE
                                       );
  pRxCharacteristic->setCallbacks(new MyCharacteristicCallbacks());

  // 6. Iniciar el servicio y el advertising
  pService->start();
  pServer->getAdvertising()->start();
  
  Serial.println("Servidor BLE iniciado y esperando conexiones.");
}

void loop() {
  // El loop puede estar vacío ya que todo se maneja por callbacks.
  // Se podría añadir lógica para modo de bajo consumo si es necesario.
  delay(2000);
}

// --- Funciones Auxiliares ---

/**
 * @brief Envía un objeto JSON como respuesta a través de BLE.
 * @param response El objeto JSON a enviar.
 */
void sendBleResponse(const JsonObject& response) {
  if (deviceConnected) {
    String responseString;
    serializeJson(response, responseString);
    responseString += "\n"; // Añadir newline como delimitador

    pTxCharacteristic->setValue(responseString.c_str());
    pTxCharacteristic->notify();
    Serial.print("Respuesta enviada: ");
    Serial.println(responseString.trim());
  } else {
    Serial.println("No se puede enviar respuesta, dispositivo desconectado.");
  }
}

/**
 * @brief Intenta conectar al WiFi y envía una respuesta a la app.
 * @param ssid El SSID de la red.
 * @param password La contraseña de la red.
 */
void connectToWifi(const char* ssid, const char* password) {
  Serial.print("Intentando conectar a la red: ");
  Serial.println(ssid);

  StaticJsonDocument<200> responseDoc;
  JsonObject response = responseDoc.to<JsonObject>();
  response["type"] = "wifi_config_response";

  // Enviar mensaje de que se está intentando conectar
  response["status"] = "info";
  response["message"] = "Attempting to connect to " + String(ssid) + "...";
  sendBleResponse(response);

  // Desconectar de cualquier red anterior
  WiFi.disconnect();
  delay(100);

  // Iniciar conexión
  WiFi.begin(ssid, password);

  int attempt = 0;
  // Esperar hasta 15 segundos para la conexión
  while (WiFi.status() != WL_CONNECTED && attempt < 30) {
    delay(500);
    Serial.print(".");
    attempt++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nConexión WiFi exitosa!");
    Serial.print("Dirección IP: ");
    Serial.println(WiFi.localIP());
    
    response["status"] = "success";
    response["message"] = "Successfully connected to " + String(ssid);
    sendBleResponse(response);
  } else {
    Serial.println("\nFalló la conexión WiFi.");
    WiFi.disconnect(); // Asegurarse de que no siga intentando

    response["status"] = "error";
    response["message"] = "Failed to connect to " + String(ssid) + ". Check credentials.";
    sendBleResponse(response);
  }
}
