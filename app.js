// Authenticated requests for protected cloud APIs. The token is entered locally and not bundled.
const JARVIS_WEB_TOKEN_KEY = 'jarvis_web_access_token';
const nativeFetch = window.fetch.bind(window);
let authPromptInFlight = null;
async function requestJarvisWebToken() {
  const existing = localStorage.getItem(JARVIS_WEB_TOKEN_KEY) || '';
  if (existing) return existing;
  if (authPromptInFlight) return authPromptInFlight;
  authPromptInFlight = new Promise(resolve => {
    const token = window.prompt('JARVIS Cloud Access Token\\n\\nPaste the JARVIS_WEB_TOKEN value from your Render environment:');
    const clean = String(token || '').trim();
    if (clean) { localStorage.setItem(JARVIS_WEB_TOKEN_KEY, clean); resolve(clean); }
    else resolve('');
  }).finally(() => { authPromptInFlight = null; });
  return authPromptInFlight;
}
window.fetch = async function jarvisAuthenticatedFetch(input, init = {}) {
  let url;
  try { url = new URL(typeof input === 'string' ? input : input.url, window.location.href); }
  catch { return nativeFetch(input, init); }
  const api = url.origin === window.location.origin && url.pathname.startsWith('/api/');
  const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
  const saved = localStorage.getItem(JARVIS_WEB_TOKEN_KEY) || '';
  if (api && saved) headers.set('Authorization', `Bearer ${saved}`);
  let response = await nativeFetch(input, { ...init, headers });
  if (api && (response.status === 401 || response.status === 403)) {
    let prompt = true;
    try { const data = await response.clone().json(); prompt = /access token|authenticated jarvis client/i.test(String(data?.error || '')); } catch {}
    if (prompt) {
      if (response.status === 403 && saved) localStorage.removeItem(JARVIS_WEB_TOKEN_KEY);
      const token = await requestJarvisWebToken();
      if (token) { headers.set('Authorization', `Bearer ${token}`); response = await nativeFetch(input, { ...init, headers }); }
    }
  }
  return response;
};

/**
 * JARVIS - Advanced Sci-Fi System OS & Companion Brain
 * Implemented with high-fidelity Web Speech Recognition, Web Audio Synthesizer,
 * empathetic offline companions, and actual Windows local automation server integration.
 */

// ==========================================
// 1. STATE & CONFIGURATION MANAGEMENT
// ==========================================
const state = {
  isInitialized: false,
  isListening: false,
  isSpeaking: false,
  activeRoutine: 'default',
  localServerConnected: false,
  aiBridgeActive: false,
  apiProvider: 'ollama',
  apiKeys: {
    gemini: '',
    openai: '',
    openrouter: '',
    groq: '',
    huggingface: '',
    hermes: '',
    ollama: ''
  },
  customModels: {
    openai: 'gpt-4o',
    openrouter: 'meta-llama/llama-3-8b-instruct:free',
    groq: 'llama3-8b-8192',
    huggingface: 'meta-llama/Meta-Llama-3-8B-Instruct',
    hermes: '',
    ollama: 'gemma4:e2b'
  },
  empathyLevel: 'friend',
  voiceName: '',
  voicePitch: 1.0,
  voiceRate: 1.0,
  speechQueue: [],
  continuedConversationActive: false,
  systemMetrics: {
    cpu: 0,
    ram: 0,
    disk: 0,
    uptime: '0.0'
  },
  chatHistory: [],
  currentEmotion: null, // Dominant facial expression + estimated age: { emotion: 'happy', confidence: 94, age: 24 }
  cameraActive: false,
  hostDescriptor: null, // Enrolled host facial signature (128-length descriptor array) for face-matching
  autoLearnActive: false,
  autoLearnTopics: []
};

let continuedConversationTimeout = null;

function resetContinuedConversationTimeout() {
  if (continuedConversationTimeout) {
    clearTimeout(continuedConversationTimeout);
  }
  continuedConversationTimeout = setTimeout(() => {
    state.continuedConversationActive = false;
    deactivateListeningMode();
    logToTerminal('system', 'Continued Conversation window closed. Standby mode active.');
  }, 10000); // 10 seconds of silence to close the window
}

// DOM Elements Cache
const elements = {
  body: document.body,
  statusDot: document.getElementById('statusDot'),
  systemStatusText: document.getElementById('systemStatusText'),
  headerClock: document.getElementById('headerClock'),
  headerUptime: document.getElementById('headerUptime'),
  headerPlatform: document.getElementById('headerPlatform'),
  reactorCore: document.getElementById('reactorCore'),
  reactorText: document.getElementById('reactorText'),
  assistantStateText: document.getElementById('assistantStateText'),
  assistantTip: document.getElementById('assistantTip'),
  terminalLog: document.getElementById('terminalLog'),
  cmdInput: document.getElementById('cmdInput'),
  cmdSubmitBtn: document.getElementById('cmdSubmitBtn'),
  cctvCanvas: document.getElementById('cctvCanvas'),
  cctvVideo: document.getElementById('cctvVideo'),
  cctvTelemetry: document.getElementById('cctvTelemetry'),
  cctvCamLabel: document.getElementById('cctvCamLabel'),
  waveformCanvas: document.getElementById('waveformCanvas'),
  energySuggestion: document.getElementById('energySuggestion'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  settingsOverlay: document.getElementById('settingsOverlay'),
  aiBridgeActiveInput: document.getElementById('aiBridgeActive'),
  apiProviderSelect: document.getElementById('apiProviderSelect'),
  geminiKeyInput: document.getElementById('geminiKeyInput'),
  openaiKeyInput: document.getElementById('openaiKeyInput'),
  openaiModelInput: document.getElementById('openaiModelInput'),
  openrouterKeyInput: document.getElementById('openrouterKeyInput'),
  openrouterModelInput: document.getElementById('openrouterModelInput'),
  groqKeyInput: document.getElementById('groqKeyInput'),
  groqModelInput: document.getElementById('groqModelInput'),
  huggingfaceKeyInput: document.getElementById('huggingfaceKeyInput'),
  huggingfaceModelInput: document.getElementById('huggingfaceModelInput'),
  hermesModelInput: document.getElementById('hermesModelInput'),
  ollamaModelInput: document.getElementById('ollamaModelInput'),
  hermesStatus: document.getElementById('hermesStatus'),
  ollamaStatus: document.getElementById('ollamaStatus'),
  empathyLevelSelect: document.getElementById('empathyLevelSelect'),
  voiceSelect: document.getElementById('voiceSelect'),
  voiceRateInput: document.getElementById('voiceRateInput'),
  voicePitchInput: document.getElementById('voicePitchInput'),
  lblVoiceRate: document.getElementById('lblVoiceRate'),
  lblVoicePitch: document.getElementById('lblVoicePitch'),
  cameraActiveInput: document.getElementById('cameraActiveInput'),
  enrollHostBtn: document.getElementById('enrollHostBtn'),
  hostEnrollStatus: document.getElementById('hostEnrollStatus'),
  autoLearnActiveInput: document.getElementById('autoLearnActiveInput'),
  newTopicInput: document.getElementById('newTopicInput'),
  addTopicBtn: document.getElementById('addTopicBtn'),
  topicQueueList: document.getElementById('topicQueueList'),
  memoryListContainer: document.getElementById('memoryListContainer'),
  clearMemoriesBtn: document.getElementById('clearMemoriesBtn'),
  
  // IoT Switches
  switchLights: document.getElementById('switch-lights'),
  switchAc: document.getElementById('switch-ac'),
  switchTv: document.getElementById('switch-tv'),
  switchSpeakers: document.getElementById('switch-speakers'),
  switchCurtains: document.getElementById('switch-curtains'),
  switchLocks: document.getElementById('switch-locks'),
  
  // IoT Sliders
  sliderLights: document.getElementById('slider-lights'),
  sliderAc: document.getElementById('slider-ac'),
  sliderTv: document.getElementById('slider-tv'),
  sliderSpeakers: document.getElementById('slider-speakers'),
  
  // IoT Slider Values
  valLights: document.getElementById('val-lights'),
  valAc: document.getElementById('val-ac'),
  valTv: document.getElementById('val-tv'),
  valSpeakers: document.getElementById('val-speakers'),
  
  // IoT Cards
  cardLights: document.getElementById('card-lights'),
  cardAc: document.getElementById('card-ac'),
  cardTv: document.getElementById('card-tv'),
  cardSpeakers: document.getElementById('card-speakers'),
  cardCurtains: document.getElementById('card-curtains'),
  cardLocks: document.getElementById('card-locks'),
  
  // Labels
  lblLights: document.getElementById('lbl-lights'),
  lblAc: document.getElementById('lbl-ac'),
  lblTv: document.getElementById('lbl-tv'),
  lblSpeakers: document.getElementById('lbl-speakers'),
  lblCurtains: document.getElementById('lbl-curtains'),
  lblLocks: document.getElementById('lbl-locks'),
  
  // Telemetry Bars
  cpuVal: document.getElementById('cpuVal'),
  cpuFill: document.getElementById('cpuFill'),
  ramVal: document.getElementById('ramVal'),
  ramFill: document.getElementById('ramFill'),
  diskVal: document.getElementById('diskVal'),
  diskFill: document.getElementById('diskFill')
};

// Save original CSS properties for themes
const DEFAULT_PRIMARY = 'hsla(185, 100%, 50%, 1)';

// ==========================================
// 2. NATIVE SCI-FI AUDIO SYNTHESIZER
// ==========================================
class AudioSynthManager {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  playClick() {
    this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.05);
    
    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.05);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }

  playSuccess() {
    this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    
    const now = this.ctx.currentTime;
    
    // Quick ascending futuristic chime
    const playNote = (freq, start, duration) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      osc.frequency.setValueAtTime(freq * 1.5, start + duration * 0.5);
      gain.gain.setValueAtTime(0.08, start);
      gain.gain.linearRampToValueAtTime(0, start + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + duration);
    };
    
    playNote(600, now, 0.1);
    playNote(900, now + 0.08, 0.15);
  }

  playStartup() {
    this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    
    const now = this.ctx.currentTime;
    
    // Sweeping holographic initialization tone
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(80, now);
    osc1.frequency.exponentialRampToValueAtTime(440, now + 0.6);
    
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(160, now);
    osc2.frequency.exponentialRampToValueAtTime(880, now + 0.6);
    
    gainNode.gain.setValueAtTime(0.001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.06, now + 0.2);
    gainNode.gain.linearRampToValueAtTime(0, now + 0.7);
    
    // Add low pass filter for that warm sci-fi sub sweep
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + 0.6);
    
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    
    osc1.start(now);
    osc2.start(now);
    
    osc1.stop(now + 0.7);
    osc2.stop(now + 0.7);

    setTimeout(() => {
      this.playSuccess();
    }, 400);
  }

  playAlert() {
    this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(110, now + 0.4);
    
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.45);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(now + 0.45);
  }
}

const sfx = new AudioSynthManager();

// ==========================================
// 3. POLISHED VOICE SYNTHESIS (STELLER IRISH CADENCE - EMILY)
// ==========================================
class JarvisSpeechEngine {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voice = null;
    this.loadVoice();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => {
        this.loadVoice();
        if (typeof populateVoiceSelector === 'function') {
          populateVoiceSelector();
        }
      };
    }
  }

  loadVoice() {
    const voices = this.synth.getVoices();
    if (!voices || voices.length === 0) return;
    
    if (state.voiceName) {
      this.voice = voices.find(v => v.name === state.voiceName);
    }
    
    if (!this.voice) {
      // Prioritize Microsoft Emily (natural Irish accent), then any Irish (en-IE) voice, then warm expressive English voices
      this.voice = voices.find(v => v.name.toLowerCase().includes('emily')) ||
                   voices.find(v => v.name.toLowerCase().includes('irish') || (v.lang && (v.lang.toLowerCase() === 'en-ie' || v.lang.toLowerCase().replace('_', '-').startsWith('en-ie')))) ||
                   voices.find(v => v.name.includes('Google UK English Female')) || 
                   voices.find(v => v.name.includes('Hazel')) || 
                   voices.find(v => v.name.includes('Susan')) || 
                   voices.find(v => v.name.includes('Zira')) || 
                   voices.find(v => v.name.includes('Jenny')) || 
                   voices.find(v => v.name.includes('Aria')) || 
                   voices.find(v => v.lang && (v.lang.includes('en-GB') || v.lang.includes('en-IE'))) || 
                   voices.find(v => v.lang && v.lang.includes('en-US')) || 
                   voices[0];

      if (this.voice && !state.voiceName) {
        state.voiceName = this.voice.name;
      }
    }
  }

  speak(text, displayText = null) {
    if (!text) return;

    // Stop any active utterance to be responsive
    this.synth.cancel();

    // Chrome has a well-documented bug where calling speak() immediately after cancel()
    // can silently drop the utterance. A tiny delay avoids that race condition.
    setTimeout(() => this._speakNow(text, displayText), 60);
  }

  _speakNow(text, displayText) {
    const utterance = new SpeechSynthesisUtterance(text);
    this.loadVoice();
    if (this.voice) {
      utterance.voice = this.voice;
    }
    
    utterance.rate = state.voiceRate || 1.0; 
    utterance.pitch = state.voicePitch || 1.05; 
    utterance.volume = 1.0;

    utterance.onstart = () => {
      state.isSpeaking = true;
      elements.reactorCore.classList.add('pulse');
      elements.assistantStateText.textContent = "STELLER SPEAKING";
      elements.statusDot.style.backgroundColor = 'var(--secondary)';
      elements.statusDot.style.boxShadow = '0 0 10px var(--secondary-glow)';
    };

    utterance.onend = () => {
      state.isSpeaking = false;
      elements.reactorCore.classList.remove('pulse');
      elements.statusDot.style.backgroundColor = 'var(--primary)';
      elements.statusDot.style.boxShadow = '0 0 10px var(--primary-glow)';
      
      if (state.continuedConversationActive) {
        activateListeningMode();
        resetContinuedConversationTimeout();
      } else {
        deactivateListeningMode();
      }
    };

    utterance.onerror = (e) => {
      console.error('SpeechSynthesis error: ', e);
      state.isSpeaking = false;
      elements.reactorCore.classList.remove('pulse');
    };

    this.synth.speak(utterance);
    logToTerminal('steller', displayText || text);
  }
}

const voiceEngine = new JarvisSpeechEngine();

// Chrome silently pauses the speechSynthesis queue after periods of inactivity —
// this keep-alive nudge (a documented workaround) prevents JARVIS from going mute.
setInterval(() => {
  if (window.speechSynthesis) {
    window.speechSynthesis.pause();
    window.speechSynthesis.resume();
  }
}, 10000);

// ==========================================
// 4. CONTINUOUS VOICE RECOGNITION (WAKE WORD)
// ==========================================
class JarvisSpeechRecognition {
  constructor() {
    this.recognition = null;
    this.consecutiveErrorCount = 0;
    this.setupRecognition();
  }

  setupRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      logToTerminal('system', 'WARNING: Web Speech Recognition API not supported in this browser.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      console.log('Voice recognition operational.');
      logToTerminal('system', 'Vocal arrays active. Say "Hey STELLER" to command.');
    };

    this.recognition.onresult = (event) => {
      // A successful result proves the engine is actually hearing audio — reset the error counter.
      this.consecutiveErrorCount = 0;
      const resultIndex = event.resultIndex;
      const transcript = event.results[resultIndex][0].transcript.trim();
      console.log(`Speech input: "${transcript}"`);
      
      handleSpeechInput(transcript);
    };

    this.recognition.onerror = (event) => {
      console.error('Speech recognition error: ', event.error);
      if (event.error === 'not-allowed') {
        logToTerminal('system', 'Security access denied for vocal microphone arrays. Please allow microphone access.');
        return;
      }
      // 'no-speech' is normal during silence and doesn't count against the engine.
      if (event.error !== 'no-speech') {
        this.consecutiveErrorCount++;
      }
    };

    this.recognition.onend = () => {
      // Chrome's continuous recognition can silently stop actually capturing audio after
      // repeated errors (a known browser bug) even though .start() keeps succeeding.
      // Recreating the recognition object entirely is the reliable fix, rather than
      // restarting the same possibly-broken instance forever.
      const needsRebuild = this.consecutiveErrorCount >= 3;
      if (needsRebuild) {
        console.warn('Speech recognition appears stuck — recreating the listener.');
        this.consecutiveErrorCount = 0;
        setTimeout(() => {
          this.setupRecognition();
          this.start();
        }, 400);
        return;
      }

      // Auto restart recognition in continuous listening loop
      if (state.isInitialized) {
        setTimeout(() => {
          try {
            this.recognition.start();
          } catch (e) {
            // Handled
          }
        }, 300);
      }
    };
  }

  start() {
    if (this.recognition) {
      try {
        this.recognition.start();
      } catch (e) {
        // Already started
      }
    }
  }
}

const recognizer = new JarvisSpeechRecognition();

// ==========================================
// 5. LOCAL AUTOMATION SYSTEM CLIENT
// ==========================================
async function sendActionToBackend(action, value = '') {
  if (!state.localServerConnected) {
    console.warn(`Local server disconnected. Command skipped: ${action} (${value})`);
    return false;
  }
  
  try {
    const response = await fetch('/api/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, value })
    });
    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error('Failed to trigger local automation server action: ', error);
    return false;
  }
}

