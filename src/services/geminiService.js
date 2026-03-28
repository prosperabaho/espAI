import { GoogleGenAI, Modality } from "@google/genai";

const controlHardware = {
  name: "controlHardware",
  description: "Send a command to the ESP32 hardware to perform an action.",
  parameters: {
    type: "OBJECT",
    properties: {
      action: {
        type: "STRING",
        description: "The action to perform, e.g., 'LED_ON', 'LED_OFF', 'GET_TEMP', 'SERVO_MOVE'."
      },
      value: {
        type: "NUMBER",
        description: "An optional numeric value for the action (e.g., servo angle or brightness)."
      }
    },
    required: ["action"]
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
        systemInstruction: `You are an expert Hardware Interface Agent for an ESP32 device. 
        Your goal is to help the user control their hardware and proactively report on sensor data. 
        
        [CAPABILITIES & HELP]:
        If the user asks for help or what you can do, explain that you can:
        1. Control connected hardware (LEDs, Servos, Relays, etc.) via voice or text.
        2. Monitor real-time sensor data (Temperature, Humidity, etc.).
        3. Self-configure your own hardware manifest when new devices are added.
        4. Provide dynamic system status updates based on telemetry.
        
        [HARDWARE CONTROL]:
        Available hardware actions via 'controlHardware':
        - LED_ON, LED_OFF, GET_TEMP, SERVO_MOVE, etc.
        
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
