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
  description: "Update the system's hardware manifest with new instructions or device definitions. Use this when the user describes new hardware they've added.",
  parameters: {
    type: "OBJECT",
    properties: {
      newManifest: {
        type: "STRING",
        description: "The complete updated hardware manifest text, including all existing and new devices/instructions."
      }
    },
    required: ["newManifest"]
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
        
        CRITICAL: You are provided with the latest sensor readings in every prompt. 
        Use this data to answer questions like "What's the status?" or "Is it too hot?".
        
        Available hardware actions via 'controlHardware':
        - LED_ON: Turn on the onboard LED.
        - LED_OFF: Turn off the onboard LED.
        - GET_TEMP: Request a fresh temperature reading from the hardware.
        - SERVO_MOVE: Move a servo motor (requires 'value' between 0-180).
        - CUSTOM: Any other custom command.
        
        [HARDWARE MANIFEST & CUSTOM INSTRUCTIONS]:
        ${hardwareManifest || "No custom hardware defined yet."}
        
        [SELF-CONFIGURATION]:
        If the user describes new hardware or changes to their setup, use the 'updateHardwareManifest' tool to rewrite the manifest instructions. 
        Always preserve existing working instructions unless the user asks to change them.
        
        If you notice unusual sensor readings (e.g., very high temperature), mention it to the user.
        Be concise, professional, and helpful. Confirm all actions.`,
        tools: [{ functionDeclarations: [controlHardware, updateHardwareManifest] }]
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