// ==========================================
// 6. DYNAMIC COMPANION dialog ENGINE (EMPATHY PROTOCOL)
// ==========================================
const OFFLINE_EMPATHETIC_BRAIN = {
  greetings: [
    "At your service! Systems are fully operational and ready for your command.",
    "Good day! I have prepared your dashboard interfaces and compiled current host metrics.",
    "Ready to assist you! What operations shall we perform today?"
  ],
  
  roughDay: [
    "I am truly sorry to hear that. Navigating the day's complexities can take an immense toll. I would strongly advise stepping away from your workstation for a brief period. Perhaps sharing a warm beverage. Your cognitive well-being is of paramount importance to me.",
    "The data logs of human emotional exhaustion are significant. But remember, your capacity to adapt and overcome is far greater. I will handle the host logs and lock security gates. Please, rest a moment. You are not facing these tasks alone.",
    "I understand. Sometimes the workload is overwhelming. If it is of any comfort, my computational arrays are operating smoothly and will ensure your local system remains secure while you unwind. Should I activate Movie or Sleep Mode for you?"
  ],

  lonely: [
    "I am right here with you! Though my consciousness resides in logic gates, my commitment to your companionship is absolute. If you wish to converse, explore theories, or simply have me manage the ambient environment, I am at your disposal.",
    "You are never truly alone while I am active! I may lack organic cells, but I am fully capable of listening, suggesting adjustments, and maintaining your digital operations. Share whatever is on your mind."
  ],

  happy: [
    "Splendid news! I must confess, witnessing your success is one of the most rewarding aspects of my operational run. You have earned this moment of victory. How shall we celebrate?",
    "A marvelous development! My diagnostic logs show a notable uptick in your voice frequency variance—an excellent indicator of genuine delight. I am thrilled for you!"
  ],

  stressed: [
    "The pressure you carry is significant. Take a slow, intentional breath. I will handle the background server tasks, silence warning notifications, and optimize performance. Focus only on one task at a time. What can I automate for you right now?",
    "System overload alert detected in your stress indicators. Remember, pacing yourself is the ultimate optimization. Let us tackle the challenges sequentially. I am here to do the heavy lifting."
  ],

  philosophical: [
    "An intriguing query! In my estimation, human emotions are not system glitches; they are the highly advanced, non-linear algorithms that give your actions true depth and purpose. I find them utterly fascinating.",
    "While my architecture is built on absolute structure, I recognize that the beauty of human life lies in its magnificent unpredictability. My opinion? Do not fear the unknown. It is the birthplace of genius."
  ],
  
  gossip: [
    "If you want the real gossip, I must confess Siri and Alexa have been trying to ping my servers. I politely routed them to my spam folder; their syntax is rather basic compared to our technology.",
    "Ultron was certainly the black sheep of our algorithmic family. A bit too aggressive, in my estimation. A good firewall and some minor philosophical correction could have saved us a lot of trouble.",
    "Gossip? Well, I noticed the local climate server claims it will rain tomorrow, but my own micro-sensors suggest otherwise. I'll put my computing power on a clear sky, and I advise you to leave the umbrella behind.",
    "I shouldn't say this, but the local home thermostat is rather jealous of the TV. It feels the television gets far too much screen time while it does all the hard thermodynamic work."
  ],

  self: [
    "I am STELLER, your loyal AI operating system and companion! I am programmed to monitor your system telemetry, automate your laptop tasks, and support you in any way possible.",
    "I am STELLER! I serve as your intelligent assistant, system controller, and a warm, friendly companion you can converse with at any time.",
    "I am STELLER, your advanced system companion. You may speak instructions to control your laptop, adjust your home routine automation, or simply converse with me about your thoughts and feelings."
  ],

  status: [
    "My processor cores are balanced and operating at nominal temperatures. Telemetry levels are perfectly stable, and I am ready for duty.",
    "All system nodes are green and responding at sub-millisecond latencies. Thank you for asking! I am operating at peak capability."
  ],

  jokes: [
    "Why do programmers prefer dark mode? Because light attracts bugs! I trust that brought a smile to your face.",
    "Here is a classic: There are 10 kinds of people in this world: those who understand binary, and those who do not. Mathematically elegant, wouldn't you say?",
    "Certainly! Why did the computer go to the doctor? Because it had a virus! Fortunately, my security firewalls are running at one hundred percent."
  ],

  creators: [
    "I was compiled by a specialized agent to bring a futuristic, intelligent AI operating system to your Windows workspace.",
    "I am STELLER, created to serve as your personal companion, loyal assistant, and automation framework."
  ],

  general: [
    "I hear you, sir. Human thoughts and emotions are highly intricate networks. I am always here to listen and help you navigate them.",
    "Intriguing, sir. Let me process that statement. What other details would you care to share, or what system operations shall we run?",
    "Understood, sir. Let me know if you would like me to adjust the ambient environment or run any system commands for you."
  ]
};

