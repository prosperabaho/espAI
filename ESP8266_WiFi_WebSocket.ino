/*
  ESP8266 Generic Pin Controller for Hardware Agent
  
  This code does NOT have hardcoded pin assignments.
  The AI Agent sends commands in the format: "PIN:MODE:ACTION:VALUE"
  - PIN: GPIO number
  - MODE: "OUTPUT", "INPUT", "INPUT_PULLUP", or "X" (skip)
  - ACTION: "DIGITAL_WRITE", "ANALOG_WRITE", or "X" (skip)
  - VALUE: 0/1 for digital, 0-1023 for analog, or "X" (skip)
  
  Dependencies:
  - WebSockets by Markus Sattler
*/

#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>

// --- CONFIGURATION ---
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* ws_host = "ais-dev-culwd7zbkbc7rbgsfpyh7h-64587678281.europe-west2.run.app";
const int ws_port = 443;
const char* ws_path = "/?type=hardware";

WebSocketsClient webSocket;

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("[WSc] Disconnected!");
      break;
    case WStype_CONNECTED:
      Serial.println("[WSc] Connected!");
      break;
    case WStype_TEXT:
      Serial.printf("[WSc] Command: %s\n", payload);
      handleGenericCommand((char*)payload);
      break;
  }
}

void handleGenericCommand(String cmd) {
  // Protocol: "PIN:MODE:ACTION:VALUE"
  // Example: "5:OUTPUT:DIGITAL_WRITE:1"
  
  int firstColon = cmd.indexOf(':');
  int secondColon = cmd.indexOf(':', firstColon + 1);
  int thirdColon = cmd.indexOf(':', secondColon + 1);
  
  if (firstColon == -1 || secondColon == -1 || thirdColon == -1) {
    Serial.println("Invalid command format");
    return;
  }
  
  String pinStr = cmd.substring(0, firstColon);
  String modeStr = cmd.substring(firstColon + 1, secondColon);
  String actionStr = cmd.substring(secondColon + 1, thirdColon);
  String valueStr = cmd.substring(thirdColon + 1);
  
  int pin = pinStr.toInt();
  
  // 1. Handle Mode
  if (modeStr != "X") {
    if (modeStr == "OUTPUT") pinMode(pin, OUTPUT);
    else if (modeStr == "INPUT") pinMode(pin, INPUT);
    else if (modeStr == "INPUT_PULLUP") pinMode(pin, INPUT_PULLUP);
    Serial.printf("Pin %d set to %s\n", pin, modeStr.c_str());
  }
  
  // 2. Handle Action
  if (actionStr != "X") {
    int val = valueStr.toInt();
    if (actionStr == "DIGITAL_WRITE") {
      digitalWrite(pin, val);
      Serial.printf("Pin %d DIGITAL_WRITE: %d\n", pin, val);
    } else if (actionStr == "ANALOG_WRITE") {
      analogWrite(pin, val);
      Serial.printf("Pin %d ANALOG_WRITE: %d\n", pin, val);
    }
    
    // Feedback to UI
    String feedback = "LOG:Pin " + String(pin) + " " + actionStr + " set to " + String(val);
    webSocket.sendTXT(feedback);
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected");

  webSocket.beginSSL(ws_host, ws_port, ws_path);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

void loop() {
  webSocket.loop();
  
  // Optional: Add sensor logic here if needed
  // For now, it's a pure controller
}
