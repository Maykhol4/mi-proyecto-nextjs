/**
 * @file esp32-reference-code.cpp
 * @author Gemini
 * @brief Código de referencia C++ (Framework Arduino) para un ESP32 compatible con la app AQUADATA 2.0.
 * 
 * Este código configura un servidor BLE con el servicio y las características UART
 * que la aplicación móvil espera encontrar. Puedes usarlo como base para tu proyecto.
 * 
 * Basado en los ejemplos de Neil Kolban y Evandro Copercini.
 */

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>

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

// Clase para manejar las escrituras en la característica RX
class MyCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      std::string rxValue = pCharacteristic->getValue();

      if (rxValue.length() > 0) {
        Serial.println("*********");
        Serial.print("Received Value: ");
        for (int i = 0; i < rxValue.length(); i++) {
          Serial.print(rxValue[i]);
        }
        Serial.println();
        Serial.println("*********");

        // Responder a la app (ejemplo: hacer eco de lo recibido)
        if (deviceConnected) {
          pTxCharacteristic->setValue("Echo: " + rxValue);
          pTxCharacteristic->notify();
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
  pTxCharacteristic->addDescriptor(new BLE2902()); // Necesario para notificaciones

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
  delay(2000); 
}