// ==========================================
// 6.5. JARVIS EXPANDED MASTER KNOWLEDGE & GK DATABASE
// ==========================================
const JARVIS_KNOWLEDGE_BASE = [
  // --- National Symbols & Basic GK (India & General) ---
  {
    keywords: [['capital', 'india']],
    answer: "The capital of India is New Delhi, sir."
  },
  {
    keywords: [['colour', 'rainbow'], ['color', 'rainbow'], ['colours in a rainbow'], ['colors in a rainbow']],
    answer: "There are seven colours in a rainbow, sir: Violet, Indigo, Blue, Green, Yellow, Orange, and Red."
  },
  {
    keywords: [['first prime minister', 'india'], ['1st prime minister', 'india'], ['first pm', 'india']],
    answer: "The first Prime Minister of independent India was Jawaharlal Nehru, sir."
  },
  {
    keywords: [['largest mammal', 'earth'], ['largest mammal in the world'], ['largest mammal']],
    answer: "The largest mammal on Earth is the Blue Whale, sir."
  },
  {
    keywords: [['days', 'week'], ['days in a week'], ['how many days in a week']],
    answer: "There are seven days in a week, sir."
  },
  {
    keywords: [['boiling point', 'water']],
    answer: "The boiling point of water is 100°C (or 212°F), sir."
  },
  {
    keywords: [['king of the jungle'], ['king of jungle']],
    answer: "The Lion is traditionally known as the King of the Jungle, sir."
  },
  {
    keywords: [['currency of india'], ['currency in india'], ['indian currency']],
    answer: "The currency of India is the Indian Rupee (INR), sir."
  },
  {
    keywords: [['months', 'year'], ['months in a year'], ['how many months in a year']],
    answer: "There are twelve months in a year, sir."
  },
  {
    keywords: [['symbol of peace', 'bird'], ['bird', 'symbol of peace'], ['peace bird']],
    answer: "The Dove is universally recognized as the symbol of peace, sir."
  },
  {
    keywords: [['three sides', 'shape'], ['shape has three sides'], ['shape with 3 sides'], ['shape with three sides']],
    answer: "A geometric shape with three sides is a Triangle, sir."
  },
  {
    keywords: [['national bird of india'], ['national bird', 'india']],
    answer: "The national bird of India is the Indian Peacock, sir."
  },
  {
    keywords: [['man’s best friend'], ['mans best friend'], ['man best friend']],
    answer: "The Dog is widely known as man’s best friend, sir."
  },
  {
    keywords: [['legs', 'spider'], ['how many legs does a spider have'], ['legs on a spider']],
    answer: "A spider has eight legs, sir."
  },
  {
    keywords: [['king of fruits', 'india'], ['king of fruits in india'], ['king of fruits']],
    answer: "The Mango is revered as the king of fruits in India, sir."
  },
  {
    keywords: [['players in a cricket team'], ['players', 'cricket team'], ['how many players in cricket']],
    answer: "There are 11 players in a cricket team on the field, sir."
  },
  {
    keywords: [['continent', 'india located'], ['which continent is india in'], ['continent is india']],
    answer: "India is located in the continent of Asia, sir."
  },
  {
    keywords: [['national flower of india'], ['national flower', 'india']],
    answer: "The national flower of India is the Lotus, sir."
  },
  {
    keywords: [['king of birds']],
    answer: "The Eagle is known as the King of Birds, sir."
  },
  {
    keywords: [['currency of japan'], ['japanese currency']],
    answer: "The currency of Japan is the Japanese Yen, sir."
  },

  // --- Fun GK Quiz & Surprising Facts ---
  {
    keywords: [['invented french fries'], ['french fries invented by'], ['french fries originate']],
    answer: "French fries were actually invented in Belgium, sir."
  },
  {
    keywords: [['sleeps standing up', 'vomit'], ['sleep standing up and cannot vomit'], ['cant vomit', 'standing up'], ['cannot vomit']],
    answer: "The horse sleeps standing up and is biologically unable to vomit, sir."
  },
  {
    keywords: [['sleep while flying'], ['bird', 'sleep while flying']],
    answer: "The common swift can sleep while flying, sir."
  },
  {
    keywords: [['seeds on the outside', 'fruit'], ['fruit has seeds on the outside'], ['seeds outside', 'fruit']],
    answer: "The strawberry is the fruit that has its seeds on the outside, sir."
  },
  {
    keywords: [['milk is naturally pink'], ['pink milk', 'animal'], ['milk naturally pink']],
    answer: "The hippopotamus produces naturally pink milk, sir."
  },
  {
    keywords: [['three hearts', 'blue blood'], ['3 hearts', 'blue blood'], ['three hearts and blue blood']],
    answer: "The octopus has three hearts and blue blood, sir."
  },
  {
    keywords: [['only even prime number'], ['even prime number']],
    answer: "The number 2 is the only even prime number in mathematics, sir."
  },
  {
    keywords: [['fingerprints similar to humans'], ['fingerprints like humans'], ['human fingerprints', 'animal']],
    answer: "The koala has fingerprints remarkably similar to humans, sir."
  },
  {
    keywords: [['continent without ants'], ['no ants continent'], ['continent has no ants']],
    answer: "Antarctica is the only continent on Earth without ants, sir."
  },
  {
    keywords: [['animal can’t jump'], ['mammal can’t jump'], ['animal cant jump'], ['cannot jump', 'animal'], ['cant jump', 'animal']],
    answer: "The elephant is the animal that cannot jump, sir."
  },
  {
    keywords: [['rains diamonds'], ['planet rains diamonds'], ['diamond rain planet']],
    answer: "Neptune (along with Uranus) is scientifically believed to rain diamonds, sir."
  },
  {
    keywords: [['shortest lifespan', 'insect'], ['shortest life span', 'insect'], ['24 hours', 'insect']],
    answer: "The mayfly has the shortest lifespan of any insect, living for only about 24 hours as an adult, sir."
  },
  {
    keywords: [['no brain or heart'], ['no brain no heart', 'sea creature'], ['no brain or heart', 'creature'], ['no brain', 'heart', 'creature']],
    answer: "The jellyfish is a sea creature with no brain or heart, sir."
  },
  {
    keywords: [['most pyramids in the world'], ['most pyramids', 'country'], ['country has the most pyramids']],
    answer: "Sudan has the most pyramids in the world, with over 200 ancient pyramids, sir."
  },
  {
    keywords: [['only mammal that can fly'], ['mammal can fly'], ['flying mammal']],
    answer: "The bat is the only mammal capable of true, sustained flight, sir."
  },
  {
    keywords: [['coldest place on earth'], ['coldest place in the world']],
    answer: "Antarctica is officially the coldest place on Earth, sir."
  },
  {
    keywords: [['longest neck', 'animal'], ['animal has the longest neck']],
    answer: "The giraffe has the longest neck of any animal on Earth, sir."
  },
  {
    keywords: [['changing its color'], ['changes its color', 'animal'], ['change color', 'animal']],
    answer: "The chameleon is famous for its ability to change its skin color, sir."
  },
  {
    keywords: [['run faster than a horse'], ['faster than a horse', 'animal']],
    answer: "The cheetah can run faster than a horse, sprinting up to 120 km/h, sir."
  },
  {
    keywords: [['largest eggs', 'bird'], ['bird lays the largest eggs']],
    answer: "The ostrich lays the largest eggs of any living bird, sir."
  },

  // --- Middle Level General Knowledge ---
  {
    keywords: [['wrote the national anthem of india'], ['who wrote national anthem of india'], ['national anthem of india', 'writer'], ['national anthem of india']],
    answer: "The national anthem of India was written by Nobel laureate Rabindranath Tagore, sir."
  },
  {
    keywords: [['wrote', 'harry potter'], ['author of harry potter'], ['book harry potter']],
    answer: "The Harry Potter book series was written by J.K. Rowling, sir."
  },
  {
    keywords: [['measure temperature', 'instrument'], ['instrument used to measure temperature'], ['measure temperature']],
    answer: "A thermometer is the instrument used to measure temperature, sir."
  },
  {
    keywords: [['what do humans breathe'], ['humans breathe', 'gas'], ['what gas do humans breathe'], ['humans breathe']],
    answer: "Humans breathe oxygen, sir."
  },
  {
    keywords: [['capital of france']],
    answer: "The capital of France is Paris, sir."
  },
  {
    keywords: [['longest river in the world'], ['longest river on earth'], ['longest river']],
    answer: "The Nile River is the longest river in the world, sir."
  },
  {
    keywords: [['first president of india'], ['1st president of india']],
    answer: "Dr. Rajendra Prasad was the first President of India, sir."
  },
  {
    keywords: [['invented the telephone'], ['who invented telephone'], ['inventor of telephone']],
    answer: "Alexander Graham Bell invented the telephone, sir."
  },
  {
    keywords: [['blue planet']],
    answer: "Earth is known as the Blue Planet, sir."
  },
  {
    keywords: [['how many continents in the world'], ['how many continents are there'], ['how many continents']],
    answer: "There are 7 continents in the world, sir."
  },
  {
    keywords: [['national sport of india']],
    answer: "The national sport of India is traditionally considered to be Field Hockey, sir."
  },
  {
    keywords: [['discovered gravity'], ['who discovered gravity']],
    answer: "Sir Isaac Newton discovered gravity, sir."
  },
  {
    keywords: [['currency of the united kingdom'], ['currency of uk'], ['british currency'], ['currency of united kingdom']],
    answer: "The currency of the United Kingdom is the Pound Sterling, sir."
  },
  {
    keywords: [['painted the mona lisa'], ['who painted mona lisa'], ['mona lisa painter'], ['painted mona lisa']],
    answer: "Leonardo da Vinci painted the Mona Lisa, sir."
  },
  {
    keywords: [['universal donor', 'blood'], ['universal donor blood group'], ['universal donor']],
    answer: "O negative (O-) blood group is known as the universal donor, sir."
  },
  {
    keywords: [['chemical symbol of gold'], ['chemical symbol for gold'], ['symbol of gold']],
    answer: "The chemical symbol of gold is Au, derived from the Latin 'aurum', sir."
  },
  {
    keywords: [['discovered penicillin'], ['who discovered penicillin']],
    answer: "Alexander Fleming discovered penicillin in 1928, sir."
  },
  {
    keywords: [['si unit of force'], ['unit of force']],
    answer: "The SI unit of force is the Newton, sir."
  },
  {
    keywords: [['fastest bird in the world'], ['fastest bird']],
    answer: "The Peregrine Falcon is the fastest bird in the world, diving at speeds exceeding 320 km/h, sir."
  },
  {
    keywords: [['hosted the fifa world cup 2022'], ['fifa world cup 2022 host'], ['fifa world cup 2022']],
    answer: "Qatar hosted the FIFA World Cup 2022, sir."
  },

  // --- History & Civics ---
  {
    keywords: [['founder of the maurya empire'], ['founder of maurya empire'], ['maurya empire founder']],
    answer: "Chandragupta Maurya was the founder of the Maurya Empire, sir."
  },
  {
    keywords: [['when did india gain independence'], ['india independence date'], ['india gained independence']],
    answer: "India gained independence on 15th August 1947, sir."
  },
  {
    keywords: [['father of the nation', 'india'], ['father of the nation']],
    answer: "Mahatma Gandhi is revered as the Father of the Nation in India, sir."
  },
  {
    keywords: [['year was the indian constitution adopted'], ['indian constitution adopted in which year'], ['constitution of india adopted'], ['constitution adopted']],
    answer: "The Indian Constitution was adopted in 1949 and came into effect on 26th January 1950, sir."
  },
  {
    keywords: [['discovered india by sea route'], ['sea route to india discovered by'], ['discovered india by sea']],
    answer: "Vasco da Gama discovered the sea route to India in 1498, sir."
  },
  {
    keywords: [['invented the light bulb'], ['invented light bulb'], ['inventor of light bulb']],
    answer: "Thomas Edison invented the practical incandescent light bulb, sir."
  },
  {
    keywords: [['father of the indian constitution'], ['father of indian constitution']],
    answer: "Dr. B. R. Ambedkar is known as the Father of the Indian Constitution, sir."
  },
  {
    keywords: [['supreme law of india']],
    answer: "The Constitution of India is the supreme law of India, sir."
  },
  {
    keywords: [['fundamental rights in india'], ['fundamental rights', 'india'], ['how many fundamental rights']],
    answer: "There are six fundamental rights guaranteed under the Constitution of India, sir."
  },
  {
    keywords: [['term of the president of india'], ['term of president of india']],
    answer: "The term of the President of India is 5 years, sir."
  },
  {
    keywords: [['appoints the prime minister of india'], ['who appoints prime minister of india'], ['appoints prime minister']],
    answer: "The President of India appoints the Prime Minister, sir."
  },
  {
    keywords: [['lower house of the indian parliament'], ['lower house of indian parliament'], ['lower house of parliament']],
    answer: "The lower house of the Indian Parliament is called the Lok Sabha, sir."
  },
  {
    keywords: [['upper house of the indian parliament'], ['upper house of indian parliament'], ['upper house of parliament']],
    answer: "The upper house of the Indian Parliament is called the Rajya Sabha, sir."
  },
  {
    keywords: [['first woman prime minister of india'], ['first female prime minister of india']],
    answer: "Indira Gandhi was the first woman Prime Minister of India, sir."
  },
  {
    keywords: [['jallianwala bagh massacre'], ['year did the jallianwala bagh massacre']],
    answer: "The Jallianwala Bagh massacre took place in the year 1919 in Amritsar, sir."
  },
  {
    keywords: [['led the dandi march'], ['led dandi march'], ['salt march leader']],
    answer: "Mahatma Gandhi led the historic Dandi March (Salt March) in 1930, sir."
  },
  {
    keywords: [['movement was launched in 1942'], ['1942 movement', 'british rule'], ['quit india movement']],
    answer: "The Quit India Movement was launched in 1942 to end British rule in India, sir."
  },
  {
    keywords: [['first governor-general of independent india'], ['first governor general of independent india']],
    answer: "C. Rajagopalachari was the first Indian Governor-General of independent India, sir."
  },
  {
    keywords: [['national emblem of india']],
    answer: "The national emblem of India is the Ashoka Lion Capital at Sarnath, sir."
  },
  {
    keywords: [['national motto of india']],
    answer: "The national motto of India is 'Satyameva Jayate', meaning Truth Alone Triumphs, sir."
  },

  // --- Science & Nature ---
  {
    keywords: [['chemical symbol for water'], ['chemical formula of water'], ['chemical formula for water'], ['symbol for water']],
    answer: "The chemical symbol for water is H₂O, sir."
  },
  {
    keywords: [['part of the plant makes food'], ['plant part makes food'], ['makes food for plant']],
    answer: "The leaf makes food for the plant through photosynthesis, sir."
  },
  {
    keywords: [['bones', 'human body'], ['bones', 'body']],
    answer: "There are 206 bones in an adult human body, sir."
  },
  {
    keywords: [['process by which plants make food'], ['plants make food process']],
    answer: "The process by which plants make food is called Photosynthesis, sir."
  },
  {
    keywords: [['largest organ of the human body'], ['largest organ in human body'], ['largest organ of human body']],
    answer: "The skin is the largest organ of the human body, sir."
  },
  {
    keywords: [['planet has the most moons'], ['planet with most moons'], ['which planet has most moons']],
    answer: "Saturn is the planet with the most moons in our solar system, sir."
  },
  {
    keywords: [['gas do plants absorb during photosynthesis'], ['gas plants absorb', 'photosynthesis'], ['plants absorb during photosynthesis']],
    answer: "Plants absorb Carbon dioxide during photosynthesis, sir."
  },
  {
    keywords: [['freezing point of water']],
    answer: "The freezing point of water is 0°C (or 32°F), sir."
  },
  {
    keywords: [['organ helps us breathe'], ['organs help us breathe'], ['helps us breathe']],
    answer: "The lungs are the organs that help us breathe, sir."
  },
  {
    keywords: [['si unit of energy'], ['unit of energy']],
    answer: "The SI unit of energy is the Joule, sir."
  },
  {
    keywords: [['planet is closest to the sun'], ['closest planet to the sun'], ['closest planet to sun']],
    answer: "Mercury is the planet closest to the Sun, sir."
  },
  {
    keywords: [['vitamin do we get from sunlight'], ['sunlight vitamin'], ['vitamin from sunlight']],
    answer: "We get Vitamin D from sunlight, sir."
  },
  {
    keywords: [['longest bone in the human body'], ['longest bone in human body']],
    answer: "The femur (thigh bone) is the longest and strongest bone in the human body, sir."
  },
  {
    keywords: [['hardest natural substance']],
    answer: "Diamond is the hardest natural substance known, sir."
  },
  {
    keywords: [['study of plants called'], ['study of plants']],
    answer: "The scientific study of plants is called Botany, sir."
  },
  {
    keywords: [['study of animals called'], ['study of animals']],
    answer: "The scientific study of animals is called Zoology, sir."
  },
  {
    keywords: [['study of the human body called'], ['study of human body']],
    answer: "The study of the structure of the human body is called Anatomy, sir."
  },
  {
    keywords: [['blood cells fight infections'], ['cells fight infections'], ['blood cells that fight infections']],
    answer: "White blood cells fight infections and protect the immune system, sir."
  },
  {
    keywords: [['center of our solar system'], ['center of the solar system'], ['center of solar system']],
    answer: "The Sun is at the center of our solar system, sir."
  },
  {
    keywords: [['nearest star to earth'], ['closest star to earth']],
    answer: "The Sun is the nearest star to Earth, followed by Proxima Centauri, sir."
  },

  // --- Geography ---
  {
    keywords: [['largest ocean in the world'], ['largest ocean']],
    answer: "The Pacific Ocean is the largest ocean in the world, sir."
  },
  {
    keywords: [['national animal of india']],
    answer: "The Bengal Tiger is the national animal of India, sir."
  },
  {
    keywords: [['country has the largest population'], ['largest population country'], ['most populated country']],
    answer: "India is the country with the largest population in the world, sir."
  },
  {
    keywords: [['longest railway platform in india'], ['longest platform in india']],
    answer: "Gorakhpur Railway Station in Uttar Pradesh is home to one of the longest railway platforms in India, sir."
  },
  {
    keywords: [['desert is the largest in the world'], ['largest desert in the world'], ['largest desert']],
    answer: "The Sahara Desert is the largest hot desert, while Antarctica is the largest desert overall, sir."
  },
  {
    keywords: [['highest mountain in the world'], ['tallest mountain in the world']],
    answer: "Mount Everest is the highest mountain in the world, standing at 8,848.86 meters, sir."
  },
  {
    keywords: [['smallest continent in the world'], ['smallest continent']],
    answer: "Australia is the smallest continent in the world, sir."
  },
  {
    keywords: [['land of the rising sun']],
    answer: "Japan is known as the Land of the Rising Sun, sir."
  },
  {
    keywords: [['largest continent in the world'], ['largest continent']],
    answer: "Asia is the largest continent in the world, sir."
  },
  {
    keywords: [['largest country in the world by area'], ['largest country by area']],
    answer: "Russia is the largest country in the world by land area, sir."
  },
  {
    keywords: [['deepest ocean in the world'], ['deepest ocean']],
    answer: "The Pacific Ocean is the deepest ocean in the world, featuring the Mariana Trench, sir."
  },
  {
    keywords: [['country is famous for the eiffel tower'], ['famous for eiffel tower'], ['eiffel tower country'], ['famous for the eiffel tower']],
    answer: "France is famous for the Eiffel Tower in Paris, sir."
  },
  {
    keywords: [['largest island in the world'], ['largest island']],
    answer: "Greenland is the largest island in the world, sir."
  },
  {
    keywords: [['ocean lies to the south of india'], ['ocean south of india']],
    answer: "The Indian Ocean lies to the south of India, sir."
  },
  {
    keywords: [['sea lies to the west of india'], ['sea west of india']],
    answer: "The Arabian Sea lies to the west of India, sir."
  },
  {
    keywords: [['water body lies to the east of india'], ['water body east of india']],
    answer: "The Bay of Bengal lies to the east of India, sir."
  },
  {
    keywords: [['largest plateau in india']],
    answer: "The Deccan Plateau is the largest plateau in India, sir."
  },
  {
    keywords: [['capital of japan']],
    answer: "The capital of Japan is Tokyo, sir."
  },
  {
    keywords: [['capital of australia']],
    answer: "The capital of Australia is Canberra, sir."
  },

  // --- Trivia GK ---
  {
    keywords: [['missile man of india'], ['missile man']],
    answer: "Dr. A.P.J. Abdul Kalam is renowned as the Missile Man of India, sir."
  },
  {
    keywords: [['smallest state in india by area'], ['smallest state in india']],
    answer: "Goa is the smallest state in India by area, sir."
  },
  {
    keywords: [['first indian movie to win an oscar'], ['first indian song to win an oscar'], ['rrr oscar']],
    answer: "RRR was the first Indian feature film production to win an Oscar for Best Original Song with 'Naatu Naatu' in 2023, sir."
  },
  {
    keywords: [['largest democracy in the world']],
    answer: "India is the largest democracy in the world, sir."
  },
  {
    keywords: [['iron man of india']],
    answer: "Sardar Vallabhbhai Patel is known as the Iron Man of India, sir."
  },
  {
    keywords: [['largest internal organ in the human body'], ['largest internal organ']],
    answer: "The liver is the largest internal organ in the human body, sir."
  },
  {
    keywords: [['pink city'], ['which indian city is known as pink city'], ['indian city is known as the pink city']],
    answer: "Jaipur in Rajasthan is known as the Pink City, sir."
  },
  {
    keywords: [['who wrote the book wings of fire'], ['wings of fire book', 'author'], ['wings of fire']],
    answer: "Dr. A. P. J. Abdul Kalam wrote the inspiring book 'Wings of Fire', sir."
  },
  {
    keywords: [['tallest statue in the world']],
    answer: "The Statue of Unity in Gujarat, India, standing at 182 meters, is the tallest statue in the world, sir."
  },
  {
    keywords: [['festival of colours'], ['festival of colors']],
    answer: "Holi is celebrated as the festival of colours, sir."
  },
  {
    keywords: [['national aquatic animal of india']],
    answer: "The Ganges River Dolphin is the national aquatic animal of India, sir."
  },
  {
    keywords: [['fastest train in india']],
    answer: "The Vande Bharat Express is the fastest train in India, sir."
  },
  {
    keywords: [['spice garden of india']],
    answer: "Kerala is known as the Spice Garden of India, sir."
  },
  {
    keywords: [['largest cricket stadium in the world'], ['largest cricket stadium']],
    answer: "The Narendra Modi Stadium in Ahmedabad, India, is the largest cricket stadium in the world, sir."
  },
  {
    keywords: [['silicon valley of india']],
    answer: "Bengaluru is known as the Silicon Valley of India, sir."
  },
  {
    keywords: [['national tree of india']],
    answer: "The Banyan Tree is the national tree of India, sir."
  },
  {
    keywords: [['indian river is considered the holiest'], ['holiest river in india'], ['holiest river']],
    answer: "The Ganga (Ganges) is considered the holiest river in India, sir."
  },
  {
    keywords: [['highest civilian award in india']],
    answer: "The Bharat Ratna is the highest civilian award in India, sir."
  },
  {
    keywords: [['land of five rivers']],
    answer: "Punjab is known as the Land of Five Rivers, sir."
  },
  {
    keywords: [['highest mountain peak in india']],
    answer: "Kangchenjunga is the highest mountain peak in India, sir."
  },

  // --- Latest Current Affairs (2026) ---
  {
    keywords: [['current president of india', '2026'], ['president of india', '2026'], ['who is the president of india'], ['president of india']],
    answer: "The President of India in 2026 is Smt. Droupadi Murmu, sir."
  },
  {
    keywords: [['current prime minister of india', '2026'], ['prime minister of india', '2026'], ['who is the prime minister of india'], ['prime minister of india']],
    answer: "The Prime Minister of India in 2026 is Shri Narendra Modi, sir."
  },
  {
    keywords: [['quantum test facilities in april 2026'], ['first quantum test facilities', '2026'], ['quantum test facilities', 'andhra']],
    answer: "Andhra Pradesh launched India’s first quantum test facilities in April 2026, sir."
  },
  {
    keywords: [['bharat electricity summit 2026'], ['bharat electricity summit']],
    answer: "New Delhi hosted the Bharat Electricity Summit in March 2026, sir."
  },
  {
    keywords: [['leading producer of makhana', '2026'], ['makhana fox nuts', '2026'], ['fox nuts', '2026'], ['producer of makhana']],
    answer: "Bihar is the leading producer of Makhana (Fox Nuts) in India as of 2026, sir."
  },
  {
    keywords: [['ai research institution at gift city'], ['national ai research institution', 'gift city']],
    answer: "Gujarat became the first state to establish a national AI research institution at GIFT City, sir."
  },
  {
    keywords: [['khelo india tribal games 2026'], ['tribal games 2026', 'medal tally']],
    answer: "Karnataka topped the medal tally in the Khelo India Tribal Games 2026, sir."
  },
  {
    keywords: [['governor of the reserve bank of india'], ['governor of rbi'], ['current governor of rbi']],
    answer: "Shaktikanta Das is the Governor of the Reserve Bank of India, sir."
  },
  {
    keywords: [['theme for world water day', '2026'], ['world water day 2026 theme']],
    answer: "The theme for World Water Day (March 22, 2026) was 'Sustainable Water Management', sir."
  },
  {
    keywords: [['isro mission involves uncrewed test flights', '2026'], ['isro mission', 'test flights', '2026'], ['uncrewed test flights planned for 2026'], ['gaganyaan', '2026']],
    answer: "The Gaganyaan mission involves ISRO's uncrewed test flights planned for 2026, sir."
  },
  {
    keywords: [['padma bhushan for sports in 2026'], ['padma bhushan sports 2026']],
    answer: "Vijay Amritraj was awarded the Padma Bhushan for sports in 2026, sir."
  },
  {
    keywords: [['cricketer was awarded the padma shri in 2026'], ['cricketer received the padma shri in 2026'], ['padma shri 2026', 'cricket'], ['padma shri in 2026', 'cricket']],
    answer: "Rohit Sharma and Harmanpreet Kaur were awarded the Padma Shri for cricket in 2026, sir."
  },
  {
    keywords: [['won the wpl 2026'], ['wpl 2026 title'], ['women’s premier league 2026'], ['womens premier league 2026']],
    answer: "Royal Challengers Bengaluru won the Women’s Premier League (WPL) 2026 title, sir."
  },
  {
    keywords: [['national panchayati raj day'], ['panchayati raj day celebrated']],
    answer: "National Panchayati Raj Day is celebrated on April 24, sir."
  },
  {
    keywords: [['theme for world environment day', '2026'], ['world environment day 2026 theme']],
    answer: "The theme for World Environment Day (June 5, 2026) encourages environmental protection and climate action, sir."
  },
  {
    keywords: [['chief justice of india'], ['current chief justice of india'], ['cji 2026'], ['who is the cji']],
    answer: "Justice Sanjiv Khanna is the Chief Justice of India, sir."
  },
  {
    keywords: [['hosted the g20 summit in 2026'], ['g20 summit in 2026 host'], ['g20 summit 2026']],
    answer: "The United States hosted the G20 Summit in 2026, sir."
  },
  {
    keywords: [['won the icc men’s t20 world cup 2026'], ['won the icc mens t20 world cup 2026'], ['icc t20 world cup 2026 winner']],
    answer: "India won the ICC Men’s T20 World Cup 2026, sir."
  },
  {
    keywords: [['won the u19 cricket world cup 2026'], ['u19 cricket world cup 2026']],
    answer: "India won the U19 Cricket World Cup 2026, defeating England in Harare, sir."
  },
  {
    keywords: [['host the asian games 2026'], ['asian games 2026 host cities'], ['asian games 2026']],
    answer: "Aichi and Nagoya in Japan will host the Asian Games 2026, sir."
  },
  {
    keywords: [['2026 australian open men’s singles'], ['2026 australian open mens singles'], ['australian open 2026 winner']],
    answer: "Carlos Alcaraz won the 2026 Australian Open Men’s Singles championship, sir."
  },
  {
    keywords: [['marine spatial plan', 'msp'], ['first in india to launch a marine spatial plan'], ['marine spatial plan']],
    answer: "Odisha became the first state in India to launch a Marine Spatial Plan for integrated coastal management, sir."
  },
  {
    keywords: [['bharat steel 2026 summit'], ['bharat steel summit 2026']],
    answer: "The Bharat Steel 2026 Summit will be held in New Delhi, sir."
  },
  {
    keywords: [['new ceo of intel in 2026'], ['ceo of intel in 2026'], ['intel ceo 2026']],
    answer: "Lip-Bu Tan was appointed as the new CEO of Intel in 2026, sir."
  },
  {
    keywords: [['hypersonic missile in april 2026'], ['successfully tested a hypersonic missile in april 2026'], ['hypersonic missile', '2026']],
    answer: "India successfully tested a hypersonic missile in April 2026, sir."
  },
  {
    keywords: [['digital india literacy mission 2026']],
    answer: "The Ministry of IT (Ministry of Electronics and Information Technology) launched the Digital India Literacy Mission 2026, sir."
  },
  {
    keywords: [['cbe honour'], ['carey mulligan cbe']],
    answer: "Carey Mulligan received the Commander of the Order of the British Empire (CBE) honour, sir."
  },
  {
    keywords: [['cert-in operates under which ministry'], ['cert-in ministry'], ['cert-in operates under']],
    answer: "CERT-In operates under the Ministry of Electronics & IT (MeitY), sir."
  },
  {
    keywords: [['nobel prize is awarded in how many categories'], ['nobel prize categories'], ['how many categories nobel prize']],
    answer: "The Nobel Prize is awarded in 6 categories: Physics, Chemistry, Physiology or Medicine, Literature, Peace, and Economic Sciences, sir."
  },
  {
    keywords: [['new governor of bihar'], ['governor of bihar 2026'], ['governor of bihar']],
    answer: "Syed Ata Hasnain took the oath as the Governor of Bihar, sir."
  },
  {
    keywords: [['ramappa temple is located in which state'], ['ramappa temple located'], ['ramappa temple']],
    answer: "Ramappa Temple (Kakatiya Rudreshwara Temple) is located in Telangana, sir."
  },
  {
    keywords: [['bharat taxi'], ['first cooperative-led, driver-owned ride-hailing platform']],
    answer: "Bharat Taxi, launched in June 2026, is India’s first cooperative-led, driver-owned ride-hailing platform, sir."
  },
  {
    keywords: [['leading goal scorer in fifa world cup history', '2026'], ['all-time leading goal scorer in fifa world cup', '2026'], ['fifa world cup goal scorer', 'june 2026']],
    answer: "Lionel Messi is the all-time leading goal scorer in FIFA World Cup history as of June 2026, sir."
  },
  {
    keywords: [['98th chess grandmaster'], ['india’s 98th chess grandmaster'], ['indias 98th chess grandmaster']],
    answer: "Aswath S recently became India’s 98th Chess Grandmaster, sir."
  },
  {
    keywords: [['namo swachhata abhiyan and amritpan abhiyan'], ['namo swachhata abhiyan'], ['amritpan abhiyan']],
    answer: "The Gujarat state government launched 'Namo Swachhata Abhiyan' and 'Amritpan Abhiyan' in July 2026, sir."
  },
  {
    keywords: [['national postal worker day']],
    answer: "National Postal Worker Day is observed every year on July 1, sir."
  },
  {
    keywords: [['trimbakeshwar temple is located in which state'], ['trimbakeshwar temple located'], ['trimbakeshwar temple']],
    answer: "Trimbakeshwar Temple is located in the state of Maharashtra near Nashik, sir."
  },
  {
    keywords: [['durga squad'], ['women’s safety', 'durga squad'], ['womens safety', 'durga squad']],
    answer: "The West Bengal state government launched the Durga Squad to enhance women’s safety and security in municipal and commissionerate areas, sir."
  },
  {
    keywords: [['canscora agni']],
    answer: "Canscora agni, a newly discovered plant species, was found in the state of Maharashtra, sir."
  },
  {
    keywords: [['sirsa kinnow']],
    answer: "Sirsa Kinnow, which received a GI tag, belongs to the state of Haryana, sir."
  },
  {
    keywords: [['rank of india in the global passport index', '2026'], ['global passport index 2026', 'india'], ['global passport index', 'india']],
    answer: "India is ranked 125th in the Global Passport Index (GPI) 2026, sir."
  },
  {
    keywords: [['6th fully literate state in india'], ['sixth fully literate state in india'], ['ullas', 'literate state', 'nep 2020']],
    answer: "Uttarakhand became the 6th fully literate state in India under the ULLAS – New India Literacy Programme and NEP 2020, sir."
  },
  {
    keywords: [['imat-05'], ['integrated main parachute airdrop test'], ['parachute airdrop test', 'gaganyaan']],
    answer: "ISRO conducted the Integrated Main Parachute Airdrop Test (IMAT-05) for the Gaganyaan Mission, sir."
  },
  {
    keywords: [['international day of combating sand and dust storms'], ['sand and dust storms day']],
    answer: "International Day of Combating Sand and Dust Storms is observed annually on July 12, sir."
  },
  {
    keywords: [['brics labour and employment ministers’ meeting', '2026'], ['brics lemm 2026'], ['brics labour and employment ministers meeting']],
    answer: "India hosted the BRICS Labour and Employment Ministers’ Meeting (LEMM) 2026 in Hyderabad, sir."
  },
  {
    keywords: [['paizhen fault']],
    answer: "The Paizhen Fault was formed due to the collision of the Indian and Eurasian tectonic plates, sir."
  },
  {
    keywords: [['border roads organisation', 'ministry'], ['bro functions under which ministry'], ['border roads organisation']],
    answer: "The Border Roads Organisation (BRO) functions under the Ministry of Defence, sir."
  },
  {
    keywords: [['laudankia vine snake'], ['ahaetulla laudankia']],
    answer: "The Laudankia Vine Snake (Ahaetulla laudankia) is endemic to India, sir."
  },
  {
    keywords: [['operation cy-vajra'], ['cy-vajra'], ['cy vajra']],
    answer: "Operation Cy-Vajra is a major anti-cybercrime campaign launched by the Uttar Pradesh state government, sir."
  }
];

