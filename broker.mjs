import aedes from 'aedes';
import { createServer } from 'net';
import http from 'http';
import websocketStream from 'websocket-stream';

const port = 1883;
const wsPort = 8888;

const aedesInstance = aedes();
const server = createServer(aedesInstance.handle);
const httpServer = http.createServer();

websocketStream.createServer({ server: httpServer }, aedesInstance.handle);

server.listen(port, function () {
  console.log('Aedes MQTT server listening on port', port);
});

httpServer.listen(wsPort, function () {
  console.log('Aedes MQTT-WS server listening on port', wsPort);
});
