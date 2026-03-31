import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { 
  Wifi, 
  WifiOff, 
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
  TrendingUp,
  Square
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
import { wifiService } from './services/wifiService';
import { geminiAgent } from './services/geminiService';
import { cn } from './lib/utils';

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [deviceName, setDeviceName] = useState(null);
  const [messages, setMessages] = useState([
    { role: 'model', content: "Hello! I'm your ESP8266 Hardware Agent. I can now listen to your voice and show you real-time sensor data. Connect your device to begin." }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [hardwareLogs, setHardwareLogs] = useState([]);
  const [sensorData, setSensorData] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [isContinuousMode, setIsContinuousMode] = useState(false);
  const [currentTemp, setCurrentTemp] = useState(null);
  const [currentHum, setCurrentHum] = useState(null);
  const [hardwareManifest, setHardwareManifest] = useState(() => {
    return localStorage.getItem('hardwareManifest') || 
      "I am a Generic Pin Controller. I don't have hardcoded devices.\n" +
      "Ask the user what they have connected to which pins (D0-D8).\n" +
      "Mapping: D0=16, D1=5, D2=4, D3=0, D4=2, D5=14, D6=12, D7=13, D8=15.\n" +
      "Example: If a relay is on D1, I should use GPIO 5 with mode OUTPUT.";
  });
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [systemStatus, setSystemStatus] = useState([
    { id: 1, text: "System Initialized", severity: "info", time: new Date().toLocaleTimeString() }
  ]);
  
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    // Initialize Speech Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onstart = () => {
        setIsListening(true);
        console.log("Speech recognition started");
      };

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        console.log("Speech transcript:", transcript);
        setInput(transcript);
        setIsListening(false);
        handleSendMessage(transcript);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        console.log("Speech recognition ended");
      };

      recognitionRef.current.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
      };
    } else {
      console.warn("Speech Recognition API not supported in this browser.");
    }
  }, []);

  useEffect(() => {
    wifiService.onMessageReceived = (msg) => {
      setHardwareLogs(prev => [msg, ...prev].slice(0, 50));
    };

    wifiService.onSensorData = (key, value) => {
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      if (key === 'TEMP') {
        setCurrentTemp(value);
        setSensorData(prev => [...prev.slice(-19), { time: now, temp: value, hum: currentHum || 0 }]);
      } else if (key === 'HUM') {
        setCurrentHum(value);
        setSensorData(prev => [...prev.slice(-19), { time: now, temp: currentTemp || 0, hum: value }]);
      }
    };
  }, [currentTemp, currentHum]);

  const handleConnect = async () => {
    try {
      const name = await wifiService.connect();
      setDeviceName(name);
      setIsConnected(true);
      setMessages(prev => [...prev, { role: 'system', content: `Connected to ${name}` }]);
      if (navigator.vibrate) navigator.vibrate(100);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'system', content: 'Connection failed. Ensure WiFi is enabled and the relay is up.' }]);
    }
  };

  const handleDisconnect = () => {
    wifiService.disconnect();
    setIsConnected(false);
    setDeviceName(null);
    setMessages(prev => [...prev, { role: 'system', content: 'Disconnected from WiFi.' }]);
    if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
  };

  const audioCtxRef = useRef(null);
  const audioSourceRef = useRef(null);

  const stopAudio = () => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch (e) {
        console.error("Error stopping audio:", e);
      }
      audioSourceRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  };

  const handleInterrupt = () => {
    stopAudio();
    if (isListening) {
      recognitionRef.current?.stop();
    }
    setIsProcessing(false);
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      stopAudio();
      try {
        recognitionRef.current?.start();
      } catch (e) {
        console.error("Failed to start recognition:", e);
      }
    }
  };

  const playVoiceResponse = async (text) => {
    if (!isVoiceEnabled) return;
    
    const base64 = await geminiAgent.generateSpeech(text);
    if (base64) {
      stopAudio();
      
      return new Promise((resolve) => {
        try {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
          audioCtxRef.current = audioCtx;
          
          if (audioCtx.state === 'suspended') {
            audioCtx.resume();
          }
          
          const binaryString = atob(base64);
          const len = binaryString.length;
          const bytes = new Int16Array(len / 2);
          for (let i = 0; i < len; i += 2) {
            bytes[i / 2] = (binaryString.charCodeAt(i + 1) << 8) | binaryString.charCodeAt(i);
          }
          
          const float32 = new Float32Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) {
            float32[i] = bytes[i] / 32768;
          }
          
          const buffer = audioCtx.createBuffer(1, float32.length, 24000);
          buffer.getChannelData(0).set(float32);
          
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          
          const gainNode = audioCtx.createGain();
          gainNode.gain.value = volume;
          
          source.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          
          audioSourceRef.current = source;
          
          source.onended = () => {
            audioSourceRef.current = null;
            resolve();
          };
          
          source.start();
        } catch (e) {
          console.error("Audio playback failed:", e);
          resolve();
        }
      });
    }
  };

  const handleSendMessage = async (textOverride) => {
    const userMsg = textOverride || input.trim();
    if (!userMsg || isProcessing) return;

    if (!textOverride) setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsProcessing(true);
    setIsThinking(true);

    try {
      const history = messages.map(m => ({
        role: m.role === 'system' ? 'model' : m.role,
        parts: [{ text: m.content }]
      }));

      const sensorContext = `[Current Sensor Context: Temp=${currentTemp ?? 'N/A'}°C, Humidity=${currentHum ?? 'N/A'}%]`;
      const fullPrompt = `${sensorContext}\nUser: ${userMsg}`;

      const response = await geminiAgent.processCommand(fullPrompt, history, hardwareManifest);
      setIsThinking(false);
      
      if (response.functionCalls) {
        for (const call of response.functionCalls) {
          if (call.name === 'controlHardware') {
            const { pin, mode, action, value } = call.args;
            // Format: PIN:MODE:ACTION:VALUE
            const cmdString = `${pin}:${mode || 'X'}:${action || 'X'}:${value !== undefined ? value : 'X'}`;
            
            if (isConnected) {
              await wifiService.sendCommand(cmdString);
              setHardwareLogs(prev => [`TX: ${cmdString}`, ...prev]);
              if (navigator.vibrate) navigator.vibrate(50);
            } else {
              setHardwareLogs(prev => [`[OFFLINE] Pin Command: ${cmdString}`, ...prev]);
            }
          } else if (call.name === 'updateHardwareManifest') {
            const { newManifest } = call.args;
            setHardwareManifest(newManifest);
            localStorage.setItem('hardwareManifest', newManifest);
            setMessages(prev => [...prev, { role: 'system', content: "Hardware Manifest Updated by Agent." }]);
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
          } else if (call.name === 'updateSystemStatus') {
            const { status, severity } = call.args;
            setSystemStatus(prev => [{
              id: Date.now(),
              text: status,
              severity,
              time: new Date().toLocaleTimeString()
            }, ...prev].slice(0, 5));
            if (navigator.vibrate) navigator.vibrate(50);
          }
        }
      }

      const agentText = response.text || "Command executed.";
      setMessages(prev => [...prev, { role: 'model', content: agentText }]);
      
      // Play voice and wait for it to finish if in continuous mode
      if (isVoiceEnabled) {
        await playVoiceResponse(agentText);
      }
      
      if (isContinuousMode) {
        toggleListening();
      }
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', content: "Sorry, I encountered an error processing that." }]);
    } finally {
      setIsProcessing(false);
      setIsThinking(false);
    }
  };

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [volume, setVolume] = useState(0.5);

  useEffect(() => {
    const resumeAudio = () => {
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    };
    window.addEventListener('click', resumeAudio);
    return () => window.removeEventListener('click', resumeAudio);
  }, []);

  const handleUnlock = (e) => {
    e.preventDefault();
    if (passwordInput.toLowerCase() === 'heisenberg') {
      setIsUnlocked(true);
      if (navigator.vibrate) navigator.vibrate(100);
    } else {
      setPasswordError(true);
      setTimeout(() => setPasswordError(false), 1000);
    }
  };

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-[#121212] rounded-2xl p-10 shadow-2xl border border-white/5"
        >
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 bg-[#1DB954] rounded-full flex items-center justify-center shadow-lg shadow-[#1DB954]/20">
              <Cpu className="w-10 h-10 text-black" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-center mb-4 text-white">Say my name</h1>
          <p className="text-[#B3B3B3] text-center mb-10 text-sm leading-relaxed">
            "You know who I am. You're goddamn right."
          </p>
          <form onSubmit={handleUnlock} className="space-y-6">
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Enter access code"
                className={cn(
                  "w-full bg-[#282828] border-none rounded-full py-4 px-6 text-center text-lg tracking-[0.5em] focus:ring-2 focus:ring-[#1DB954] transition-all placeholder:text-[#B3B3B3] placeholder:tracking-normal",
                  passwordError && "animate-shake ring-2 ring-red-500"
                )}
            />
            <button
              type="submit"
              className="w-full py-4 bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold rounded-full transition-all transform active:scale-95 shadow-xl"
            >
              Unlock Terminal
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-black text-white font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-black flex flex-col p-4 gap-4 hidden md:flex">
        <div className="flex items-center gap-3 px-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-[#1DB954] flex items-center justify-center">
            <Cpu className="w-5 h-5 text-black" />
          </div>
          <h1 className="font-bold text-lg tracking-tight">ESP8266 Agent</h1>
        </div>

        <nav className="flex flex-col gap-2">
          <button 
            onClick={() => setIsConfigOpen(false)}
            className="flex items-center gap-4 px-3 py-2 rounded-md hover:bg-[#282828] transition-colors text-[#B3B3B3] hover:text-white font-bold"
          >
            <MessageSquare size={24} />
            <span>Terminal</span>
          </button>
          <button 
            onClick={() => setIsConfigOpen(true)}
            className="flex items-center gap-4 px-3 py-2 rounded-md hover:bg-[#282828] transition-colors text-[#B3B3B3] hover:text-white font-bold"
          >
            <Settings size={24} />
            <span>Manifest</span>
          </button>
        </nav>

        <div className="mt-4 flex-1 bg-[#121212] rounded-lg overflow-hidden flex flex-col">
          <div className="p-4 border-b border-white/5 flex items-center gap-2">
            <Activity size={16} className="text-[#1DB954]" />
            <span className="font-bold text-xs uppercase tracking-widest text-[#B3B3B3]">Status</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {systemStatus.map((status) => (
              <div 
                key={status.id}
                className={cn(
                  "p-2 rounded-md text-[10px] border border-transparent",
                  status.severity === 'critical' ? "bg-red-500/10 text-red-400 border-red-500/20" :
                  status.severity === 'warning' ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" :
                  "bg-[#282828] text-[#B3B3B3]"
                )}
              >
                <p className="font-bold">{status.text}</p>
                <p className="opacity-50 mt-1">{status.time}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="h-48 bg-[#121212] rounded-lg overflow-hidden flex flex-col">
          <div className="p-4 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal size={16} className="text-[#1DB954]" />
              <span className="font-bold text-xs uppercase tracking-widest text-[#B3B3B3]">Logs</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-[9px] text-[#B3B3B3] space-y-1">
            {hardwareLogs.map((log, i) => (
              <div key={i} className="truncate">
                <span className="opacity-30 mr-1">{new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>
                {log}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-[#121212] md:m-2 md:rounded-lg overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-b from-[#1DB954]/10 to-transparent pointer-events-none" />
        
        {/* Header (Mobile) */}
        <header className="md:hidden p-4 flex items-center justify-between border-b border-white/5 bg-black/40 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <Cpu className="text-[#1DB954]" size={20} />
            <span className="font-bold">ESP8266 Agent</span>
          </div>
          <button onClick={() => setIsConfigOpen(true)}>
            <Settings size={20} className="text-[#B3B3B3]" />
          </button>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 z-10 scrollbar-hide">
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex flex-col gap-1",
                  msg.role === 'user' ? "items-end" : "items-start"
                )}
              >
                <div className={cn(
                  "max-w-[85%] md:max-w-[70%] p-3 md:p-4 rounded-2xl text-sm md:text-base",
                  msg.role === 'user' 
                    ? "bg-[#1DB954] text-black font-semibold rounded-br-none" 
                    : msg.role === 'system'
                    ? "bg-white/5 text-[#B3B3B3] text-[10px] uppercase tracking-widest font-bold py-1 px-4 rounded-full border border-white/5"
                    : "bg-[#282828] text-white rounded-bl-none shadow-xl prose prose-invert prose-sm max-w-none"
                )}
              >
                {msg.role === 'model' ? (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>
              </motion.div>
            ))}
            {isThinking && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-1 items-start"
              >
                <div className="bg-[#282828] text-white p-4 rounded-2xl rounded-bl-none shadow-xl flex items-center gap-3">
                  <div className="flex gap-1">
                    <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0 }} className="w-1.5 h-1.5 bg-[#1DB954] rounded-full" />
                    <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }} className="w-1.5 h-1.5 bg-[#1DB954] rounded-full" />
                    <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.4 }} className="w-1.5 h-1.5 bg-[#1DB954] rounded-full" />
                  </div>
                  <span className="text-xs font-bold text-[#B3B3B3] uppercase tracking-widest">Thinking</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={chatEndRef} />
        </div>

        {/* Player Bar (Bottom) */}
        <div className="h-24 bg-black border-t border-white/5 flex items-center px-4 md:px-8 gap-4 md:gap-8 z-20">
          {/* Device Info */}
          <div className="hidden lg:flex items-center gap-4 w-64">
            <div className="w-12 h-12 bg-[#282828] rounded-md flex items-center justify-center shadow-lg">
              <Cpu className={cn("w-6 h-6", isConnected ? "text-[#1DB954]" : "text-[#B3B3B3]")} />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold truncate max-w-[140px]">{isConnected ? deviceName : "No Device"}</span>
              <span className="text-[10px] text-[#B3B3B3] uppercase tracking-widest">{isConnected ? "Connected" : "Disconnected"}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex-1 flex flex-col items-center gap-2 relative">
            <AnimatePresence>
              {(isProcessing || audioSourceRef.current) && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.5, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.5, y: 20 }}
                  className="absolute -top-24 left-1/2 -translate-x-1/2 z-50"
                >
                  <button 
                    onClick={handleInterrupt}
                    className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-red-600 flex flex-col items-center justify-center transition-all active:scale-90 shadow-2xl hover:bg-red-500 ring-4 ring-red-600/20"
                    title="Interrupt"
                  >
                    <Square size={32} fill="currentColor" />
                    <span className="text-[10px] font-bold uppercase mt-1">Stop</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-4 md:gap-6">
              <button 
                onClick={() => setIsContinuousMode(!isContinuousMode)}
                className={cn(
                  "p-2 transition-colors",
                  isContinuousMode ? "text-[#1DB954]" : "text-[#B3B3B3] hover:text-white"
                )}
                title="Continuous Mode"
              >
                <RefreshCw size={20} className={isContinuousMode ? "animate-spin-slow" : ""} />
              </button>
              
              <button 
                onClick={toggleListening}
                className={cn(
                  "w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-transform active:scale-95 shadow-xl",
                  isListening ? "bg-red-500 animate-pulse" : "bg-white text-black hover:scale-105"
                )}
              >
                {isListening ? <MicOff size={24} /> : <Mic size={24} />}
              </button>

              <button 
                onClick={isConnected ? handleDisconnect : handleConnect}
                className={cn(
                  "p-2 transition-colors",
                  isConnected ? "text-[#1DB954]" : "text-[#B3B3B3] hover:text-white"
                )}
                title={isConnected ? "Disconnect" : "Connect"}
              >
                {isConnected ? <WifiOff size={20} /> : <Wifi size={20} />}
              </button>
            </div>

            <div className="w-full max-w-2xl relative group">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="What do you want to do?"
                disabled={isProcessing}
                className="w-full bg-[#282828] border-none rounded-full py-2 px-6 text-sm focus:ring-1 focus:ring-white/20 transition-all placeholder:text-[#B3B3B3]"
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={!input.trim() || isProcessing}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#B3B3B3] hover:text-white disabled:opacity-0 transition-all"
              >
                <Send size={16} />
              </button>
            </div>
          </div>

          {/* Volume / Extra */}
          <div className="hidden lg:flex items-center justify-end gap-4 w-64">
            <button 
              onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
              className="text-[#B3B3B3] hover:text-white transition-colors"
            >
              {isVoiceEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <div className="w-32 flex items-center gap-2">
              <input 
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-full h-1 bg-[#4D4D4D] rounded-full appearance-none cursor-pointer accent-[#1DB954]"
              />
            </div>
          </div>
        </div>
      </main>

      {/* Hardware Configuration Modal */}
      <AnimatePresence>
        {isConfigOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl bg-[#181818] rounded-2xl overflow-hidden shadow-2xl border border-white/5"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Settings className="w-6 h-6 text-[#1DB954]" />
                  <h2 className="text-xl font-bold">Hardware Manifest</h2>
                </div>
                <button 
                  onClick={() => setIsConfigOpen(false)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors"
                >
                  <RefreshCw className="w-5 h-5 opacity-50 rotate-45" />
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <textarea
                  value={hardwareManifest}
                  onChange={(e) => {
                    setHardwareManifest(e.target.value);
                    localStorage.setItem('hardwareManifest', e.target.value);
                  }}
                  className="w-full h-64 bg-[#121212] border border-white/5 rounded-xl p-4 text-sm font-mono focus:outline-none focus:border-[#1DB954]/50 transition-all resize-none"
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => handleSendMessage("Optimize my hardware manifest.")}
                    className="text-[10px] uppercase font-bold tracking-widest text-[#1DB954] hover:text-[#1ed760] transition-colors flex items-center gap-2"
                  >
                    <Zap size={12} />
                    Optimize with AI
                  </button>
                </div>
              </div>

              <div className="p-6 bg-black/20 border-t border-white/5 flex justify-end">
                <button
                  onClick={() => setIsConfigOpen(false)}
                  className="px-8 py-3 bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold rounded-full transition-all"
                >
                  Save
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