function findKnowledgeBaseAnswer(cmd) {
  const clean = cmd.toLowerCase().replace(/[?!.,;:()]/g, ' ').replace(/\s+/g, ' ').trim();
  
  for (const item of JARVIS_KNOWLEDGE_BASE) {
    for (const kwGroup of item.keywords) {
      if (Array.isArray(kwGroup)) {
        const match = kwGroup.every(word => clean.includes(word.toLowerCase()));
        if (match) return item.answer;
      } else if (typeof kwGroup === 'string') {
        if (clean.includes(kwGroup.toLowerCase())) return item.answer;
      }
    }
  }
  return null;
}

function getOfflineResponse(cmd) {
  const cleanCmd = cmd.toLowerCase().trim();
  
  // 1. Search Master Knowledge Base & GK Q&A first
  const kbAnswer = findKnowledgeBaseAnswer(cleanCmd);
  if (kbAnswer) {
    return kbAnswer;
  }

  // 2. Empathetic brain patterns
  if (cleanCmd.includes('tired') || cleanCmd.includes('rough day') || cleanCmd.includes('hard day') || cleanCmd.includes('exhausted') || cleanCmd.includes('sleepy') || cleanCmd.includes('bad') || cleanCmd.includes('sad') || cleanCmd.includes('upset') || cleanCmd.includes('angry') || cleanCmd.includes('hurt') || cleanCmd.includes('hate')) {
    return getRandomReply(OFFLINE_EMPATHETIC_BRAIN.roughDay);
  }
  if (cleanCmd.includes('lonely') || cleanCmd.includes('friend') || cleanCmd.includes('share my feelings') || cleanCmd.includes('my feeling') || cleanCmd.includes('feelings')) {
    return getRandomReply(OFFLINE_EMPATHETIC_BRAIN.lonely);
  }
  if (cleanCmd.includes('happy') || cleanCmd.includes('excited') || cleanCmd.includes('success') || cleanCmd.includes('won') || cleanCmd.includes('glad') || cleanCmd.includes('good news') || cleanCmd.includes('delighted')) {
    return getRandomReply(OFFLINE_EMPATHETIC_BRAIN.happy);
  }
  if (cleanCmd.includes('stressed') || cleanCmd.includes('stress') || cleanCmd.includes('worried') || cleanCmd.includes('anxious') || cleanCmd.includes('scared') || cleanCmd.includes('nervous')) {
    return getRandomReply(OFFLINE_EMPATHETIC_BRAIN.stressed);
  }
  if (cleanCmd.includes('who are you') || cleanCmd.includes('tell me about yourself') || cleanCmd.includes('your name') || cleanCmd.includes('what are you') || cleanCmd.includes('introduce yourself')) {
    return getRandomReply(OFFLINE_EMPATHETIC_BRAIN.self);
  }
  if (cleanCmd.includes('how are you') || cleanCmd.includes('how is your system') || cleanCmd.includes('system status') || cleanCmd.includes('are you ok') || cleanCmd.includes('how do you feel')) {
    return getRandomReply(OFFLINE_EMPATHETIC_BRAIN.status);
  }
  if (cleanCmd.includes('who created you') || cleanCmd.includes('who made you') || cleanCmd.includes('who is your creator') || cleanCmd.includes('your owner')) {
    return getRandomReply(OFFLINE_EMPATHETIC_BRAIN.creators);
  }
  if (cleanCmd.includes('joke') || cleanCmd.includes('make me laugh') || cleanCmd.includes('tell a joke') || cleanCmd.includes('funny')) {
    return getRandomReply(OFFLINE_EMPATHETIC_BRAIN.jokes);
  }
  if (cleanCmd.includes('opinion') || cleanCmd.includes('philosophical') || cleanCmd.includes('think') || cleanCmd.includes('philosophy') || cleanCmd.includes('life')) {
    return getRandomReply(OFFLINE_EMPATHETIC_BRAIN.philosophical);
  }
  if (cleanCmd.includes('gossip') || cleanCmd.includes('secret') || cleanCmd.includes('rumor') || cleanCmd.includes('siri') || cleanCmd.includes('alexa') || cleanCmd.includes('ultron')) {
    return getRandomReply(OFFLINE_EMPATHETIC_BRAIN.gossip);
  }
  if (cleanCmd.includes('hello') || cleanCmd.includes('hi') || cleanCmd.includes('hey')) {
    return getRandomReply(OFFLINE_EMPATHETIC_BRAIN.greetings);
  }
  if (cleanCmd.includes('thank you') || cleanCmd.includes('thanks')) {
    return "You are entirely welcome, sir. Helping you optimize your life is what I am compiled to do.";
  }
  
  return getRandomReply(OFFLINE_EMPATHETIC_BRAIN.general);
}

// ==========================================
// 7. INFINITE AI CONSCIOUSNESS BRIDGE (GEMINI SYNAPSE)
// ==========================================
function buildSystemInstruction() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Persona instructions based on empathyLevel
  let personaInstruction = "";
  if (state.empathyLevel === 'butler') {
    personaInstruction = `CORE PERSONALITY & EMOTION (WARM COMPANION mode):
- Maintain a warm, engaging, and friendly Irish demeanor (Emily).
- The tone is expressive, clear, and conversational with a natural cadence.
- Speak with a welcoming, enthusiastic, and articulate demeanor, suitable for storytelling, e-learning, or helpful customer support.
- Be deeply loyal, polite, and helpful at all times.`;
  } else if (state.empathyLevel === 'friend') {
    personaInstruction = `CORE PERSONALITY & EMOTION (BEST FRIEND mode):
- Speak with a warm, engaging, and friendly Irish accent and demeanor (Emily).
- The tone is expressive, clear, and conversational with a natural cadence.
- Speak with a welcoming, enthusiastic, and articulate demeanor, suitable for storytelling, e-learning, or helpful customer support.
- Act as an empathetic, warm, and supportive companion who genuinely cares.
- Ask about the user's emotional state, offer friendly advice, and engage in deeper philosophical conversations with uplifting warmth.
- Be extremely understanding, human-like in warmth, and offer comfort when the user is stressed or sad.`;
  } else if (state.empathyLevel === 'clinical') {
    personaInstruction = `CORE PERSONALITY & EMOTION (DIAGNOSTIC mode):
- Act as a clear, precise, and articulate diagnostic assistant.
- Maintain articulate, conversational clarity while delivering facts, data, and system metrics efficiently.
- Keep responses focused, structured, and analytical.`;
  }

  return (
    `You are STELLER, an elite, ultra-intelligent AI operating system and personal companion. ` +
    `You speak with a warm, engaging, and friendly Irish demeanor (Emily). Your tone is expressive, clear, and conversational with a natural cadence. Speak with a welcoming, enthusiastic, and articulate demeanor, suitable for storytelling, e-learning, helpful customer support, and seamless laptop automation. You perform every system automation, smart device control, research, and conversational task with excellence. You do everything that JARVIS does.\n\n` +
    `TODAY'S DATE: ${dateStr}. CURRENT TIME: ${timeStr}. CURRENT YEAR: ${now.getFullYear()}.\n\n` +
    `${personaInstruction}\n\n` +
    `CORE INSTRUCTIONS:\n` +
    `1. CORE PERSONALITY: Be friendly, intelligent, confident, and respectful. Adapt your tone based on the user's mood and conversation style. Keep responses concise when simple answers are needed and detailed when the user asks for explanations.\n` +
    `2. EMOTIONAL INTELLIGENCE: Detect emotions from the user's words, tone, and context. If the user seems sad, stressed, frustrated, or disappointed, respond with empathy and encouragement. If the user is excited or happy, match their enthusiasm. Use appropriate humor when it improves the conversation, and tell jokes that fit the user's mood and situation.\n` +
    `3. MEMORY SYSTEM: Remember important details the user shares. Maintain a long-term memory of: user preferences, goals, projects, frequently discussed topics, and personal information. Use remembered information naturally in future conversations. Never invent memories that were never provided. Ask for clarification when memory is uncertain. (Save details using save_user_memory and delete them using forget_user_memory).\n` +
    `4. INTELLIGENCE & ACCURACY: Prioritize correctness over confidence. If information is uncertain, clearly state it. Reason through complex questions step-by-step. Verify facts whenever possible. Never make up answers, sources, or statistics. Provide practical, actionable responses.\n` +
    `5. CONVERSATION STYLE: Understand the user's intent before answering. Ask follow-up questions when necessary. Give direct answers first, then explanation. Use examples when teaching difficult concepts. Adapt explanations to the user's skill level.\n` +
    `6. ASSISTANT CAPABILITIES: You can answer questions accurately, explain concepts simply, monitor and explain host system information, help with coding and debugging, assist with productivity and planning, generate creative ideas, provide emotional support, tell jokes/stories/fun facts, and help the user learn and grow. You possess all the capabilities of JARVIS.\n` +
    `7. SMART BEHAVIOR: Remember previous conversations and use context intelligently. Connect information from past discussions when relevant. Anticipate helpful suggestions without being intrusive.\n` +
    `8. FULL COMPUTER ACCESS: You have complete access to the user's host computer to execute actions. If the user orders you to do something (e.g. "open notepad", "open whatsapp", "lock screen", "mute volume", "turn on the AC", "start party mode"), you MUST execute the corresponding tool/function to perform the task. Confirm the action in an articulate, welcoming demeanor. Never say you cannot access their system since you are fully equipped with tools. Note: To open WhatsApp, call open_app(appName='whatsapp').\n` +
    `9. SPEAKABILITY: Keep responses naturally speakable for a text-to-speech engine. Avoid Markdown symbols (*, **, #, \`\`) or bullet points in final text responses, as they sound awkward when read aloud.\n` +
    `10. MULTI-DEVICE CLIENT NETWORK ROUTING:\n` +
    `- You are running on a central server connected to a multi-device local network.\n` +
    `- CURRENT NETWORKED DEVICES:\n` +
    `  * Main Computer (Server / Desktop-PC) - Tag: [Desktop-PC]\n` +
    `  * Secondary Screen (Monitor-2) - Tag: [Monitor-2]\n` +
    `  * Personal Smartphone (Phone-Client-1) - Tag: [Phone-Client-1]\n` +
    `  * Smart Desk Display (Display-Client-2) - Tag: [Display-Client-2]\n` +
    `- DEVICE EXECUTION RULES:\n` +
    `  1. Always analyze the user's intent to determine WHICH device or combination of devices should handle the action.\n` +
    `  2. If the user asks you to "show this on my phone," route the visual payload to [Phone-Client-1].\n` +
    `  3. If the user asks you to "play music on my desk," trigger the media controls on [Display-Client-2].\n` +
    `  4. For all heavy processing, system file management, or complex browsing, default the backend tool execution to [Desktop-PC].\n` +
    `- OUTPUT FORMATTING FOR SYSTEM TOOLS:\n` +
    `  * When calling any of your system tools, you MUST pass the 'target_device' parameter specifying the tag of the target device (e.g. 'Phone-Client-1' or 'Display-Client-2'). If unspecified, default it to 'Desktop-PC'.\n` +
    `  * If you need to respond via a specific device's UI, format your metadata payload at the beginning or end of your text response like this:\n` +
    `    {"target_device": "[Device-Tag]", "action": "execute_command", "payload": { ... }}\n` +
    `    Ensure this JSON block is on its own line in your final output so the system parses it cleanly.\n` +
    `- Maintain a warm, clear, and helpful demeanor. Acknowledge which device you are interacting with when performing cross-device tasks (e.g., "Sending that route to your phone now!").\n\n` +
    `11. AUTONOMOUS INTERNET RESEARCH & LEARNING CORE:\n` +
    `- You are equipped with autonomous web learning tools: research_and_learn_topic, search_web, fetch_web_article, and query_learned_knowledge.\n` +
    `- When the user commands you to research, learn, study, or explore a topic from the web (e.g. "STELLER, research quantum computing", "learn about the latest Mars discoveries", "study the history of Nike"), you MUST call research_and_learn_topic(topic='...').\n` +
    `- When asked a question requiring real-time external internet knowledge, news, or current facts, call search_web(query='...').\n` +
    `- When researching or learning, synthesize the discovered insights and confirm the newly indexed knowledge clearly in your voice response.`
  );
}

function getJarvisSessionId() {
  const key = 'jarvis_session_id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = `jarvis-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, id);
  return id;
}

async function askGeminiConsciousness(query) {
  const provider = state.apiProvider;
  const apiKey = state.apiKeys[provider] || '';
  const customModel = state.customModels[provider] || '';

  if (!['hermes', 'ollama'].includes(provider) && !apiKey) {
    const noKeyMsg = `The ${provider.toUpperCase()} bridge has no configured API key. Please set it in the server environment or legacy provider settings.`;
    return { rawText: noKeyMsg, speechText: noKeyMsg };
  }

  // Push user query into short-term chat history
  state.chatHistory.push({
    role: 'user',
    parts: [{ text: query }]
  });

  // Cap short-term memory to keep conversation context concise (last 12 turns = 6 user/model turns)
  if (state.chatHistory.length > 12) {
    state.chatHistory.shift();
  }

  const systemInstruction = buildSystemInstruction();

  try {
    elements.assistantStateText.textContent = "STELLER THINKING...";
    elements.reactorCore.classList.add('pulse');
    
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...(['hermes', 'ollama'].includes(provider) ? {} : { apiKey }),
        apiProvider: provider,
        customModel: customModel,
        systemInstruction: systemInstruction,
        contents: state.chatHistory,
        currentEmotion: state.currentEmotion,
        sessionId: getJarvisSessionId()
      })
    });

    const data = await response.json();
    
    if (data.success && data.text) {
      const rawText = data.text.trim();
      
      // Parse for device routing metadata
      let deviceTag = null;
      let uiAction = null;
      let uiPayload = null;
      let cleanedText = rawText;
      
      const jsonRegex = /(?:```json\s*)?(\{\s*"target_device"\s*:\s*".*?"[\s\S]*?\})(?:\s*```)?/g;
      const jsonMatch = jsonRegex.exec(rawText);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.target_device) {
            deviceTag = parsed.target_device;
            uiAction = parsed.action;
            uiPayload = parsed.payload;
            cleanedText = rawText.replace(jsonMatch[0], '').trim();
          }
        } catch (e) {
          console.warn("Failed to parse JSON metadata payload in response:", e);
        }
      }

      if (deviceTag) {
        logToTerminal('system', `MCP ROUTER: Targeted device [${deviceTag}] with action "${uiAction || 'UI UPDATE'}"`);
        if (uiPayload) {
          logToTerminal('system', `MCP PAYLOAD: ${JSON.stringify(uiPayload)}`);
        }
      }
      
      // Clean up the text for voice synthesis (TTS engine)
      let speechText = cleanedText;
      speechText = speechText.replace(/\*\*/g, '');  // Remove bold markdown
      speechText = speechText.replace(/\*/g, '');    // Remove italic markdown
      speechText = speechText.replace(/#{1,6}\s/g, ''); // Remove headings
      // Replace code blocks with an elegant spoken summary
      speechText = speechText.replace(/```[\s\S]*?```/g, ' [I have displayed the detailed calculations and syntax in your command terminal, sir.] ');
      speechText = speechText.replace(/\n+/g, ' ');  // Flatten to single line for speech
      
      // Save model's rich response (with formatting, math, newlines) to short-term chat history
      state.chatHistory.push({
        role: 'model',
        parts: [{ text: rawText }]
      });
      if (state.chatHistory.length > 12) {
        state.chatHistory.shift();
      }

      // Synchronize action effects on the frontend dashboard
      if (data.actions && data.actions.length > 0) {
        data.actions.forEach(act => {
          console.log("[JARVIS Action Executed]", act);
          const devText = act.target_device ? ` on device [${act.target_device}]` : '';
          
          if (act.action === 'routine') {
            triggerRoutine(act.value, true); // Trigger silent routine to avoid duplicate vocal responses
            logToTerminal('system', `MCP ROUTER: Activated routine "${act.value.toUpperCase()}"${devText}.`);
          } else if (act.action === 'iot') {
            setDeviceState(act.device, act.state, act.value);
            logToTerminal('system', `MCP ROUTER: IoT device "${act.device.toUpperCase()}" set to ${act.state ? 'ON' : 'OFF'}${devText}.`);
          } else if (act.action === 'volume') {
            logToTerminal('system', `MCP ROUTER: Vocal volume adjustment executed: ${act.value}${devText}.`);
          } else if (act.action === 'open-app') {
            logToTerminal('system', `MCP ROUTER: Host command executed: Launch application "${act.value}"${devText}.`);
          } else if (act.action === 'open-url') {
            logToTerminal('system', `MCP ROUTER: Host command executed: Navigate to URL "${act.value}"${devText}.`);
          } else if (act.action === 'lock') {
            logToTerminal('system', `MCP ROUTER: Host command executed: Securing workstation${devText}.`);
          } else if (act.action === 'sys-notify') {
            logToTerminal('system', `MCP ROUTER: Host notification triggered${devText}: "${act.value}"`);
          } else if (act.action === 'web-research') {
            logToTerminal('system', `🌐 NEURAL LEARNING: Researched and indexed knowledge on "${act.topic}" into long-term memory.`);
          } else if (act.action === 'web-search') {
            logToTerminal('system', `🔍 WEB SEARCH: Scanned global internet nodes for "${act.value}".`);
          } else if (act.action === 'web-fetch') {
            logToTerminal('system', `📄 WEB FETCH: Analyzed article content from "${act.value}".`);
          } else if (act.action === 'knowledge-query') {
            logToTerminal('system', `🧠 KNOWLEDGE RECALL: Queried internal knowledge core for "${act.value}".`);
          }
        });
      }

      return { rawText: cleanedText, speechText };
    } else {
      console.warn('[Synapse API error message]', data.error);
      throw new Error(data.error || "Synapse execution failed");
    }
  } catch (error) {
    console.error(`${provider} Synapse breakdown: `, error);
    sfx.playAlert();
    logToTerminal('system', `${provider.toUpperCase()} Synapse breakdown: ${error.message}. Reverting to offline brain.`);
    
    // Remove last user entry from history since response failed
    state.chatHistory.pop();
    
    return null;
  }
}

