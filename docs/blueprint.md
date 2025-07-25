# **App Name**: AquaView

## Core Features:

- Data Display: Display real-time sensor data received from the ESP32, including pH, dissolved oxygen concentration, dissolved oxygen saturation, and temperature.
- UI Dashboard: Provide a clear and intuitive user interface for visualizing sensor data, with options for displaying current values and historical trends.
- Status Indicator: Indicate data status and data quality through the usage of simple traffic-light indicators.
- BLE Communication: Implement Bluetooth Low Energy (BLE) communication to receive sensor data from the ESP32 device.
- Timestamp Display: Display the timestamp of each data reading.
- Anomaly Detection: Employ an AI-powered anomaly detection tool to identify unusual patterns or readings based on incoming data, providing alerts when potential issues are detected.
- Configuration settings: Allow users to configure the BLE device name ('AQUADATA-2.0') within the app settings, storing locally and presenting a connection prompt

## Style Guidelines:

- Primary color: Soft blue (#7FB7BE) to evoke a sense of tranquility and cleanliness associated with water.
- Background color: Light gray (#F0F0F0) to provide a clean and neutral backdrop that allows the data to stand out.
- Accent color: Teal (#2A9D8F) to highlight important data points and interactive elements, complementing the primary blue.
- Body and headline font: 'Inter', a grotesque-style sans-serif for a modern, machined, objective, neutral look; suitable for both headlines and body text.
- Use minimalist, line-style icons to represent different sensor types and data parameters.
- Implement a clean, card-based layout to organize sensor data and status indicators efficiently.
- Use subtle transitions and animations to provide feedback and enhance the user experience when receiving new data or interacting with the app.