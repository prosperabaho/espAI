/**
 * ESP32 Bluetooth Service
 * Handles Web Bluetooth connection and communication with ESP32.
 * Assumes a standard Nordic UART Service (NUS) or similar for simple text communication.
 */

const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // RX on ESP32
const UART_RX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // TX on ESP32

export class ESP32BluetoothService {
  device = null;
  server = null;
  txCharacteristic = null;
  rxCharacteristic = null;

  async connect() {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'ESP32' }, { services: [UART_SERVICE_UUID] }],
        optionalServices: [UART_SERVICE_UUID]
      });

      this.server = await this.device.gatt.connect();
      const service = await this.server.getPrimaryService(UART_SERVICE_UUID);
      
      this.txCharacteristic = await service.getCharacteristic(UART_TX_CHARACTERISTIC_UUID);
      this.rxCharacteristic = await service.getCharacteristic(UART_RX_CHARACTERISTIC_UUID);

      await this.rxCharacteristic.startNotifications();
      this.rxCharacteristic.addEventListener('characteristicvaluechanged', this.handleNotifications.bind(this));

      return this.device.name || 'ESP32 Device';
    } catch (error) {
      if (error.name !== 'NotFoundError' && !error.message.includes('User cancelled')) {
        console.error('Bluetooth Connection Error:', error);
      }
      throw error;
    }
  }

  handleNotifications(event) {
    const value = event.target.value;
    const decoder = new TextDecoder();
    const message = decoder.decode(value).trim();
    console.log('Received from ESP32:', message);
    
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
  }

  onMessageReceived = null;
  onSensorData = null;

  async sendCommand(command) {
    if (!this.txCharacteristic) throw new Error('Not connected');
    const encoder = new TextEncoder();
    const data = encoder.encode(command + '\n');
    await this.txCharacteristic.writeValue(data);
  }

  disconnect() {
    if (this.device && this.device.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.server = null;
    this.txCharacteristic = null;
    this.rxCharacteristic = null;
  }

  isConnected() {
    return !!(this.device && this.device.gatt?.connected);
  }
}

export const bluetoothService = new ESP32BluetoothService();