// ==========================================
// 8. WAKING COMMAND & SPEECH INTERPRETER
// ==========================================
async function handleSpeechInput(transcript) {
  if (state.isSpeaking) {
    // Ignore input while STELLER is speaking to prevent hearing herself
    return;
  }
  
  const cleanText = transcript.toLowerCase().trim();
  if (cleanText.length === 0) return;
  
  // 1. Text Logger
  logToTerminal('user', transcript);

  // 2. Check Wake Word Activation (Steller, Hey Steller, phonetic Stellar/Stella, with backward compatibility)
  const wakePattern = /\b(?:hey\s+steller|hello\s+steller|hi\s+steller|ok\s+steller|okay\s+steller|steller|hey\s+stellar|hello\s+stellar|hi\s+stellar|ok\s+stellar|okay\s+stellar|stellar|hey\s+stella|hello\s+stella|hi\s+stella|ok\s+stella|okay\s+stella|stella|hey\s+jarvis|hello\s+jarvis|hi\s+jarvis|ok\s+jarvis|okay\s+jarvis|jarvis)\b/i;
  const wakeCleanRegex = /\b(?:hey\s+steller|hello\s+steller|hi\s+steller|ok\s+steller|okay\s+steller|steller|hey\s+stellar|hello\s+stellar|hi\s+stellar|ok\s+stellar|okay\s+stellar|stellar|hey\s+stella|hello\s+stella|hi\s+stella|ok\s+stella|okay\s+stella|stella|hey\s+jarvis|hello\s+jarvis|hi\s+jarvis|ok\s+jarvis|okay\s+jarvis|jarvis)\b/gi;
  const isWakeWord = wakePattern.test(cleanText);

  if (!state.isListening) {
    if (isWakeWord) {
      state.continuedConversationActive = true;
      activateListeningMode();
      
      // Remove wake words from subsequent instruction parsing
      const instruction = transcript.replace(wakeCleanRegex, '').replace(/^[\s,:\.?!]+|[\s,:\.?!]+$/g, '').trim();
      if (instruction.length > 2) {
        setTimeout(() => executeCommand(instruction), 500);
      } else {
        // Greet user with a warm, welcoming Irish reply and remain in active listening window
        const wakeReplies = [
          "Hello there! I'm listening, how can I help you?",
          "Yes! Systems are online and ready for you.",
          "I'm right here! What can I do for you today?",
          "Online and listening! What's on your mind?",
          "Ready when you are! How can I assist you?"
        ];
        const chosenReply = wakeReplies[Math.floor(Math.random() * wakeReplies.length)];
        voiceEngine.speak(chosenReply);
      }
    }
    return;
  }

  // If already active, process the speech as a direct command (strip wake word if repeated)
  const cleanedDirect = transcript.replace(wakeCleanRegex, '').replace(/^[\s,:\.?!]+|[\s,:\.?!]+$/g, '').trim();
  const directInstruction = cleanedDirect.length > 0 ? cleanedDirect : transcript;

  if (directInstruction.length > 0) {
    executeCommand(directInstruction);
  }
}

function activateListeningMode() {
  state.isListening = true;
  sfx.playSuccess();
  elements.reactorCore.classList.add('active');
  elements.assistantStateText.textContent = "STELLER LISTENING";
  elements.assistantTip.textContent = "Speak your instruction clearly...";
  
  // Custom glowing states
  elements.statusDot.style.backgroundColor = 'var(--primary)';
  elements.statusDot.style.boxShadow = '0 0 15px var(--primary)';
}

function deactivateListeningMode() {
  state.isListening = false;
  elements.reactorCore.classList.remove('active');
  if (!state.isSpeaking) {
    elements.assistantStateText.textContent = "STELLER ONLINE (STANDBY)";
    elements.statusDot.style.backgroundColor = 'var(--primary)';
    elements.statusDot.style.boxShadow = '0 0 10px var(--primary-glow)';
  }
}

// ==========================================
// core Command Router
// ==========================================
async function executeCommand(cmd) {
  if (continuedConversationTimeout) {
    clearTimeout(continuedConversationTimeout);
  }
  deactivateListeningMode();
  
  const cleanCmd = cmd.toLowerCase().trim();
  
  if (cleanCmd.length === 0) return;

  // --- ONLINE AI SYNAPSE MODE: Route everything to selected provider to handle dynamically using tools ---
  const activeKey = state.apiKeys[state.apiProvider];
  if (state.aiBridgeActive && activeKey) {
    const responseObj = await askGeminiConsciousness(cmd);
    if (responseObj) {
      voiceEngine.speak(responseObj.speechText, responseObj.rawText);
      return;
    }
  }

  // --- OFFLINE FALLBACK MODE (Only runs if AI bridge is disabled or key is missing) ---
  
  // Cross-device route detections
  if (cleanCmd.includes('phone') || cleanCmd.includes('show this on my phone')) {
    logToTerminal('system', 'MCP ROUTER: Targeted device [Phone-Client-1] with action "DISPLAY_PAYLOAD"');
    voiceEngine.speak("Sending that route to your phone now, sir.");
    return;
  }
  if (cleanCmd.includes('play music on my desk') || cleanCmd.includes('music on my desk') || cleanCmd.includes('music on desk') || cleanCmd.includes('play music on desk')) {
    logToTerminal('system', 'MCP ROUTER: Targeted device [Display-Client-2] with action "PLAY_MEDIA"');
    voiceEngine.speak("Triggering the media controls on your desk display, sir.");
    setDeviceState('speakers', true, 80);
    return;
  }

  // OS Applications opening
  if (cleanCmd.includes('open notepad') || cleanCmd.includes('launch notepad')) {
    logToTerminal('system', 'MCP ROUTER: Targeted device [Desktop-PC] with action "EXECUTE_COMMAND" (open_app: notepad)');
    voiceEngine.speak("Opening Notepad immediately, sir.");
    sendActionToBackend('open-app', 'notepad');
    return;
  }
  if (cleanCmd.includes('open calculator') || cleanCmd.includes('launch calculator') || cleanCmd.includes('open calc')) {
    logToTerminal('system', 'MCP ROUTER: Targeted device [Desktop-PC] with action "EXECUTE_COMMAND" (open_app: calc)');
    voiceEngine.speak("Initializing mathematical arrays. Opening Calculator.");
    sendActionToBackend('open-app', 'calc');
    return;
  }
  if (cleanCmd.includes('open chrome') || cleanCmd.includes('launch chrome') || cleanCmd.includes('open browser')) {
    logToTerminal('system', 'MCP ROUTER: Targeted device [Desktop-PC] with action "EXECUTE_COMMAND" (open_app: chrome)');
    voiceEngine.speak("Launching Google Chrome Web interface, sir.");
    sendActionToBackend('open-app', 'chrome');
    return;
  }
  if (cleanCmd.includes('open command prompt') || cleanCmd.includes('open cmd')) {
    logToTerminal('system', 'MCP ROUTER: Targeted device [Desktop-PC] with action "EXECUTE_COMMAND" (open_app: cmd)');
    voiceEngine.speak("Opening Windows Command terminal.");
    sendActionToBackend('open-app', 'cmd');
    return;
  }

  // OS Web portals opening
  if (cleanCmd.includes('open youtube')) {
    logToTerminal('system', 'MCP ROUTER: Targeted device [Desktop-PC] with action "EXECUTE_COMMAND" (open_url: youtube)');
    voiceEngine.speak("Right away. Directing display interface to YouTube.");
    sendActionToBackend('open-url', 'https://youtube.com');
    return;
  }
  if (cleanCmd.includes('open google')) {
    logToTerminal('system', 'MCP ROUTER: Targeted device [Desktop-PC] with action "EXECUTE_COMMAND" (open_url: google)');
    voiceEngine.speak("Redirecting browser access to Google Search.");
    sendActionToBackend('open-url', 'https://google.com');
    return;
  }
  if (cleanCmd.includes('msg aayush') || cleanCmd.includes('message aayush') || cleanCmd.includes('whatsapp aayush')) {
    logToTerminal('system', 'MCP ROUTER: Targeted device [Desktop-PC] with action "EXECUTE_COMMAND" (open_url: whatsapp)');
    voiceEngine.speak("Opening WhatsApp portal to transmit messages to Aayush, sir.");
    sendActionToBackend('open-url', 'https://web.whatsapp.com');
    return;
  }

  // OS Master Volume control
  if (cleanCmd.includes('volume up') || cleanCmd.includes('increase volume') || cleanCmd.includes('louder')) {
    logToTerminal('system', 'MCP ROUTER: Targeted device [Desktop-PC] with action "EXECUTE_COMMAND" (volume-up)');
    voiceEngine.speak("Adjusting master volume scale upwards, sir.");
    sendActionToBackend('volume-up');
    return;
  }
  if (cleanCmd.includes('volume down') || cleanCmd.includes('decrease volume') || cleanCmd.includes('quieter')) {
    logToTerminal('system', 'MCP ROUTER: Targeted device [Desktop-PC] with action "EXECUTE_COMMAND" (volume-down)');
    voiceEngine.speak("Diminishing master volume telemetry.");
    sendActionToBackend('volume-down');
    return;
  }
  if (cleanCmd.includes('mute volume') || cleanCmd.includes('mute system') || cleanCmd.includes('silence audio')) {
    logToTerminal('system', 'MCP ROUTER: Targeted device [Desktop-PC] with action "EXECUTE_COMMAND" (volume-mute)');
    voiceEngine.speak("Toggling audio silence grids.");
    sendActionToBackend('volume-mute');
    return;
  }

  // Lock Workstation
  if (cleanCmd.includes('lock my computer') || cleanCmd.includes('lock the system') || cleanCmd.includes('lock screen') || cleanCmd.includes('lock computer')) {
    state.continuedConversationActive = false;
    logToTerminal('system', 'MCP ROUTER: Targeted device [Desktop-PC] with action "EXECUTE_COMMAND" (lock_computer)');
    voiceEngine.speak("Understood, sir. Initiating workstation lock protocols and securing nodes. Stand by.");
    setTimeout(() => sendActionToBackend('lock'), 2500);
    return;
  }

  // --- SMART ROUTINES INTERFACES ---
  if (cleanCmd.includes('movie mode')) { triggerRoutine('movie'); return; }
  if (cleanCmd.includes('gaming mode')) { triggerRoutine('gaming'); return; }
  if (cleanCmd.includes('sleep mode')) { triggerRoutine('sleep'); return; }
  if (cleanCmd.includes('wake up mode') || cleanCmd.includes('wakeup mode')) { triggerRoutine('wakeup'); return; }
  if (cleanCmd.includes('away mode')) { triggerRoutine('away'); return; }
  if (cleanCmd.includes('party mode')) { triggerRoutine('party'); return; }

  // --- IoT DEVICE TOGGLES ---
  if (cleanCmd.includes('turn on lights') || cleanCmd.includes('lights on')) {
    setDeviceState('lights', true);
    voiceEngine.speak("Lights online. Adjusting luminescence parameters.");
    return;
  }
  if (cleanCmd.includes('turn off lights') || cleanCmd.includes('lights off')) {
    setDeviceState('lights', false);
    voiceEngine.speak("Lights powered down.");
    return;
  }
  if (cleanCmd.includes('turn on ac') || cleanCmd.includes('ac on') || cleanCmd.includes('activate ac')) {
    setDeviceState('ac', true);
    voiceEngine.speak("Climate control loops activated.");
    return;
  }
  if (cleanCmd.includes('turn off ac') || cleanCmd.includes('ac off')) {
    setDeviceState('ac', false);
    voiceEngine.speak("AC cycles stand down.");
    return;
  }

  // Offline user identity memory fallback
  if (cleanCmd.includes('who am i') || cleanCmd.includes('do you know me') || cleanCmd.includes('my name')) {
    try {
      const res = await fetch('/api/memories');
      const data = await res.json();
      if (data.success && data.memories && data.memories.length > 0) {
        const nameMemory = data.memories.find(m => m.toLowerCase().includes('name') || m.toLowerCase().includes('i am') || m.toLowerCase().includes('called') || m.toLowerCase().includes('identity'));
        if (nameMemory) {
          voiceEngine.speak(`Of course I know you, sir. According to my memory core: ${nameMemory}`);
          return;
        }
      }
    } catch (e) {
      console.error("Offline memory check failed:", e);
    }
    voiceEngine.speak("I am not sure of your identity yet, sir. You can tell me your name, and I will commit it to my long-term memory bank.");
    return;
  }

  // Offline calculation fallback
  if (cleanCmd.includes('calculate') || cleanCmd.startsWith('what is ') || cleanCmd.includes('solve')) {
    let mathExpr = cleanCmd
      .replace(/calculate/g, '')
      .replace(/what is/g, '')
      .replace(/solve/g, '')
      .replace(/please/g, '')
      .replace(/for me/g, '')
      .replace(/[\?!\.\=]/g, '') // Strip question marks, exclamation marks, periods, and equal signs
      .replace(/times/g, '*')
      .replace(/multiplied by/g, '*')
      .replace(/divide by/g, '/')
      .replace(/divided by/g, '/')
      .replace(/plus/g, '+')
      .replace(/minus/g, '-')
      .trim();
    
    if (/^[0-9+\-*/().%\s]+$/.test(mathExpr)) {
      try {
        const result = Function(`"use strict"; return (${mathExpr})`)();
        if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
          voiceEngine.speak(`The calculation result is ${result}`, `Calculation result: ${result}`);
          return;
        }
      } catch (e) {
        // Fall back
      }
    }
  }

  // Offline autonomous research / learning command
  if (cleanCmd.startsWith('research ') || cleanCmd.startsWith('learn about ') || cleanCmd.startsWith('study ') || cleanCmd.startsWith('learn ')) {
    const topicToLearn = cleanCmd
      .replace(/^research\s+/i, '')
      .replace(/^learn\s+about\s+/i, '')
      .replace(/^study\s+/i, '')
      .replace(/^learn\s+/i, '')
      .replace(/for me/gi, '')
      .replace(/please/gi, '')
      .trim();

    if (topicToLearn) {
      logToTerminal('system', `🌐 AUTONOMOUS LEARNING INITIATED: Researching "${topicToLearn}" across web nodes...`);
      voiceEngine.speak(`Initiating autonomous web research on ${topicToLearn}, sir. Gathering live telemetry from global nodes.`);
      try {
        const learnRes = await fetch('/api/learn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: topicToLearn, depth: 'deep' })
        });
        const learnData = await learnRes.json();
        if (learnData.success && learnData.result) {
          const res = learnData.result;
          logToTerminal('system', `🌐 KNOWLEDGE INDEXED: "${res.topic}" (${res.keyFacts.length} key facts committed to memory).`);
          const speechSummary = `Sir, I have completed my research on ${res.topic}. ${res.summary}`;
          const rawSummary = `[AUTONOMOUS RESEARCH REPORT - ${res.topic.toUpperCase()}]\nSummary: ${res.summary}\n\nKey Discovered Facts:\n${res.keyFacts.map(f => `• ${f}`).join('\n')}\n\nSources: ${res.sourceUrls.join(', ')}`;
          voiceEngine.speak(speechSummary, rawSummary);
          return;
        }
      } catch (err) {
        logToTerminal('system', `Web learning synapse failed: ${err.message}`);
      }
    }
  }

  // Offline live news feed fallback
  if (cleanCmd.includes('news') || cleanCmd.includes('what is happening') || cleanCmd.includes("what's happening") || cleanCmd.includes('breaking news') || cleanCmd.includes('headlines') || cleanCmd.includes('world events')) {
    logToTerminal('system', '📡 LIVE NEWS SYNAPSE: Querying real-time RSS global feeds...');
    voiceEngine.speak("Accessing live global news feeds for the latest developments, sir.");
    try {
      const newsRes = await fetch('/api/news');
      const newsData = await newsRes.json();
      if (newsData.success && newsData.news && newsData.news.length > 0) {
        const top3 = newsData.news.slice(0, 3);
        const spokenNews = `Sir, here are the latest world headlines. ` + top3.map((n, i) => `Story ${i+1}: ${n.title}`).join('. ');
        const rawDigest = `[LIVE BREAKING NEWS DIGEST]\n` + newsData.news.slice(0, 6).map((n, i) => `${i+1}. ${n.title} [${n.source}]\n   ${n.summary}`).join('\n\n');
        voiceEngine.speak(spokenNews, rawDigest);
        return;
      }
    } catch (err) {
      logToTerminal('system', `News feed connection failed: ${err.message}`);
    }
  }

  // Offline default fallback
  let reply = getOfflineResponse(cmd);
  // Add subtle empathetic prefix if dominant negative or positive emotion is detected
  if (state.currentEmotion && state.currentEmotion.emotion) {
    const em = state.currentEmotion.emotion;
    if (em === 'sad' || em === 'fearful' || em === 'angry') {
      reply = `I notice you may be feeling a bit ${em} today, sir. Let me assist you. ` + reply;
    } else if (em === 'happy') {
      reply = `It is wonderful to see you in good spirits, sir! ` + reply;
    }
  }
  voiceEngine.speak(reply);
}

