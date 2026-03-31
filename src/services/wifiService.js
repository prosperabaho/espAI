/**
 * ESP32 WiFi Service
 * Handles WebSocket connection and communication with the relay server.
 */

export class ESP32WiFiService {
  socket = null;
  onMessageReceived = null;
  onSensorData = null;
  onConnectionChange = null;

  connect() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const url = `${protocol}//${host}?type=client`;

      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        console.log('Connected to WiFi relay server');
        if (this.onConnectionChange) this.onConnectionChange(true);
        resolve('WiFi Relay');
      };

      this.socket.onmessage = (event) => {
        const message = event.data.trim();
        console.log('Received from ESP8266 (via relay):', message);

        // Parse sensor data if it follows "KEY:VALUE" format
        if (message.includes(':')) {
          const [key, val] = message.split(':');
          if (this.onSensorData) {
            this.onSensorData(key, parseFloat(val));
          }
        }

        if (this.onMessageReceived) {
          this.onMessageReceived(message);
        }
      };

      this.socket.onclose = () => {
        console.log('Disconnected from WiFi relay server');
        if (this.onConnectionChange) this.onConnectionChange(false);
      };

      this.socket.onerror = (error) => {
        console.error('WebSocket Error:', error);
        reject(error);
      };
    });
  }

  async sendCommand(command) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }
    this.socket.send(command);
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  isConnected() {
    return !!(this.socket && this.socket.readyState === WebSocket.OPEN);
  }
}

export const wifiService = new ESP32WiFiService();
