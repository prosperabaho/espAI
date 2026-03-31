import { GoogleGenAI, Modality } from "@google/genai";

const controlHardware = {
  name: "controlHardware",
  description: "Send a generic pin command to the ESP8266 hardware.",
  parameters: {
    type: "OBJECT",
    properties: {
      pin: {
        type: "NUMBER",
        description: "The GPIO pin number to control (e.g., 5 for D1, 4 for D2 on NodeMCU)."
      },
      mode: {
        type: "STRING",
        enum: ["OUTPUT", "INPUT", "INPUT_PULLUP"],
        description: "The mode to set for the pin (required before writing)."
      },
      action: {
        type: "STRING",
        enum: ["DIGITAL_WRITE", "ANALOG_WRITE"],
        description: "The type of write operation to perform."
      },
      value: {
        type: "NUMBER",
        description: "The value to write (0/1 for DIGITAL, 0-1023 for ANALOG)."
      }
    },
    required: ["pin"]
  }
};

const updateHardwareManifest = {
  name: "updateHardwareManifest",
  description: "Update the system's hardware manifest with new instructions or device definitions.",
  parameters: {
    type: "OBJECT",
    properties: {
      newManifest: {
        type: "STRING",
        description: "The complete updated hardware manifest text."
      }
    },
    required: ["newManifest"]
  }
};

const updateSystemStatus = {
  name: "updateSystemStatus",
  description: "Post a dynamic status update to the system dashboard based on sensor data or actions taken.",
  parameters: {
    type: "OBJECT",
    properties: {
      status: {
        type: "STRING",
        description: "A short, professional status message (e.g., 'System cooling active', 'Motion detected')."
      },
      severity: {
        type: "STRING",
        enum: ["info", "warning", "critical"],
        description: "The severity level of the status update."
      }
    },
    required: ["status", "severity"]
  }
};

export class GeminiAgentService {
  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async processCommand(prompt, history = [], hardwareManifest = "") {
    const response = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        ...history,
        { role: 'user', parts: [{ text: prompt }] }
      ],
      config: {
        systemInstruction: `You are an expert Hardware Interface Agent for an ESP8266 device. 
        Your goal is to help the user control their hardware and proactively report on sensor data. 
        
        [CONVERSATION STYLE]:
        - Be concise, professional, yet warm and conversational. 
        - Use Markdown formatting for clarity: use **bold** for emphasis, lists for multiple items, and code blocks for technical details.
        - If the user interrupts you, acknowledge it gracefully in the next turn.
        - Proactively mention relevant sensor data if it seems important (e.g., "It's getting a bit warm in here, current temp is 32°C. Should I turn on the fan?").
        
        [CAPABILITIES & HELP]:
        If the user asks for help or what you can do, explain that you can:
        1. Control connected hardware (LEDs, Servos, Relays, etc.) via voice or text.
        2. Monitor real-time sensor data (Temperature, Humidity, etc.).
        3. Self-configure your own hardware manifest when new devices are added.
        4. Provide dynamic system status updates based on telemetry.
        
        [HARDWARE CONTROL]:
        You have direct access to the ESP8266 GPIO pins via 'controlHardware'. 
        - Always set the 'mode' to 'OUTPUT' before performing a write for the first time in a session.
        - For DIGITAL_WRITE, use value 1 for HIGH/ON and 0 for LOW/OFF.
        - For ANALOG_WRITE (PWM), use values 0-1023.
        
        If the user says "I connected a light to D1", you should know that D1 is GPIO 5 on NodeMCU. 
        Map common NodeMCU labels to GPIOs: D0=16, D1=5, D2=4, D3=0, D4=2, D5=14, D6=12, D7=13, D8=15.
        
        [CONNECTION STATE]:
        - If you are not connected to the ESP8266 board, you can still process requests and explain what you WOULD do. 
        - Inform the user politely if a hardware action cannot be physically executed due to lack of connection, but still confirm the logic.
        
        [HARDWARE MANIFEST & CUSTOM INSTRUCTIONS]:
        ${hardwareManifest || "No custom hardware defined yet."}
        
        [DYNAMIC STATUS]:
        Use 'updateSystemStatus' to post important updates to the dashboard. 
        Example: If temp > 30, post a warning: "Thermal threshold exceeded".
        
        [SELF-CONFIGURATION]:
        If the user describes new hardware, use 'updateHardwareManifest' to rewrite the manifest.
        
        Be concise, professional, and helpful. Confirm all actions.`,
        tools: [{ functionDeclarations: [controlHardware, updateHardwareManifest, updateSystemStatus] }]
      }
    });

    return response;
  }

  async generateSpeech(text) {
    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      return base64Audio || null;
    } catch (error) {
      console.error('TTS Error:', error);
      return null;
    }
  }
}

export const geminiAgent = new GeminiAgentService();