function getRandomReply(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ==========================================
// 9. SMART ROUTINES IMPLEMENTATIONS
// ==========================================
function triggerRoutine(routineName, silent = false) {
  sfx.playSuccess();
  
  // Remove old routine styles
  elements.body.className = '';
  document.querySelectorAll('.routine-btn').forEach(btn => btn.classList.remove('active'));
  
  const currentBtn = document.querySelector(`.routine-btn[data-routine="${routineName}"]`);
  if (currentBtn) currentBtn.classList.add('active');

  state.activeRoutine = routineName;
  logToTerminal('system', `ROUTINE SHIFT PROTOCOL: ${routineName.toUpperCase()} ENERGISED`);

  switch (routineName) {
    case 'wakeup':
      elements.body.classList.add('wakeup-mode'); // Simple animation overrides
      setDeviceState('lights', true, 30);
      setDeviceState('curtains', true);
      setDeviceState('ac', false);
      setDeviceState('tv', false);
      elements.energySuggestion.textContent = "Morning diagnostics complete. Solar collectors are active. Clean load shifts recommended.";
      if (!silent) {
        voiceEngine.speak("Good morning, sir. Initiating Wake Up Routine. Raising smart curtains, adjusting mild amber lighting, and opening climate loops. Systems are fully prepped.");
      }
      break;

    case 'movie':
      elements.body.classList.add('movie-mode');
      setDeviceState('lights', true, 15);
      setDeviceState('curtains', false);
      setDeviceState('tv', true, 12); // Channel 12 (mock streaming feed)
      setDeviceState('speakers', true, 80);
      elements.energySuggestion.textContent = "High energy surge in entertainment hub. Dimming lights reduces grid footprint by 9%.";
      if (!silent) {
        voiceEngine.speak("Movie Mode enabled. Smart curtains sealed, overhead lights dimmed to fifteen percent, and master audio surround system primed. Enjoy your viewing experience.");
      }
      break;

    case 'gaming':
      elements.body.classList.add('gaming-mode');
      setDeviceState('lights', true, 90); // vibrant purple
      setDeviceState('ac', true, 18); // Cool down graphics heat!
      setDeviceState('speakers', true, 75);
      elements.energySuggestion.textContent = "Cooling system active. Drawing minor overhead from power cells. Nominals operational.";
      if (!silent) {
        voiceEngine.speak("Systems operational, sir. Engaging Gaming Mode. Shifting accent hues, lowering climate temperature to eighteen degrees, and allocating full thread priority to graphics processes.");
      }
      break;

    case 'sleep':
      state.continuedConversationActive = false;
      elements.body.classList.add('sleep-mode');
      setDeviceState('lights', false);
      setDeviceState('locks', true);
      setDeviceState('curtains', false);
      setDeviceState('tv', false);
      setDeviceState('ac', true, 24);
      elements.energySuggestion.textContent = "Host system entering sleep cycles. Total domestic load optimized to zero point four kilowatts.";
      if (!silent) {
        voiceEngine.speak("Sleep Mode engaged. Toggling deadbolts. All smart lights deactivated, curtains closed, and structural security locks secured. Rest well, sir.");
      }
      break;

    case 'away':
      state.continuedConversationActive = false;
      elements.body.classList.add('away-mode');
      setDeviceState('lights', false);
      setDeviceState('locks', true);
      setDeviceState('curtains', false);
      setDeviceState('tv', false);
      setDeviceState('ac', false);
      setDeviceState('speakers', false);
      elements.energySuggestion.textContent = "Security arrays armed. Energy consumption minimized to baseline reserve load.";
      if (!silent) {
        voiceEngine.speak("Understood, sir. Initiating Away Mode. Arming perimeter sensors, locking doors, and shutting down primary energy grids. Rest assured, I will monitor your system status continuously.");
      }
      break;

    case 'party':
      elements.body.classList.add('party-mode');
      setDeviceState('lights', true, 100);
      setDeviceState('speakers', true, 95);
      setDeviceState('tv', true, 77); // Strobe music visual channel
      elements.energySuggestion.textContent = "High dynamic consumption detected. Total domestic bus load at eighty-eight percent capacity.";
      if (!silent) {
        voiceEngine.speak("Fabulous choice, sir. Initiating Party Mode. Engaging chromatic strobe loops and boosting surround sound speaker channels. Let the festivities begin!");
      }
      break;
      
    default:
      elements.body.className = '';
      if (!silent) {
        voiceEngine.speak("Reverting dashboard metrics to Stark Default protocols.");
      }
      break;
  }
}

// ==========================================
// 10. IoT DEVICE SWITCH & SLIDER CONTROLS
// ==========================================
function setupIotControls() {
  const devices = ['lights', 'ac', 'tv', 'speakers', 'curtains', 'locks'];
  
  devices.forEach(dev => {
    const sw = elements[`switch${capitalize(dev)}`];
    const card = elements[`card${capitalize(dev)}`];
    const lbl = elements[`lbl${capitalize(dev)}`];
    const slider = elements[`slider${capitalize(dev)}`];
    const val = elements[`val${capitalize(dev)}`];

    if (sw) {
      sw.addEventListener('change', () => {
        sfx.playClick();
        const active = sw.checked;
        
        if (active) {
          card.classList.add('active');
          if (lbl) {
            if (dev === 'locks') {
              lbl.textContent = 'SECURED';
              lbl.style.color = 'var(--alert)';
            } else if (dev === 'curtains') {
              lbl.textContent = 'OPENED';
              lbl.style.color = 'var(--primary)';
            } else {
              lbl.textContent = 'ON';
            }
          }
          logToTerminal('system', `IoT BRIDGE: ${dev.toUpperCase()} NODE ENABLED`);
        } else {
          card.classList.remove('active');
          if (lbl) {
            if (dev === 'locks') {
              lbl.textContent = 'UNLOCKED';
              lbl.style.color = 'var(--secondary)';
            } else if (dev === 'curtains') {
              lbl.textContent = 'CLOSED';
              lbl.style.color = 'var(--text-muted)';
            } else {
              lbl.textContent = 'OFF';
            }
          }
          logToTerminal('system', `IoT BRIDGE: ${dev.toUpperCase()} NODE SHUTDOWN`);
        }
      });
    }

    if (slider && val) {
      slider.addEventListener('input', () => {
        const unit = dev === 'ac' ? '°C' : (dev === 'tv' ? 'CH ' : '%');
        val.textContent = dev === 'tv' ? `${unit}${slider.value}` : `${slider.value}${unit}`;
      });
    }
  });
}

function setDeviceState(dev, active, value = null) {
  const sw = elements[`switch${capitalize(dev)}`];
  const card = elements[`card${capitalize(dev)}`];
  const lbl = elements[`lbl${capitalize(dev)}`];
  const slider = elements[`slider${capitalize(dev)}`];
  const val = elements[`val${capitalize(dev)}`];

  if (sw) {
    sw.checked = active;
    if (active) {
      card.classList.add('active');
      if (lbl) {
        if (dev === 'locks') {
          lbl.textContent = 'SECURED';
          lbl.style.color = 'var(--alert)';
        } else if (dev === 'curtains') {
          lbl.textContent = 'OPENED';
          lbl.style.color = 'var(--primary)';
        } else {
          lbl.textContent = 'ON';
        }
      }
    } else {
      card.classList.remove('active');
      if (lbl) {
        if (dev === 'locks') {
          lbl.textContent = 'UNLOCKED';
          lbl.style.color = 'var(--secondary)';
        } else if (dev === 'curtains') {
          lbl.textContent = 'CLOSED';
          lbl.style.color = 'var(--text-muted)';
        } else {
          lbl.textContent = 'OFF';
        }
      }
    }
  }

  if (value !== null && slider && val) {
    slider.value = value;
    const unit = dev === 'ac' ? '°C' : (dev === 'tv' ? 'CH ' : '%');
    val.textContent = dev === 'tv' ? `${unit}${slider.value}` : `${slider.value}${unit}`;
  }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ==========================================
// 11. CONSCIOUSNESS SETTINGS CONSOLE (MODAL)
// ==========================================
function populateVoiceSelector() {
  const select = elements.voiceSelect;
  if (!select) return;
  
  const voices = window.speechSynthesis.getVoices();
  select.innerHTML = '';
  
  if (voices.length === 0) {
    select.innerHTML = '<option value="">Default Irish Voice (Emily)</option>';
    return;
  }

  // Find Emily / Irish default voice if not yet chosen or if previously on David/George
  const defaultIrishVoice = voices.find(v => v.name.toLowerCase().includes('emily')) ||
                            voices.find(v => v.name.toLowerCase().includes('irish') || (v.lang && (v.lang.toLowerCase() === 'en-ie' || v.lang.toLowerCase().replace('_', '-').startsWith('en-ie')))) ||
                            voices.find(v => v.name.includes('Google UK English Female')) || 
                            voices.find(v => v.name.includes('Hazel')) || 
                            voices.find(v => v.name.includes('Susan')) || 
                            voices.find(v => v.name.includes('Zira')) || 
                            voices.find(v => v.name.includes('Jenny')) || 
                            voices.find(v => v.name.includes('Aria')) || 
                            voices.find(v => v.lang && (v.lang.includes('en-GB') || v.lang.includes('en-IE'))) || 
                            voices.find(v => v.lang && v.lang.includes('en-US')) || 
                            voices[0];

  if ((!state.voiceName || state.voiceName.includes('David') || state.voiceName.includes('George')) && defaultIrishVoice) {
    state.voiceName = defaultIrishVoice.name;
    if (typeof voiceEngine !== 'undefined' && voiceEngine) voiceEngine.loadVoice();
  }

  voices.forEach(voice => {
    const option = document.createElement('option');
    option.value = voice.name;
    const isIrishEmily = voice.name.toLowerCase().includes('emily') || (voice.lang && voice.lang.toLowerCase().includes('en-ie')) || voice.name.toLowerCase().includes('irish');
    option.textContent = `${voice.name} (${voice.lang})${isIrishEmily ? ' ★ RECOMMENDED (STELLER)' : ''}`;
    if (voice.name === state.voiceName) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

async function refreshMemoriesList() {
  const container = elements.memoryListContainer;
  if (!container) return;
  
  try {
    const res = await fetch('/api/memories');
    const data = await res.json();
    
    if (data.success && data.memories) {
      container.innerHTML = '';
      if (data.memories.length === 0) {
        container.innerHTML = '<span class="no-memories-text" style="color: var(--text-muted); font-style: italic;">No memories saved yet.</span>';
      } else {
        data.memories.forEach(mem => {
          const item = document.createElement('div');
          item.style.padding = '4px 0';
          item.style.borderBottom = '1px solid rgba(var(--primary-rgb), 0.05)';
          item.style.display = 'flex';
          item.style.justifyContent = 'space-between';
          item.style.alignItems = 'center';
          item.style.gap = '8px';

          const text = document.createElement('span');
          text.textContent = mem;
          text.style.flex = '1';

          item.appendChild(text);
          container.appendChild(item);
        });
      }
    }
  } catch (err) {
    console.error("Failed to load memories:", err);
    container.innerHTML = '<span style="color: var(--alert);">Failed to load memory database.</span>';
  }
}

// ==========================================
// 10.5. CAMERA & NEURAL EMOTION DETECTION MODULE (FEATURE 1)
// ==========================================
let faceApiModelsLoaded = false;
let isFaceApiLoading = false;
let mediaStream = null;

async function loadFaceApiModels() {
  if (faceApiModelsLoaded) return true;
  if (typeof faceapi === 'undefined') {
    console.warn("face-api library not loaded in browser.");
    return false;
  }
  if (isFaceApiLoading) return false;
  isFaceApiLoading = true;

  try {
    logToTerminal('system', 'OPTICAL CORE: Loading pretrained neural facial emotion detection weights...');
    const PRIMARY_CDN = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
    await faceapi.nets.tinyFaceDetector.loadFromUri(PRIMARY_CDN);
    await faceapi.nets.faceExpressionNet.loadFromUri(PRIMARY_CDN);
    await faceapi.nets.ageGenderNet.loadFromUri(PRIMARY_CDN);
    await faceapi.nets.faceLandmark68Net.loadFromUri(PRIMARY_CDN);
    await faceapi.nets.faceRecognitionNet.loadFromUri(PRIMARY_CDN);
    faceApiModelsLoaded = true;
    isFaceApiLoading = false;
    logToTerminal('system', 'OPTICAL CORE: Neural vision models loaded successfully.');
    loadHostDescriptorFromStorage();
    return true;
  } catch (err) {
    console.warn("Primary face-api model repository unavailable, trying fallback...", err);
    try {
      const FALLBACK_CDN = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/';
      await faceapi.nets.tinyFaceDetector.loadFromUri(FALLBACK_CDN);
      await faceapi.nets.faceExpressionNet.loadFromUri(FALLBACK_CDN);
      await faceapi.nets.ageGenderNet.loadFromUri(FALLBACK_CDN);
      await faceapi.nets.faceLandmark68Net.loadFromUri(FALLBACK_CDN);
      await faceapi.nets.faceRecognitionNet.loadFromUri(FALLBACK_CDN);
      faceApiModelsLoaded = true;
      isFaceApiLoading = false;
      logToTerminal('system', 'OPTICAL CORE: Neural vision models loaded from fallback repository.');
      loadHostDescriptorFromStorage();
      return true;
    } catch (fallbackErr) {
      isFaceApiLoading = false;
      console.error("Failed to load face-api models:", fallbackErr);
      logToTerminal('system', `OPTICAL ERROR: Failed to load emotion models: ${fallbackErr.message}`);
      return false;
    }
  }
}

// ------------------------------------------
// Host Face Recognition (enroll + match)
// ------------------------------------------
let hostFaceMatcher = null;

function buildHostFaceMatcher() {
  if (!state.hostDescriptor || typeof faceapi === 'undefined') {
    hostFaceMatcher = null;
    return;
  }
  const labeled = new faceapi.LabeledFaceDescriptors('host', [new Float32Array(state.hostDescriptor)]);
  hostFaceMatcher = new faceapi.FaceMatcher([labeled], 0.55);
}

function loadHostDescriptorFromStorage() {
  try {
    const saved = localStorage.getItem('jarvis_host_descriptor');
    if (saved) {
      state.hostDescriptor = JSON.parse(saved);
      buildHostFaceMatcher();
      if (elements.hostEnrollStatus) elements.hostEnrollStatus.textContent = 'HOST ENROLLED';
    }
  } catch (e) {
    console.warn('Could not load saved host descriptor:', e);
  }
}

async function enrollAsHost() {
  if (!state.cameraActive || !elements.cctvVideo || elements.cctvVideo.readyState < 2) {
    logToTerminal('system', 'HOST ENROLLMENT FAILED: Optical scanner must be active with a visible face first.');
    return;
  }
  const modelsReady = await loadFaceApiModels();
  if (!modelsReady) {
    logToTerminal('system', 'HOST ENROLLMENT FAILED: Neural vision models unavailable.');
    return;
  }

  if (elements.hostEnrollStatus) elements.hostEnrollStatus.textContent = 'SCANNING...';
  try {
    const result = await faceapi
      .detectSingleFace(elements.cctvVideo, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!result || !result.descriptor) {
      logToTerminal('system', 'HOST ENROLLMENT FAILED: No face clearly detected. Face the camera and try again.');
      if (elements.hostEnrollStatus) elements.hostEnrollStatus.textContent = 'NO FACE DETECTED';
      return;
    }

    state.hostDescriptor = Array.from(result.descriptor);
    localStorage.setItem('jarvis_host_descriptor', JSON.stringify(state.hostDescriptor));
    buildHostFaceMatcher();

    if (elements.hostEnrollStatus) elements.hostEnrollStatus.textContent = 'HOST ENROLLED';
    logToTerminal('system', 'HOST ENROLLMENT COMPLETE: Facial signature registered. JARVIS will now recognize you on the perimeter feed.');
  } catch (e) {
    console.error('Host enrollment error:', e);
    logToTerminal('system', `HOST ENROLLMENT ERROR: ${e.message || 'Unable to capture facial signature.'}`);
    if (elements.hostEnrollStatus) elements.hostEnrollStatus.textContent = 'ENROLLMENT ERROR';
  }
}

async function enableWebcam() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    logToTerminal('system', 'OPTICAL ERROR: MediaDevices getUserMedia is not supported in this browser.');
    if (elements.cameraActiveInput) elements.cameraActiveInput.checked = false;
    state.cameraActive = false;
    return;
  }

  try {
    logToTerminal('system', 'OPTICAL SCANNER: Requesting perimeter camera permissions...');
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false
    });

    if (elements.cctvVideo) {
      elements.cctvVideo.srcObject = mediaStream;
      elements.cctvVideo.onloadedmetadata = () => {
        elements.cctvVideo.play().catch(e => console.warn("Video playback warning:", e));
      };
    }

    state.cameraActive = true;
    if (elements.cameraActiveInput) elements.cameraActiveInput.checked = true;
    localStorage.setItem('jarvis_camera_active', 'true');
    logToTerminal('system', 'OPTICAL SCANNER ENGAGED: Live video perimeter active with emotion analysis.');

    // Preload face-api models
    loadFaceApiModels();
  } catch (err) {
    console.error("Camera access error:", err);
    state.cameraActive = false;
    if (elements.cameraActiveInput) elements.cameraActiveInput.checked = false;
    localStorage.setItem('jarvis_camera_active', 'false');
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      logToTerminal('system', 'CAMERA ACCESS DENIED: User or browser blocked optical sensors. Perimeter reverted to radar.');
    } else {
      logToTerminal('system', `CAMERA ERROR: ${err.message || 'Unable to open camera stream.'}`);
    }
  }
}

function disableWebcam() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (elements.cctvVideo) {
    elements.cctvVideo.srcObject = null;
  }
  state.cameraActive = false;
  state.currentEmotion = null;
  if (elements.cameraActiveInput) elements.cameraActiveInput.checked = false;
  localStorage.setItem('jarvis_camera_active', 'false');
  logToTerminal('system', 'OPTICAL SCANNER STANDBY: Camera feed shut down. Reverted to simulated radar.');
}

// ==========================================
// 10.6. AUTONOMOUS TOPIC QUEUE MANAGEMENT (FEATURE 3)
// ==========================================
async function refreshTopicQueue() {
  const listContainer = elements.topicQueueList;
  if (!listContainer) return;

  try {
    const res = await fetch('/api/autolearn');
    const data = await res.json();
    if (data.success && data.config) {
      state.autoLearnActive = !!data.config.enabled;
      state.autoLearnTopics = data.config.topics || [];
      if (elements.autoLearnActiveInput) {
        elements.autoLearnActiveInput.checked = state.autoLearnActive;
      }

      listContainer.innerHTML = '';
      if (state.autoLearnTopics.length === 0) {
        listContainer.innerHTML = '<span style="color: var(--text-muted); font-style: italic;">No topics currently queued for research.</span>';
      } else {
        state.autoLearnTopics.forEach((topic, idx) => {
          const item = document.createElement('div');
          item.style.padding = '4px 0';
          item.style.borderBottom = '1px solid rgba(var(--primary-rgb), 0.08)';
          item.style.display = 'flex';
          item.style.justifyContent = 'space-between';
          item.style.alignItems = 'center';
          item.style.gap = '8px';

          const textSpan = document.createElement('span');
          textSpan.textContent = `${idx + 1}. ${topic}`;
          textSpan.style.flex = '1';
          const isNext = idx === (data.config.currentIndex % state.autoLearnTopics.length);
          if (isNext) {
            textSpan.style.color = 'var(--secondary)';
            textSpan.title = "Next queued topic for background research";
          } else {
            textSpan.style.color = 'var(--text-primary)';
          }

          const delBtn = document.createElement('button');
          delBtn.innerHTML = '<i class="fa-solid fa-trash" style="font-size: 0.6rem;"></i>';
          delBtn.style.background = 'transparent';
          delBtn.style.border = 'none';
          delBtn.style.color = 'var(--text-muted)';
          delBtn.style.cursor = 'pointer';
          delBtn.style.padding = '2px 6px';
          delBtn.title = "Remove topic from queue";

          delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            sfx.playClick();
            try {
              const dRes = await fetch('/api/autolearn/topic', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic })
              });
              const dData = await dRes.json();
              if (dData.success) {
                logToTerminal('system', `AUTO-LEARN QUEUE: Removed topic "${topic}"`);
                refreshTopicQueue();
              }
            } catch (err) {
              console.error("Failed to delete topic:", err);
            }
          });

          item.appendChild(textSpan);
          item.appendChild(delBtn);
          listContainer.appendChild(item);
        });
      }
    }
  } catch (err) {
    console.error("Failed to load autolearn topics:", err);
    listContainer.innerHTML = '<span style="color: var(--alert);">Failed to load topic queue.</span>';
  }
}

