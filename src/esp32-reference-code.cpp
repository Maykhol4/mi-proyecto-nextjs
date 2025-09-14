/**
 * @file esp32-reference-code.cpp
 * @author Gemini
 * @brief Variables principales de configuración BLE para un ESP32 en C++ (Framework Arduino) 
 *        compatible con la app AQUADATA 2.0.
 * 
 * Este archivo contiene las definiciones esenciales que tu dispositivo ESP32
 * necesita para ser reconocido y para comunicarse con la aplicación móvil.
 */

// --- Nombre del Dispositivo BLE ---
// Este es el nombre que aparecerá en la aplicación cuando busques dispositivos.
#define BLE_DEVICE_NAME "AQUADATA-2.0"

// --- Definiciones de UUIDs (Deben coincidir con la app) ---
// Estos identificadores únicos universales definen el "contrato" de comunicación
// entre la app y el ESP32. Deben ser exactamente los mismos en ambos lados.

// 1. UUID del Servicio Principal (UART Service)
//    Define el servicio general de comunicación.
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"

// 2. UUID de la Característica de Recepción (App -> ESP32)
//    La aplicación escribe (write) en esta característica para enviar comandos al ESP32.
//    Desde la perspectiva del ESP32, es "RX" (recepción).
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"

// 3. UUID de la Característica de Transmisión (ESP32 -> App)
//    El ESP32 envía notificaciones (notify) a través de esta característica para mandar respuestas a la app.
//    Desde la perspectiva del ESP32, es "TX" (transmisión).
#define CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
