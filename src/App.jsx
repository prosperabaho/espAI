import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Bluetooth, 
  BluetoothOff, 
  Cpu, 
  Send, 
  Terminal, 
  Activity, 
  Zap, 
  Thermometer, 
  MessageSquare,
  Settings,
  Power,
  RefreshCw,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  TrendingUp
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { bluetoothService } from './services/bluetoothService';
import { geminiAgent } from './services/geminiService';
import { cn } from './lib/utils';

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [deviceName, setDeviceName] = useState(null);
  const [messages, setMessages] = useState([
    { role: 'model', content: "Hello! I'm your ESP32 Hardware Agent. I can now listen to your voice and show you real-time sensor data. Connect your device to begin." }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [hardwareLogs, setHardwareLogs] = useState([]);
  const [sensorData, setSensorData] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [currentTemp, setCurrentTemp] = useState(null);
  const [currentHum, setCurrentHum] = useState(null);
  const [hardwareManifest, setHardwareManifest] = useState(() => {
    return localStorage.getItem('hardwareManifest') || 
      "1. Relay 1: Controls the desk lamp (Action: RELAY_1:ON/OFF)\n2. Servo 1: Controls the window blind (Action: SERVO_1:0-180)\n3. NeoPixel: RGB strip for mood lighting (Action: RGB:R,G,B)";
  });
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    bluetoothService.onMessageReceived = (msg) => {
      setHardwareLogs(prev => [msg, ...prev].slice(0, 50));
    };

    bluetoothService.onSensorData = (key, value) => {
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      if (key === 'TEMP') {
        setCurrentTemp(value);
        setSensorData(prev => [...prev.slice(-19), { time: now, temp: value, hum: currentHum || 0 }]);
      } else if (key === 'HUM') {
        setCurrentHum(value);
        setSensorData(prev => [...prev.slice(-19), { time: now, temp: currentTemp || 0, hum: value }]);
      }
    };

    // Initialize Speech Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsListening(false);
        // Automatically send voice command
        handleSendMessage(transcript);
      };

      recognitionRef.current.onend = () => setIsListening(false);
      recognitionRef.current.onerror = () => setIsListening(false);
    }
  }, [currentTemp, currentHum]);

  const handleConnect = async () => {
    try {
      const name = await bluetoothService.connect();
      setDeviceName(name);
      setIsConnected(true);
      setMessages(prev => [...prev, { role: 'system', content: `Connected to ${name}` }]);
      if (navigator.vibrate) navigator.vibrate(100);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'system', content: 'Connection failed. Ensure Bluetooth is enabled.' }]);
    }
  };

  const handleDisconnect = () => {
    bluetoothService.disconnect();
    setIsConnected(false);
    setDeviceName(null);
    setMessages(prev => [...prev, { role: 'system', content: 'Disconnected from device.' }]);
    if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
  };

  const [isContinuousMode, setIsContinuousMode] = useState(false);
  const audioRef = useRef(null);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      // Stop any current audio if starting to listen
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setInput('');
      recognitionRef.current?.start();
      setIsListening(true);
      if (navigator.vibrate) navigator.vibrate(50);
    }
  };

  const playVoiceResponse = async (text) => {
    if (!isVoiceEnabled) return;
    
    const base64 = await geminiAgent.generateSpeech(text);
    if (base64) {
      return new Promise((resolve) => {
        const audio = new Audio(`data:audio/wav;base64,${base64}`);
        audioRef.current = audio;
        audio.onended = () => {
          audioRef.current = null;
          resolve();
        };
        audio.onerror = () => {
          audioRef.current = null;
          resolve();
        };
        audio.play().catch(e => {
          console.error("Audio play failed:", e);
          resolve();
        });
      });
    }
  };

  const handleSendMessage = async (textOverride) => {
    const userMsg = textOverride || input.trim();
    if (!userMsg || isProcessing) return;

    if (!textOverride) setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsProcessing(true);

    try {
      const history = messages.map(m => ({
        role: m.role === 'system' ? 'model' : m.role,
        parts: [{ text: m.content }]
      }));

      const sensorContext = `[Current Sensor Context: Temp=${currentTemp ?? 'N/A'}°C, Humidity=${currentHum ?? 'N/A'}%]`;
      const fullPrompt = `${sensorContext}\nUser: ${userMsg}`;

      const response = await geminiAgent.processCommand(fullPrompt, history, hardwareManifest);
      
      if (response.functionCalls) {
        for (const call of response.functionCalls) {
          if (call.name === 'controlHardware') {
            const { action, value } = call.args;
            const cmdString = value !== undefined ? `${action}:${value}` : action;
            
            if (isConnected) {
              await bluetoothService.sendCommand(cmdString);
              setHardwareLogs(prev => [`TX: ${cmdString}`, ...prev]);
              if (navigator.vibrate) navigator.vibrate(50);
            } else {
              setHardwareLogs(prev => [`[TEST MODE] Would send: ${cmdString}`, ...prev]);
              setMessages(prev => [...prev, { role: 'system', content: `Test Mode: Command "${cmdString}" simulated.` }]);
            }
          } else if (call.name === 'updateHardwareManifest') {
            const { newManifest } = call.args;
            setHardwareManifest(newManifest);
            localStorage.setItem('hardwareManifest', newManifest);
            setMessages(prev => [...prev, { role: 'system', content: "Hardware Manifest Updated by Agent." }]);
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
          }
        }
      }

      const agentText = response.text || "Command executed.";
      setMessages(prev => [...prev, { role: 'model', content: agentText }]);
      
      // Play voice and wait for it to finish if in continuous mode
      await playVoiceResponse(agentText);
      
      if (isContinuousMode && isConnected) {
        toggleListening();
      }
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', content: "Sorry, I encountered an error processing that." }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  const handleUnlock = (e) => {
    e.preventDefault();
    if (passwordInput.toLowerCase() === 'esp') {
      setIsUnlocked(true);
      if (navigator.vibrate) navigator.vibrate(100);
    } else {
      setPasswordError(true);
      setTimeout(() => setPasswordError(false), 1000);
    }
  };

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#18181B] border border-[#27272A] rounded-2xl p-8 shadow-2xl"
        >
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-orange-500/10 rounded-full">
              <Cpu className="w-12 h-12 text-orange-500" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center mb-2">Access Restricted</h1>
          <p className="text-[#A1A1AA] text-center mb-8 italic">
            "What is the 3-letter acronym for the Extra Sensory Perception sensor used in this prototype?"
          </p>
          <form onSubmit={handleUnlock} className="space-y-4">
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Enter code..."
              className={cn(
                "w-full bg-[#09090B] border border-[#27272A] rounded-xl px-4 py-3 outline-none transition-all focus:border-orange-500/50",
                passwordError && "border-red-500/50 animate-shake"
              )}
            />
            <button
              type="submit"
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition-colors shadow-lg shadow-orange-500/20"
            >
              Unlock Interface
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-[#E4E4E7] font-sans selection:bg-orange-500/30">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
              <Cpu className="w-6 h-6 text-orange-500" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">ESP32 AGENT PRO</h1>
              <div className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full animate-pulse", isConnected ? "bg-green-500" : "bg-red-500")} />
                <span className="text-[10px] uppercase tracking-widest font-bold opacity-50">
                  {isConnected ? `Connected: ${deviceName}` : 'Offline'}
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsConfigOpen(true)}
              className="p-2 rounded-lg border border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-all"
              title="Hardware Configuration"
            >
              <Settings size={18} />
            </button>
            <button
              onClick={() => setIsContinuousMode(!isContinuousMode)}
              title="Continuous Conversation Mode"
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-[10px] font-bold uppercase tracking-widest",
                isContinuousMode ? "bg-orange-500/20 border-orange-500/40 text-orange-500" : "bg-white/5 border-white/10 text-white/40"
              )}
            >
              <RefreshCw size={14} className={isContinuousMode ? "animate-spin-slow" : ""} />
              {isContinuousMode ? "Hands-Free On" : "Hands-Free Off"}
            </button>
            <button
              onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
              className={cn(
                "p-2 rounded-lg border transition-all",
                isVoiceEnabled ? "bg-white/5 border-white/10 text-white" : "bg-red-500/10 border-red-500/20 text-red-500"
              )}
            >
              {isVoiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button
              onClick={isConnected ? handleDisconnect : handleConnect}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all",
                isConnected 
                  ? "bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 hover:text-white" 
                  : "bg-orange-500 text-black hover:bg-orange-400"
              )}
            >
              {isConnected ? <BluetoothOff size={16} /> : <Bluetooth size={16} />}
              {isConnected ? 'Disconnect' : 'Connect ESP32'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-80px)]">
        {/* Left Column: Chat Interface */}
        <div className="lg:col-span-7 flex flex-col bg-[#121214] rounded-2xl border border-white/5 overflow-hidden shadow-2xl">
          <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
            <div className="flex items-center gap-2">
              <MessageSquare size={18} className="text-orange-500" />
              <span className="font-bold text-sm uppercase tracking-widest opacity-70">Agent Console</span>
            </div>
            {isProcessing && (
              <div className="flex items-center gap-2 text-xs text-orange-500 italic">
                <RefreshCw size={12} className="animate-spin" />
                Thinking...
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
            <AnimatePresence initial={false}>
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed",
                    msg.role === 'user' 
                      ? "ml-auto bg-orange-500 text-black font-medium" 
                      : msg.role === 'system'
                      ? "mx-auto bg-white/5 text-white/40 text-[10px] uppercase tracking-widest font-bold py-1 px-4 rounded-full border border-white/5"
                      : "bg-white/5 text-white/90 border border-white/10"
                  )}
                >
                  {msg.content}
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={chatEndRef} />
          </div>

          <div className="p-4 bg-black/20 border-t border-white/5 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder={isConnected ? "Ask the agent to control hardware..." : "Connect ESP32 to start..."}
                  disabled={!isConnected || isProcessing}
                  className="w-full bg-[#1A1A1C] border border-white/10 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-orange-500/50 transition-colors disabled:opacity-50"
                />
                <button
                  onClick={() => handleSendMessage()}
                  disabled={!isConnected || !input.trim() || isProcessing}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-orange-500 text-black rounded-lg hover:bg-orange-400 disabled:opacity-50 transition-all"
                >
                  <Send size={18} />
                </button>
              </div>
              <button
                onClick={toggleListening}
                disabled={!isConnected || isProcessing}
                className={cn(
                  "p-3 rounded-xl border transition-all flex items-center justify-center",
                  isListening 
                    ? "bg-red-500 text-white border-red-400 animate-pulse" 
                    : "bg-white/5 border-white/10 text-white hover:bg-white/10"
                )}
              >
                {isListening ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Hardware Status & Charts */}
        <div className="lg:col-span-5 flex flex-col gap-6 overflow-hidden">
          {/* Real-time Charts */}
          <div className="bg-[#121214] rounded-2xl border border-white/5 flex flex-col overflow-hidden h-64 shadow-xl">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
              <div className="flex items-center gap-2">
                <TrendingUp size={18} className="text-orange-500" />
                <span className="font-bold text-sm uppercase tracking-widest opacity-70">Sensor Trends</span>
              </div>
            </div>
            <div className="flex-1 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sensorData}>
                  <defs>
                    <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                  <XAxis dataKey="time" hide />
                  <YAxis hide domain={[0, 100]} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1A1A1C', border: '1px solid #ffffff10', borderRadius: '8px' }}
                    itemStyle={{ fontSize: '12px' }}
                  />
                  <Area type="monotone" dataKey="temp" stroke="#f97316" fillOpacity={1} fill="url(#colorTemp)" />
                  <Area type="monotone" dataKey="hum" stroke="#3b82f6" fillOpacity={0} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Status Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#121214] p-4 rounded-2xl border border-white/5 shadow-lg">
              <div className="flex items-center gap-2 mb-2 opacity-50">
                <Thermometer size={14} />
                <span className="text-[10px] uppercase font-bold tracking-widest">Temperature</span>
              </div>
              <div className="text-3xl font-mono font-bold text-orange-500">
                {currentTemp !== null ? `${currentTemp}°C` : '--'}
              </div>
              <div className="text-[10px] opacity-40 mt-1 uppercase tracking-tighter">Real-time Feed</div>
            </div>
            <div className="bg-[#121214] p-4 rounded-2xl border border-white/5 shadow-lg">
              <div className="flex items-center gap-2 mb-2 opacity-50">
                <Activity size={14} />
                <span className="text-[10px] uppercase font-bold tracking-widest">Humidity</span>
              </div>
              <div className="text-3xl font-mono font-bold text-blue-500">
                {currentHum !== null ? `${currentHum}%` : '--'}
              </div>
              <div className="text-[10px] opacity-40 mt-1 uppercase tracking-tighter">Ambient Level</div>
            </div>
          </div>

          {/* Hardware Logs */}
          <div className="flex-1 bg-[#121214] rounded-2xl border border-white/5 flex flex-col overflow-hidden shadow-xl">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
              <div className="flex items-center gap-2">
                <Terminal size={18} className="text-orange-500" />
                <span className="font-bold text-sm uppercase tracking-widest opacity-70">Hardware Logs</span>
              </div>
              <button 
                onClick={() => setHardwareLogs([])}
                className="text-[10px] uppercase font-bold tracking-widest opacity-40 hover:opacity-100 transition-opacity"
              >
                Clear
              </button>
            </div>
            <div className="flex-1 p-4 font-mono text-[11px] space-y-1 overflow-y-auto scrollbar-hide">
              {hardwareLogs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-white/10 italic">
                  Waiting for data...
                </div>
              ) : (
                hardwareLogs.map((log, i) => (
                  <div key={i} className={cn(
                    "py-1 border-b border-white/5",
                    log.startsWith('TX:') ? "text-orange-500/70" : "text-green-500/70"
                  )}>
                    <span className="opacity-30 mr-2">[{new Date().toLocaleTimeString()}]</span>
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick Controls */}
          <div className="bg-[#121214] p-4 rounded-2xl border border-white/5 shadow-xl">
            <div className="flex items-center gap-2 mb-4 opacity-50">
              <Settings size={14} />
              <span className="text-[10px] uppercase font-bold tracking-widest">Quick Actions</span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button 
                  onClick={() => bluetoothService.sendCommand('LED_ON')}
                  disabled={!isConnected}
                  className="flex-1 py-2 bg-white/5 border border-white/10 rounded-lg text-[10px] uppercase font-bold tracking-widest hover:bg-white/10 disabled:opacity-30 transition-all"
                >
                  LED ON
                </button>
                <button 
                  onClick={() => bluetoothService.sendCommand('LED_OFF')}
                  disabled={!isConnected}
                  className="flex-1 py-2 bg-white/5 border border-white/10 rounded-lg text-[10px] uppercase font-bold tracking-widest hover:bg-white/10 disabled:opacity-30 transition-all"
                >
                  LED OFF
                </button>
              </div>
              <button 
                onClick={() => handleSendMessage("Give me a full status report on the sensors and hardware.")}
                disabled={!isConnected || isProcessing}
                className="w-full py-2 bg-orange-500/10 border border-orange-500/20 rounded-lg text-[10px] uppercase font-bold tracking-widest hover:bg-orange-500/20 disabled:opacity-30 transition-all text-orange-500"
              >
                REPORT STATUS
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer / Instructions */}
      <footer className="max-w-6xl mx-auto p-4 text-center">
        <p className="text-[10px] text-white/20 uppercase tracking-[0.2em] font-medium">
          Web Bluetooth • Voice Recognition • Gemini AI Agent • Real-time Telemetry
        </p>
      </footer>

      {/* Hardware Configuration Modal */}
      <AnimatePresence>
        {isConfigOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl bg-[#18181B] border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-500/10 rounded-lg">
                    <Settings className="w-5 h-5 text-orange-500" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">Hardware Manifest</h2>
                    <p className="text-xs text-white/40 uppercase tracking-widest">Define your custom devices & commands</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsConfigOpen(false)}
                  className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-5 h-5 opacity-40 rotate-45" />
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold tracking-[0.2em] text-orange-500/70">
                    System Instructions for the AI Agent
                  </label>
                  <p className="text-xs text-white/40 leading-relaxed">
                    Describe your hardware setup here. The AI will use these instructions to understand what devices are connected and what commands to send via the <code className="text-orange-500/80 bg-orange-500/5 px-1 rounded">controlHardware</code> function.
                  </p>
                  <textarea
                    value={hardwareManifest}
                    onChange={(e) => {
                      setHardwareManifest(e.target.value);
                      localStorage.setItem('hardwareManifest', e.target.value);
                    }}
                    placeholder="e.g. 1. Relay 1: Controls the desk lamp (Action: RELAY_1:ON/OFF)..."
                    className="w-full h-64 bg-[#09090B] border border-white/10 rounded-xl p-4 text-sm font-mono focus:outline-none focus:border-orange-500/50 transition-all resize-none"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleSendMessage("Please review my current hardware manifest and optimize the instructions for better control. If it's empty, suggest a standard starter setup.")}
                      className="text-[10px] uppercase font-bold tracking-widest text-orange-500 hover:text-orange-400 transition-colors flex items-center gap-2"
                    >
                      <Zap size={12} />
                      Optimize with AI
                    </button>
                  </div>
                </div>
                
                <div className="bg-orange-500/5 border border-orange-500/10 rounded-xl p-4 flex gap-4 items-start">
                  <Activity className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-orange-500/80 leading-relaxed">
                    <strong>Pro Tip:</strong> Be specific about the command strings your ESP32 expects. For example, if you use <code className="bg-orange-500/10 px-1 rounded">SERVO:90</code>, tell the agent exactly that.
                  </div>
                </div>
              </div>

              <div className="p-6 bg-white/5 border-t border-white/5 flex justify-end">
                <button
                  onClick={() => setIsConfigOpen(false)}
                  className="px-8 py-3 bg-orange-500 hover:bg-orange-600 text-black font-bold rounded-xl transition-all shadow-lg shadow-orange-500/20"
                >
                  Save Configuration
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