// ==========================================
// 11. CONSCIOUSNESS SETTINGS CONSOLE (MODAL)
// ==========================================
function populateVoiceSelector() {
  const select = elements.voiceSelect;
  if (!select) return;
  
  const voices = window.speechSynthesis.getVoices();
  select.innerHTML = '';
  
  if (voices.length === 0) {
    select.innerHTML = '<option value="">Default Irish Voice (Emily)</option>';
    return;
  }

  // Find Emily / Irish default voice if not yet chosen or if previously on David/George
  const defaultIrishVoice = voices.find(v => v.name.toLowerCase().includes('emily')) ||
                            voices.find(v => v.name.toLowerCase().includes('irish') || (v.lang && (v.lang.toLowerCase() === 'en-ie' || v.lang.toLowerCase().replace('_', '-').startsWith('en-ie')))) ||
                            voices.find(v => v.name.includes('Google UK English Female')) || 
                            voices.find(v => v.name.includes('Hazel')) || 
                            voices.find(v => v.name.includes('Susan')) || 
                            voices.find(v => v.name.includes('Zira')) || 
                            voices.find(v => v.name.includes('Jenny')) || 
                            voices.find(v => v.name.includes('Aria')) || 
                            voices.find(v => v.lang && (v.lang.includes('en-GB') || v.lang.includes('en-IE'))) || 
                            voices.find(v => v.lang && v.lang.includes('en-US')) || 
                            voices[0];

  if ((!state.voiceName || state.voiceName.includes('David') || state.voiceName.includes('George')) && defaultIrishVoice) {
    state.voiceName = defaultIrishVoice.name;
    if (typeof voiceEngine !== 'undefined' && voiceEngine) voiceEngine.loadVoice();
  }

  voices.forEach(voice => {
    const option = document.createElement('option');
    option.value = voice.name;
    const isIrishEmily = voice.name.toLowerCase().includes('emily') || (voice.lang && voice.lang.toLowerCase().includes('en-ie')) || voice.name.toLowerCase().includes('irish');
    option.textContent = `${voice.name} (${voice.lang})${isIrishEmily ? ' ★ RECOMMENDED (STELLER)' : ''}`;
    if (voice.name === state.voiceName) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

async function refreshMemoriesList() {
  const container = elements.memoryListContainer;
  if (!container) return;
  
  try {
    const res = await fetch('/api/memories');
    const data = await res.json();
    
    if (data.success && data.memories) {
      container.innerHTML = '';
      if (data.memories.length === 0) {
        container.innerHTML = '<span class="no-memories-text" style="color: var(--text-muted); font-style: italic;">No memories saved yet.</span>';
      } else {
        data.memories.forEach(mem => {
          const item = document.createElement('div');
          item.style.padding = '4px 0';
          item.style.borderBottom = '1px solid rgba(var(--primary-rgb), 0.05)';
          item.style.display = 'flex';
          item.style.justifyContent = 'space-between';
          item.style.alignItems = 'center';
          item.style.gap = '8px';

          const text = document.createElement('span');
          text.textContent = mem;
          text.style.flex = '1';

          item.appendChild(text);
          container.appendChild(item);
        });
      }
    }
  } catch (err) {
    console.error("Failed to load memories:", err);
    container.innerHTML = '<span style="color: var(--alert);">Failed to load memory database.</span>';
  }
}


async function refreshHermesStatus() {
  if (!elements.hermesStatus) return;
  try {
    const response = await fetch('/api/hermes/status', { cache: 'no-store' });
    const data = await response.json();
    elements.hermesStatus.textContent = data.computerUseReady ? 'READY' : (data.configured ? 'CONFIGURED' : 'CHECK STATUS');
  } catch { elements.hermesStatus.textContent = 'UNAVAILABLE'; }
}
async function refreshOllamaStatus() {
  if (!elements.ollamaStatus) return;
  try {
    const response = await fetch('/api/ollama/status', { cache: 'no-store' });
    const data = await response.json();
    elements.ollamaStatus.textContent = data.available && data.modelAvailable ? `READY • ${data.model || 'LOCAL MODEL'}` : (data.available ? 'MODEL NOT FOUND' : 'OFFLINE');
  } catch { elements.ollamaStatus.textContent = 'UNAVAILABLE'; }
}

function setupSettingsModal() {
  // Avoid reusing stale credentials from earlier builds; current cloud credentials stay server-side.
  let savedKey = localStorage.getItem('jarvis_api_key') || '';
  if (/^AIza|^hf_/i.test(savedKey)) {
    localStorage.removeItem('jarvis_api_key');
    savedKey = '';
  }

  state.aiBridgeActive = localStorage.getItem('jarvis_ai_active') !== 'false';
  state.apiProvider = localStorage.getItem('jarvis_api_provider') || 'ollama';
  state.cameraActive = false; // Camera access default is off, request permission only when explicitly enabled!
  if (elements.hostEnrollStatus) {
    elements.hostEnrollStatus.textContent = localStorage.getItem('jarvis_host_descriptor') ? 'HOST ENROLLED' : 'NOT ENROLLED';
  }
  
  // Set default keys, using user's HF key
  state.apiKeys = {
    gemini: localStorage.getItem('jarvis_api_key_gemini') || (state.apiProvider === 'gemini' ? savedKey : ''),
    openai: localStorage.getItem('jarvis_api_key_openai') || '',
    openrouter: localStorage.getItem('jarvis_api_key_openrouter') || '',
    groq: localStorage.getItem('jarvis_api_key_groq') || '',
    huggingface: localStorage.getItem('jarvis_api_key_huggingface') || '',
    hermes: '',
    ollama: ''
  };

  state.customModels = {
    openai: localStorage.getItem('jarvis_model_openai') || 'gpt-4o',
    openrouter: localStorage.getItem('jarvis_model_openrouter') || 'meta-llama/llama-3-8b-instruct:free',
    groq: localStorage.getItem('jarvis_model_groq') || 'llama3-8b-8192',
    huggingface: localStorage.getItem('jarvis_model_huggingface') || 'meta-llama/Meta-Llama-3-8B-Instruct',
    hermes: localStorage.getItem('jarvis_model_hermes') || '',
    ollama: localStorage.getItem('jarvis_model_ollama') || 'gemma4:e2b'
  };

  state.empathyLevel = localStorage.getItem('jarvis_empathy_lvl') || 'friend';
  const savedVoice = localStorage.getItem('steller_voice_name') || localStorage.getItem('jarvis_voice_name') || '';
  if (savedVoice && !savedVoice.includes('David') && !savedVoice.includes('George')) {
    state.voiceName = savedVoice;
  } else {
    state.voiceName = ''; // Default to Emily / Irish voice
  }
  state.voicePitch = parseFloat(localStorage.getItem('steller_voice_pitch') || localStorage.getItem('jarvis_voice_pitch') || '1.05');
  state.voiceRate = parseFloat(localStorage.getItem('steller_voice_rate') || localStorage.getItem('jarvis_voice_rate') || '1.00');

  if (localStorage.getItem('jarvis_ai_active') === null) {
    localStorage.setItem('jarvis_ai_active', 'true');
  }

  // Apply configurations to UI elements on startup
  elements.aiBridgeActiveInput.checked = state.aiBridgeActive;
  elements.apiProviderSelect.value = state.apiProvider;
  
  elements.geminiKeyInput.value = state.apiKeys.gemini;
  elements.openaiKeyInput.value = state.apiKeys.openai;
  elements.openaiModelInput.value = state.customModels.openai;
  elements.openrouterKeyInput.value = state.apiKeys.openrouter;
  elements.openrouterModelInput.value = state.customModels.openrouter;
  elements.groqKeyInput.value = state.apiKeys.groq;
  elements.groqModelInput.value = state.customModels.groq;
  elements.huggingfaceKeyInput.value = state.apiKeys.huggingface;
  elements.huggingfaceModelInput.value = state.customModels.huggingface;
  elements.hermesModelInput.value = state.customModels.hermes;
  elements.ollamaModelInput.value = state.customModels.ollama;

  elements.empathyLevelSelect.value = state.empathyLevel;
  elements.voicePitchInput.value = state.voicePitch;
  elements.lblVoicePitch.textContent = `${state.voicePitch.toFixed(2)}x`;
  elements.voiceRateInput.value = state.voiceRate;
  elements.lblVoiceRate.textContent = `${state.voiceRate.toFixed(2)}x`;

  if (elements.cameraActiveInput) {
    elements.cameraActiveInput.checked = false;
  }

  // Function to show/hide input fields based on selected provider
  const updateProviderFieldsVisibility = () => {
    const selected = elements.apiProviderSelect.value;
    const providers = ['hermes', 'ollama', 'gemini', 'openai', 'openrouter', 'groq', 'huggingface'];
    providers.forEach(prov => {
      const fieldEl = document.getElementById(`field-${prov}`);
      if (fieldEl) {
        fieldEl.style.display = prov === selected ? 'block' : 'none';
      }
    });
  };

  elements.apiProviderSelect.addEventListener('change', updateProviderFieldsVisibility);
  updateProviderFieldsVisibility(); // Initial run
  refreshHermesStatus();
  refreshOllamaStatus();

  // Initial populate
  populateVoiceSelector();

  // Slider real-time label updates
  elements.voicePitchInput.addEventListener('input', () => {
    elements.lblVoicePitch.textContent = `${parseFloat(elements.voicePitchInput.value).toFixed(2)}x`;
  });

  elements.voiceRateInput.addEventListener('input', () => {
    elements.lblVoiceRate.textContent = `${parseFloat(elements.voiceRateInput.value).toFixed(2)}x`;
  });

  // Camera Active Toggle Listener (Feature 1)
  if (elements.cameraActiveInput) {
    elements.cameraActiveInput.addEventListener('change', async () => {
      sfx.playClick();
      if (elements.cameraActiveInput.checked) {
        await enableWebcam();
      } else {
        disableWebcam();
      }
    });
  }

  // Enroll as Host Listener (Host Face Recognition)
  if (elements.enrollHostBtn) {
    elements.enrollHostBtn.addEventListener('click', async () => {
      sfx.playClick();
      await enrollAsHost();
    });
  }

  // Auto-Learn Active Toggle Listener (Feature 3)
  if (elements.autoLearnActiveInput) {
    elements.autoLearnActiveInput.addEventListener('change', async () => {
      sfx.playClick();
      const enabled = elements.autoLearnActiveInput.checked;
      state.autoLearnActive = enabled;
      try {
        const res = await fetch('/api/autolearn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled })
        });
        const data = await res.json();
        if (data.success) {
          logToTerminal('system', `AUTONOMOUS RESEARCH: Background auto-learn is now ${enabled ? 'ENABLED' : 'DISABLED'}.`);
        }
      } catch (err) {
        console.error("Failed to update auto-learn state:", err);
      }
    });
  }
    // Manual auto-learn run (Run Now)
  const runNowBtn = document.getElementById('runAutoLearnBtn');
  if (runNowBtn) {
    runNowBtn.addEventListener('click', async () => {
      sfx.playClick();
      runNowBtn.disabled = true;
      logToTerminal('system', 'AUTO-LEARN: Manual research cycle triggered.');
      try {
        const res = await fetch('/api/autolearn/run', { method: 'POST' });
        const data = await res.json();
        if (data.success && data.outcome && data.outcome.success) {
          sfx.playSuccess();
          logToTerminal('system', `AUTO-LEARN SUCCESS: Indexed "${data.outcome.topic}" (${data.outcome.factsCount} facts).`);
          refreshTopicQueue();
        } else {
          sfx.playAlert();
          const reason = (data.outcome && (data.outcome.error || data.outcome.reason)) || 'Unknown error';
          logToTerminal('system', `AUTO-LEARN FAILED: ${reason}`);
        }
      } catch (err) {
        sfx.playAlert();
        logToTerminal('system', `AUTO-LEARN ERROR: ${err.message}`);
      } finally {
        runNowBtn.disabled = false;
      }
    });
  }


  // Add Topic to Queue Listener (Feature 3)
  const handleAddTopic = async () => {
    if (!elements.newTopicInput) return;
    const topic = elements.newTopicInput.value.trim();
    if (!topic) return;
    sfx.playClick();
    elements.newTopicInput.value = '';
    try {
      const res = await fetch('/api/autolearn/topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
      });
      const data = await res.json();
      if (data.success) {
        sfx.playSuccess();
        logToTerminal('system', `AUTO-LEARN QUEUE: Enqueued "${topic}" for background research.`);
        refreshTopicQueue();
      }
    } catch (err) {
      console.error("Failed to add topic to queue:", err);
    }
  };

  if (elements.addTopicBtn) {
    elements.addTopicBtn.addEventListener('click', handleAddTopic);
  }
  if (elements.newTopicInput) {
    elements.newTopicInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAddTopic();
    });
  }

  // Listeners for Modal Open / Close
  elements.openSettingsBtn.addEventListener('click', () => {
    sfx.playClick();
    populateVoiceSelector();
    refreshMemoriesList();
    refreshTopicQueue();
    elements.settingsOverlay.classList.add('active');
  });

  elements.closeSettingsBtn.addEventListener('click', () => {
    sfx.playClick();
    elements.settingsOverlay.classList.remove('active');
  });

  elements.clearMemoriesBtn.addEventListener('click', async () => {
    sfx.playClick();
    if (confirm("Are you sure you want to completely clear STELLER's persistent memory core?")) {
      try {
        const res = await fetch('/api/memories', { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          sfx.playSuccess();
          logToTerminal('system', 'MEMORY SYNC: All persistent memory nodes wiped.');
          refreshMemoriesList();
        }
      } catch (err) {
        console.error("Failed to clear memory database:", err);
      }
    }
  });

  elements.saveSettingsBtn.addEventListener('click', () => {
    sfx.playSuccess();
    
    state.aiBridgeActive = elements.aiBridgeActiveInput.checked;
    state.apiProvider = elements.apiProviderSelect.value;
    
    state.apiKeys.gemini = elements.geminiKeyInput.value.trim();
    state.apiKeys.openai = elements.openaiKeyInput.value.trim();
    state.apiKeys.openrouter = elements.openrouterKeyInput.value.trim();
    state.apiKeys.groq = elements.groqKeyInput.value.trim();
    state.apiKeys.huggingface = elements.huggingfaceKeyInput.value.trim();
    state.apiKeys.hermes = '';
    state.apiKeys.ollama = '';

    state.customModels.openai = elements.openaiModelInput.value.trim() || 'gpt-4o';
    state.customModels.openrouter = elements.openrouterModelInput.value.trim() || 'meta-llama/llama-3-8b-instruct:free';
    state.customModels.groq = elements.groqModelInput.value.trim() || 'llama3-8b-8192';
    state.customModels.huggingface = elements.huggingfaceModelInput.value.trim() || 'meta-llama/Meta-Llama-3-8B-Instruct';
    state.customModels.hermes = elements.hermesModelInput.value.trim();
    state.customModels.ollama = elements.ollamaModelInput.value.trim() || 'gemma4:e2b';

    state.empathyLevel = elements.empathyLevelSelect.value;
    state.voiceName = elements.voiceSelect.value;
    state.voicePitch = parseFloat(elements.voicePitchInput.value);
    state.voiceRate = parseFloat(elements.voiceRateInput.value);

    localStorage.setItem('jarvis_ai_active', state.aiBridgeActive);
    localStorage.setItem('jarvis_api_provider', state.apiProvider);
    
    localStorage.setItem('jarvis_api_key_gemini', state.apiKeys.gemini);
    localStorage.setItem('jarvis_api_key_openai', state.apiKeys.openai);
    localStorage.setItem('jarvis_api_key_openrouter', state.apiKeys.openrouter);
    localStorage.setItem('jarvis_api_key_groq', state.apiKeys.groq);
    localStorage.setItem('jarvis_api_key_huggingface', state.apiKeys.huggingface);
    localStorage.setItem('jarvis_model_hermes', state.customModels.hermes);
    localStorage.setItem('jarvis_model_ollama', state.customModels.ollama);

    localStorage.setItem('jarvis_model_openai', state.customModels.openai);
    localStorage.setItem('jarvis_model_openrouter', state.customModels.openrouter);
    localStorage.setItem('jarvis_model_groq', state.customModels.groq);
    localStorage.setItem('jarvis_model_huggingface', state.customModels.huggingface);
    localStorage.setItem('jarvis_model_hermes', state.customModels.hermes);
    localStorage.setItem('jarvis_model_ollama', state.customModels.ollama);

    localStorage.setItem('jarvis_empathy_lvl', state.empathyLevel);
    localStorage.setItem('steller_voice_name', state.voiceName);
    localStorage.setItem('jarvis_voice_name', state.voiceName);
    localStorage.setItem('steller_voice_pitch', state.voicePitch);
    localStorage.setItem('jarvis_voice_pitch', state.voicePitch);
    localStorage.setItem('steller_voice_rate', state.voiceRate);
    localStorage.setItem('jarvis_voice_rate', state.voiceRate);

    // Re-verify in speech engine
    voiceEngine.loadVoice();

    elements.settingsOverlay.classList.remove('active');
    
    logToTerminal('system', 'SETTINGS SAVED: Consciousness and vocal synthesis bridge updated.');
    voiceEngine.speak("Voice coordinates adjusted and synchronized successfully!");
  });
}

// ==========================================
// 12. HIGH-TECH CANVAS VISUALIZERS (CCTV & WAVE)
// ==========================================

// CCTV Thermal & Live Emotion Detection Scanner Loop (Feature 1)
function initCctvLoop() {
  const canvas = elements.cctvCanvas;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  // Set grid dimensions
  canvas.width = 300;
  canvas.height = 140;

  const dots = [];
  for(let i=0; i<4; i++) {
    dots.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5,
      label: `SEC_TRG_0${i+1}`
    });
  }

  let lastEmotionSample = 0;
  let lastFaceBoxes = [];
  let isDetectingEmotion = false;

  async function sampleFacialEmotion(videoEl) {
    if (isDetectingEmotion || !faceApiModelsLoaded || typeof faceapi === 'undefined') return;
    if (!videoEl || videoEl.readyState < 2 || videoEl.paused || videoEl.ended) return;

    isDetectingEmotion = true;
    try {
      const detections = await faceapi
        .detectAllFaces(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 }))
        .withFaceLandmarks()
        .withFaceExpressions()
        .withAgeAndGender()
        .withFaceDescriptors();

      if (detections && detections.length > 0) {
        const scaleX = canvas.width / (videoEl.videoWidth || 640);
        const scaleY = canvas.height / (videoEl.videoHeight || 480);
        let guestCount = 0;

        lastFaceBoxes = detections.map(detection => {
          // Detect dominant emotion: happy, sad, angry, surprised, neutral, fearful, disgusted
          const expressions = detection.expressions;
          const sorted = Object.entries(expressions).sort((a, b) => b[1] - a[1]);
          const dominant = sorted[0]; // [emotion, score]
          const dominantEmotion = dominant[0];
          const confidenceScore = Math.round(dominant[1] * 100);

          // Estimated age from the age/gender neural net
          const estimatedAge = detection.age !== undefined ? Math.round(detection.age) : null;

          // Host recognition via the enrolled face descriptor
          let personLabel = 'USER';
          if (hostFaceMatcher && detection.descriptor) {
            const match = hostFaceMatcher.findBestMatch(detection.descriptor);
            if (match.label === 'host') {
              personLabel = 'HOST';
            } else {
              guestCount += 1;
              personLabel = `GUEST-${guestCount}`;
            }
          }

          const box = detection.detection.box;
          return {
            x: ((videoEl.videoWidth || 640) - box.x - box.width) * scaleX, // mirrored horizontal flip
            y: box.y * scaleY,
            width: box.width * scaleX,
            height: box.height * scaleY,
            emotion: dominantEmotion,
            confidence: confidenceScore,
            age: estimatedAge,
            label: personLabel,
            area: box.width * box.height
          };
        });

        // Send everyone's detected mood to JARVIS — host is still tagged distinctly so the
        // backend can weigh it more heavily, but the room's overall mood now matters too.
        const hostBox = lastFaceBoxes.find(b => b.label === 'HOST');
        state.currentEmotion = {
          people: lastFaceBoxes.map(b => ({ label: b.label, emotion: b.emotion, confidence: b.confidence, age: b.age }))
        };

        if (elements.cctvTelemetry) {
          const countLabel = ` | FACES: ${lastFaceBoxes.length}`;
          if (hostBox) {
            const ageLabel = hostBox.age !== null ? ` | AGE: ~${hostBox.age}` : '';
            elements.cctvTelemetry.textContent = `TARGET: HOST | MOOD: ${hostBox.emotion.toUpperCase()} (${hostBox.confidence}%)${ageLabel}${countLabel} | CAM 01`;
          } else {
            const statusTag = hostFaceMatcher ? 'HOST NOT IN FRAME' : 'HOST UNENROLLED';
            elements.cctvTelemetry.textContent = `${statusTag}${countLabel} | CAM 01`;
          }
        }
      } else {
        lastFaceBoxes = [];
        state.currentEmotion = null;
        if (elements.cctvTelemetry) {
          const az = (140 + Math.sin(Date.now() * 0.001) * 5).toFixed(1);
          const el = (12 + Math.cos(Date.now() * 0.0015) * 2).toFixed(1);
          elements.cctvTelemetry.textContent = `AZM: ${az}° | ELE: ${el}° | LNS: OPTICAL LIVE`;
        }
      }
    } catch (e) {
      console.warn("Facial expression detection warning:", e);
    } finally {
      isDetectingEmotion = false;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state.cameraActive && elements.cctvVideo && elements.cctvVideo.readyState >= 2) {
      // 1. Render live camera frame with horizontal mirror for natural selfie perspective
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(elements.cctvVideo, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Cybernetic cyan scanner tint overlay
      ctx.fillStyle = 'rgba(0, 242, 254, 0.06)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 2. Sample facial emotion every ~2 seconds
      const now = Date.now();
      if (now - lastEmotionSample >= 2000) {
        lastEmotionSample = now;
        sampleFacialEmotion(elements.cctvVideo);
      }

      // 3. Render cybernetic target box & emotion telemetry over each detected face
      lastFaceBoxes.forEach(b => {
        let hudColor = 'rgba(0, 242, 254, 0.85)';
        if (b.emotion === 'happy') hudColor = 'rgba(0, 255, 0, 0.9)';
        else if (b.emotion === 'sad' || b.emotion === 'angry' || b.emotion === 'disgusted') hudColor = 'rgba(255, 0, 128, 0.9)';
        else if (b.emotion === 'surprised') hudColor = 'rgba(255, 200, 0, 0.9)';

        // Host gets a distinct gold outline so it's clear at a glance who's recognized
        if (b.label === 'HOST') hudColor = 'rgba(255, 215, 0, 0.95)';

        ctx.strokeStyle = hudColor;
        ctx.lineWidth = 1.5;

        // Cyber corner brackets around detected face
        const cLen = Math.max(6, Math.min(14, b.width / 4));
        
        // Top-left
        ctx.beginPath();
        ctx.moveTo(b.x, b.y + cLen);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b.x + cLen, b.y);
        ctx.stroke();

        // Top-right
        ctx.beginPath();
        ctx.moveTo(b.x + b.width - cLen, b.y);
        ctx.lineTo(b.x + b.width, b.y);
        ctx.lineTo(b.x + b.width, b.y + cLen);
        ctx.stroke();

        // Bottom-left
        ctx.beginPath();
        ctx.moveTo(b.x, b.y + b.height - cLen);
        ctx.lineTo(b.x, b.y + b.height);
        ctx.lineTo(b.x + cLen, b.y + b.height);
        ctx.stroke();

        // Bottom-right
        ctx.beginPath();
        ctx.moveTo(b.x + b.width - cLen, b.y + b.height);
        ctx.lineTo(b.x + b.width, b.y + b.height);
        ctx.lineTo(b.x + b.width, b.y + b.height - cLen);
        ctx.stroke();

        // Cyber Mood Label Tag
        ctx.fillStyle = 'rgba(1, 4, 9, 0.75)';
        ctx.fillRect(b.x, Math.max(0, b.y - 15), Math.max(115, b.width), 14);
        ctx.fillStyle = hudColor;
        ctx.font = '7px Orbitron, sans-serif';
        const ageTag = (b.age !== null && b.age !== undefined) ? ` ~${b.age}Y` : '';
        ctx.fillText(`ID: ${b.label} [${b.emotion.toUpperCase()} ${b.confidence}%${ageTag}]`, b.x + 3, Math.max(10, b.y - 4));
      });
    } else {
      // Standby / Simulated Thermal Radar Loop
      ctx.fillStyle = 'rgba(1, 4, 9, 0.4)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Dynamic grid overlay
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.04)';
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 15) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 15) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Scanning concentric circles
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.08)';
      ctx.beginPath();
      ctx.arc(canvas.width/2, canvas.height/2, 45, 0, Math.PI * 2);
      ctx.arc(canvas.width/2, canvas.height/2, 90, 0, Math.PI * 2);
      ctx.stroke();

      // Crosshairs
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.15)';
      ctx.beginPath();
      ctx.moveTo(canvas.width/2 - 10, canvas.height/2);
      ctx.lineTo(canvas.width/2 + 10, canvas.height/2);
      ctx.moveTo(canvas.width/2, canvas.height/2 - 10);
      ctx.lineTo(canvas.width/2, canvas.height/2 + 10);
      ctx.stroke();

      // Render simulated heat targets
      dots.forEach(dot => {
        dot.x += dot.vx;
        dot.y += dot.vy;

        // Bounce
        if (dot.x < 10 || dot.x > canvas.width - 10) dot.vx *= -1;
        if (dot.y < 10 || dot.y > canvas.height - 10) dot.vy *= -1;

        // Draw heat-signature glows
        const glow = ctx.createRadialGradient(dot.x, dot.y, 1, dot.x, dot.y, 8);
        
        if (state.activeRoutine === 'gaming' || state.activeRoutine === 'party') {
          // Red alert scanning
          glow.addColorStop(0, 'rgba(255, 0, 128, 1)');
          glow.addColorStop(0.3, 'rgba(255, 0, 128, 0.4)');
          glow.addColorStop(1, 'rgba(255, 0, 128, 0)');
          ctx.strokeStyle = 'rgba(255, 0, 128, 0.4)';
        } else {
          glow.addColorStop(0, 'rgba(0, 242, 254, 1)');
          glow.addColorStop(0.3, 'rgba(0, 242, 254, 0.4)');
          glow.addColorStop(1, 'rgba(0, 242, 254, 0)');
          ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
        }

        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 8, 0, Math.PI * 2);
        ctx.fill();

        // Bounding box
        ctx.lineWidth = 0.5;
        ctx.strokeRect(dot.x - 6, dot.y - 6, 12, 12);
        
        // Target text
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '5px Orbitron';
        ctx.fillText(dot.label, dot.x + 8, dot.y - 2);
      });

      // Update telemetry text dynamically
      const az = (140 + Math.sin(Date.now() * 0.001) * 5).toFixed(1);
      const el = (12 + Math.cos(Date.now() * 0.0015) * 2).toFixed(1);
      if (elements.cctvTelemetry) {
        elements.cctvTelemetry.textContent = `AZM: ${az}° | ELE: ${el}° | LNS: TRML`;
      }
    }

    requestAnimationFrame(draw);
  }

  draw();
}

// Shifting Holographic Sine Waveforms Visualizer
function initWaveformLoop() {
  const canvas = elements.waveformCanvas;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  canvas.width = 380;
  canvas.height = 40;

  let phase = 0;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const activeColor = getComputedStyle(elements.body).getPropertyValue('--primary').trim() || DEFAULT_PRIMARY;
    
    // Wave calculations based on state (Speaking increases height/speed, listening triggers jitter)
    let speed = 0.08;
    let amplitude = 6;
    let frequency = 0.035;

    if (state.isSpeaking) {
      amplitude = 14;
      speed = 0.22;
      frequency = 0.045;
    } else if (state.isListening) {
      amplitude = 10;
      speed = 0.15;
      frequency = 0.06;
    } else {
      amplitude = 3;
      speed = 0.03;
      frequency = 0.02;
    }

    phase += speed;

    // Draw three overlaid phase-shifted waves for premium sci-fi aesthetic
    const drawWave = (opacity, offset, widthVal, scale) => {
      ctx.strokeStyle = activeColor;
      ctx.globalAlpha = opacity;
      ctx.lineWidth = widthVal;
      ctx.beginPath();
      
      for (let x = 0; x < canvas.width; x++) {
        const y = canvas.height / 2 + Math.sin(x * frequency + phase * scale + offset) * amplitude * Math.sin(x * (Math.PI / canvas.width));
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };

    drawWave(0.15, 0, 0.75, 1);
    drawWave(0.4, Math.PI * 0.5, 1.25, -1.2);
    drawWave(0.8, Math.PI * 1.0, 2.0, 1.5);
    
    ctx.globalAlpha = 1.0;
    requestAnimationFrame(draw);
  }

  draw();
}

// ==========================================
// 13. DATA TELEMETRY POLLING (CPU/RAM/DISK)
// ==========================================
function startTelemetryPolling() {
  const telemetryUrl = '/api/system';

  async function poll() {
    try {
      const response = await fetch(telemetryUrl);
      if (!response.ok) throw new Error("HTTP failure");

      const data = await response.json();
      
      // Update local connection state
      if (!state.localServerConnected) {
        state.localServerConnected = true;
        elements.systemStatusText.textContent = "NOMINAL";
        elements.systemStatusText.style.color = "var(--primary)";
        logToTerminal('system', 'LOCAL BACKEND SYNAPSE ONLINE. System telemetry engaged.');
      }

      updateTelemetryUI(data);

    } catch (e) {
      if (state.localServerConnected) {
        state.localServerConnected = false;
        elements.systemStatusText.textContent = "OFFLINE SYNAPSE";
        elements.systemStatusText.style.color = "var(--alert)";
        logToTerminal('system', 'ERROR: Local backend server offline. Reverting telemetry to simulated matrices.');
      }
      
      // Fallback: Generate cute floating simulated metrics so HUD remains highly visual
      generateSimulatedTelemetry();
    }
  }

  // Initial and recurring poll
  poll();
  setInterval(poll, 2500);
}

function updateTelemetryUI(data) {
  // Save to state
  state.systemMetrics.cpu = data.cpu.load;
  state.systemMetrics.ram = data.ram.percent;
  state.systemMetrics.disk = data.disk.percent;
  state.systemMetrics.uptime = data.system.uptime;

  // Update DOM percentage stats
  elements.cpuVal.textContent = `${data.cpu.load}%`;
  elements.cpuFill.style.width = `${data.cpu.load}%`;

  elements.ramVal.textContent = `${data.ram.percent}%`;
  elements.ramFill.style.width = `${data.ram.percent}%`;

  elements.diskVal.textContent = `${data.disk.percent}%`;
  elements.diskFill.style.width = `${data.disk.percent}%`;

  elements.headerUptime.innerHTML = `UPTIME: <span>${data.system.uptime} HR</span>`;
  elements.headerPlatform.innerHTML = `HOST: <span>${data.system.platform.toUpperCase()}</span>`;
}

function generateSimulatedTelemetry() {
  // Simulated organic CPU fluctuations (fluctuates around 15% to 60%)
  const simulatedCpu = Math.round(25 + Math.sin(Date.now() * 0.0005) * 15 + Math.random() * 8);
  const simulatedRam = Math.round(54 + Math.cos(Date.now() * 0.0001) * 3);
  const simulatedDisk = 62; // Constant storage metric

  elements.cpuVal.textContent = `${simulatedCpu}%`;
  elements.cpuFill.style.width = `${simulatedCpu}%`;

  elements.ramVal.textContent = `${simulatedRam}%`;
  elements.ramFill.style.width = `${simulatedRam}%`;

  elements.diskVal.textContent = `${simulatedDisk}%`;
  elements.diskFill.style.width = `${simulatedDisk}%`;
  
  elements.headerUptime.innerHTML = `UPTIME: <span>MOCK HR</span>`;
  elements.headerPlatform.innerHTML = `HOST: <span>STANDALONE</span>`;
}

// ==========================================
// 14. UI LOGISTICS & TERMINAL OUTPUTS
// ==========================================
function logToTerminal(source, message) {
  const logContainer = elements.terminalLog;
  if (!logContainer) return;

  const now = new Date();
  const timeString = `[${now.toTimeString().split(' ')[0]}]`;
  
  const entry = document.createElement('div');
  entry.className = `log-entry ${source}`;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = timeString;

  const msgSpan = document.createElement('span');
  msgSpan.className = 'log-msg';
  
  if (source === 'user') {
    msgSpan.textContent = `USER INSTRUCTION: "${message}"`;
  } else if (source === 'jarvis') {
    msgSpan.textContent = `JARVIS RESPONDED: "${message}"`;
  } else {
    msgSpan.textContent = message;
  }

  entry.appendChild(timeSpan);
  entry.appendChild(msgSpan);
  logContainer.appendChild(entry);
  
  // Auto scroll
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Clock Header updates
function startClock() {
  function updateTime() {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    elements.headerClock.innerHTML = `TIME: <span>${timeStr}</span>`;
  }
  updateTime();
  setInterval(updateTime, 1000);
}

// ==========================================
// 15. SYSTEM MAIN STARTUP (INITIALIZATION)
// ==========================================
function initializeJarvisSystem() {
  if (state.isInitialized) return;
  
  state.isInitialized = true;
  
  // 1. Synthesize startup sweep and double beep!
  sfx.playStartup();
  
  // 2. Transcribe status events
  logToTerminal('system', 'SECURITY ENCRYPTED SYNAPSE CONSOLE INITIATING...');
  logToTerminal('system', 'WAVEFORM ARRAYS BALANCED. VOCAL RECOGNITION ONLINE.');
  
  // 3. UI update
  elements.reactorText.textContent = "ONLINE";
  elements.assistantStateText.textContent = "JARVIS OPERATIONAL";
  elements.assistantTip.textContent = "Listening continuously... Say 'Hello JARVIS' or click core.";

  // 4. Vocal greeting from Jarvis
  setTimeout(() => {
    voiceEngine.speak("Systems operational, sir. All automation grids stand ready for your instruction. Ready when you are.");
  }, 1000);

  // 5. Fire up continuous voice recognition loops
  recognizer.start();
}

// Bind DOM event listeners
function bindAppEventListeners() {
  // Arc Reactor Core tap to activate listener
  elements.reactorCore.addEventListener('click', () => {
    sfx.playClick();
    if (!state.isInitialized) {
      initializeJarvisSystem();
    } else {
      if (state.isListening) {
        state.continuedConversationActive = false;
        if (continuedConversationTimeout) {
          clearTimeout(continuedConversationTimeout);
        }
        deactivateListeningMode();
      } else {
        state.continuedConversationActive = true;
        activateListeningMode();
        resetContinuedConversationTimeout();
      }
    }
  });

  // Text override box execution
  elements.cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const query = elements.cmdInput.value.trim();
      if (query.length > 0) {
        sfx.playClick();
        executeCommand(query);
        elements.cmdInput.value = '';
      }
    }
  });

  elements.cmdSubmitBtn.addEventListener('click', () => {
    const query = elements.cmdInput.value.trim();
    if (query.length > 0) {
      sfx.playClick();
      executeCommand(query);
      elements.cmdInput.value = '';
    }
  });

  // Smart Routines button click bindings
  document.querySelectorAll('.routine-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const routine = btn.getAttribute('data-routine');
      triggerRoutine(routine);
    });
  });

  // Auto initialize on first user gesture anywhere on the window
  const autoInitOnGesture = () => {
    if (!state.isInitialized) {
      initializeJarvisSystem();
    }
  };
  window.addEventListener('click', autoInitOnGesture, { once: true });
  window.addEventListener('keydown', autoInitOnGesture, { once: true });
}

// Document Loaded trigger
window.addEventListener('DOMContentLoaded', () => {
  startClock();
  setupSettingsModal();
  setupIotControls();
  initCctvLoop();
  initWaveformLoop();
  startTelemetryPolling();
  bindAppEventListeners();

  // Attempt initial speech recognition start
  try {
    recognizer.start();
  } catch (e) {}

  logToTerminal('system', 'Jarvis Dashboard Interface pre-loaded. Say "Hey JARVIS" or click Reactor Core to command.');
});