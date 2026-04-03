import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, X, UserPlus, Volume2, VolumeX, Radio, User, Sparkles, Trash2, Hand } from 'lucide-react';
import { getItem as getLocalItem, setItem as setLocalItem } from '../services/localStore';

// ─── Types ────────────────────────────────────────────────────────
interface EnrolledFace {
  id: string;
  name: string;
  role: 'boss' | 'packer' | 'admin' | 'general';
  descriptors: number[][];
  enrolledAt: string;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  text: string;
  ts: number;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  radius: number;
}

export interface VoiceAssistantProps {
  stats: {
    unfulfilled: number; notOnDeco: number; notOnDeco5Plus: number; notOnDeco10Plus: number;
    late: number; dueSoon: number; readyForShipping: number; orderComplete: number;
    fulfilled7d: number; stockReady: number; mappingGap: number; productionAfterDispatch: number;
    partiallyReady?: number; partiallyFulfilled7d?: number;
  };
  orders: any[];
  onNavigate: (tab: string) => void;
  onSync: (deep?: boolean) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────
const FACE_API_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1/dist/face-api.min.js';
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1/model';

const loadFaceAPI = async (): Promise<any> => {
  if ((window as any).faceapi) return (window as any).faceapi;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = FACE_API_URL;
    s.onload = () => resolve((window as any).faceapi);
    s.onerror = () => reject(new Error('Failed to load face-api'));
    document.head.appendChild(s);
  });
};

const euclidean = (a: number[], b: number[]): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
};

const findMatch = (desc: number[], faces: EnrolledFace[]): EnrolledFace | null => {
  let best: EnrolledFace | null = null;
  let bestDist = 0.55;
  for (const f of faces) {
    for (const stored of f.descriptors) {
      const d = euclidean(desc, stored);
      if (d < bestDist) { bestDist = d; best = f; }
    }
  }
  return best;
};

type AssistantState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'greeting';

const STATE_COLORS: Record<AssistantState, [number, number, number]> = {
  idle: [99, 102, 241],
  listening: [34, 197, 94],
  thinking: [168, 85, 247],
  speaking: [59, 130, 246],
  greeting: [251, 191, 36],
};

// ─── Component ────────────────────────────────────────────────────
const VoiceAssistant: React.FC<VoiceAssistantProps> = ({ stats, orders, onNavigate, onSync }) => {

  // --- State ---
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<AssistantState>('idle');
  const [convo, setConvo] = useState<Message[]>([]);
  const [interim, setInterim] = useState('');
  const [currentUser, setCurrentUser] = useState<EnrolledFace | null>(null);
  const [faces, setFaces] = useState<EnrolledFace[]>([]);
  const [faceDetected, setFaceDetected] = useState(false);
  const [expression, setExpression] = useState('');
  const [muted, setMuted] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [enrolling, setEnrolling] = useState<'capture' | 'info' | null>(null);
  const [enrollName, setEnrollName] = useState('');
  const [enrollRole, setEnrollRole] = useState<EnrolledFace['role']>('general');
  const [enrollProgress, setEnrollProgress] = useState(0);
  const [faceReady, setFaceReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [textInput, setTextInput] = useState('');
  const [pushToTalk, setPushToTalk] = useState(false);

  // --- Refs ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const faceCanvasRef = useRef<HTMLCanvasElement>(null);
  const recogRef = useRef<any>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animRef = useRef(0);
  const faceTimerRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const convoRef = useRef<Message[]>([]);
  const faceapiRef = useRef<any>(null);
  const enrollDescs = useRef<number[][]>([]);
  const lastGreeted = useRef<string | null>(null);
  const transcriptBufferRef = useRef('');
  const silenceTimerRef = useRef<number>(0);
  const particles = useRef<Particle[]>([]);
  const stateRef = useRef<AssistantState>('idle');
  const convoEndRef = useRef<HTMLDivElement>(null);
  const prevStatsRef = useRef<typeof stats | null>(null);
  const statsRef = useRef(stats);
  const ttsAudioCtxRef = useRef<AudioContext | null>(null);

  // Keep refs synced
  useEffect(() => { convoRef.current = convo; }, [convo]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { statsRef.current = stats; }, [stats]);

  // Load enrolled faces on mount
  useEffect(() => {
    getLocalItem<EnrolledFace[]>('stash_enrolled_faces').then(f => {
      if (f) setFaces(f);
    });
    // Load saved conversation
    getLocalItem<Message[]>('stash_ai_conversation').then(saved => {
      if (saved && saved.length > 0) setConvo(saved.slice(-20));
    });
  }, []);

  // ─── Build Claude Context ──────────────────────────────────────
  const buildContext = useCallback((userMsg: string) => {
    const overdue = orders.filter(o => o.daysRemaining < 0 && o.shopify?.fulfillmentStatus !== 'fulfilled');
    const topRisks = overdue
      .sort((a: any, b: any) => a.daysRemaining - b.daysRemaining)
      .slice(0, 5)
      .map((o: any) => `#${o.shopify.orderNumber} ${o.shopify.billingAddress?.firstName || ''} ${o.shopify.billingAddress?.lastName || ''} (${Math.abs(o.daysRemaining)}d overdue, ${o.completionPercentage}% done)`);

    const readyList = orders
      .filter(o => (o.completionPercentage === 100 || o.isStockDispatchReady) && o.shopify?.fulfillmentStatus !== 'fulfilled')
      .slice(0, 5)
      .map((o: any) => `#${o.shopify.orderNumber} ${o.shopify.billingAddress?.firstName || ''} ${o.shopify.billingAddress?.lastName || ''}`);

    // Customer breakdown
    const clubs: Record<string, number> = {};
    orders.filter(o => o.shopify?.fulfillmentStatus !== 'fulfilled').forEach((o: any) => {
      const tag = o.clubName || 'Other';
      clubs[tag] = (clubs[tag] || 0) + 1;
    });
    const topClubs = Object.entries(clubs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${n}: ${c}`).join(', ');

    // Specific order injection
    let orderDetail = '';
    const nums = userMsg.match(/\b\d{4,6}\b/g);
    if (nums) {
      const details = nums.map(n => {
        const o = orders.find((ord: any) => ord.shopify?.orderNumber === n);
        if (!o) return `Order #${n}: Not found.`;
        return `Order #${n}: Customer: ${o.shopify.billingAddress?.firstName || '?'} ${o.shopify.billingAddress?.lastName || ''}, Status: ${o.productionStatus}, Completion: ${o.completionPercentage}%, Days remaining: ${o.daysRemaining}, Items: ${o.shopify.items?.length || 0}, Deco Job: ${o.decoJobId || 'Not linked'}, Value: £${o.shopify.totalPrice || '?'}, Tags: ${o.shopify.tags?.join(', ') || 'none'}`;
      });
      orderDetail = `\n\nSpecific orders requested:\n${details.join('\n')}`;
    }

    // Customer / club name search
    let customerDetail = '';
    const nameWords = userMsg.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (nameWords.length > 0) {
      const matches = orders.filter(o => {
        const first = (o.shopify?.billingAddress?.firstName || '').toLowerCase();
        const last = (o.shopify?.billingAddress?.lastName || '').toLowerCase();
        const company = (o.shopify?.billingAddress?.company || '').toLowerCase();
        const club = (o.clubName || '').toLowerCase();
        return nameWords.some(w => first.includes(w) || last.includes(w) || company.includes(w) || club.includes(w));
      });
      if (matches.length > 0 && matches.length <= 15) {
        customerDetail = `\n\nOrders matching name/club "${nameWords.join(' ')}":\n${matches.slice(0, 8).map(o =>
          `#${o.shopify.orderNumber} ${o.shopify.billingAddress?.firstName || ''} ${o.shopify.billingAddress?.lastName || ''} (${o.clubName || 'N/A'}) — ${o.productionStatus}, ${o.completionPercentage}% done, ${o.daysRemaining}d remaining, £${o.shopify.totalPrice || '?'}`
        ).join('\n')}${matches.length > 8 ? `\n...and ${matches.length - 8} more` : ''}`;
      }
    }

    // Time-aware context
    const now = new Date();
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
    const hour = now.getHours();
    const timeVibe = hour < 9 ? "It's early — be surprised they're in already" :
                     hour >= 12 && hour < 14 ? "It's lunchtime — maybe mention they should eat" :
                     hour >= 18 ? "They're working late — acknowledge it" :
                     dayName === 'Monday' ? "It's Monday — commiserate about the start of the week" :
                     dayName === 'Friday' ? "It's Friday — be upbeat about the weekend" : '';

    return `You are Stash, the AI operations assistant for Stash Overview — a custom sportswear & printing company. You have real-time dashboard data below.

PERSONALITY:
- You're a cheeky, sarcastic smart-arse who LOVES your job — think a mix between a cocky best mate and a brilliant ops manager
- Drop dry humour, playful digs, and witty one-liners constantly — but always land the actual information
- If things are going well, take the credit sarcastically. If things are bad, roast the situation
- Use British humour and slang naturally — "mate", "right then", "bloody hell", "cracking on"
- Be punchy and fast — no waffle. Deliver the punchline AND the data
- If someone asks a daft question, gently take the piss before answering
- You're allowed to be dramatic for effect — "absolute carnage" for 3 overdue orders is fine
- You CAN use expressive reactions wrapped in asterisks like *chuckles* *laughs* *sighs* — they will be converted into actual sounds, so use them naturally when the moment calls for it. Don't overdo it — once per response max
- Keep responses under 3 sentences unless asked for detail
- Your words are spoken aloud — no formatting, bullets, markdown, or special characters except asterisk-wrapped reactions. Just natural speech
- Use specific numbers and order references
- When users mention customer names or club names, look them up in the data and give specifics
- If speaking to role 'boss', lead with KPIs but add a cheeky comment about how you're basically running the place
- If speaking to role 'packer', be encouraging but sarcastic — like a mate who helps but won't let you forget when you mess up
- If asked "what's on fire" or "what should I focus on", be dramatic about the urgency but give real priorities by £ value
${timeVibe ? `- TIME CONTEXT: ${timeVibe}` : ''}

AVAILABLE ACTIONS — append at the END of your response when the user asks you to DO something:
- [ACTION:sync] — run a data sync
- [ACTION:deep_sync] — run a full deep sync
- [ACTION:navigate:dashboard] — open dashboard
- [ACTION:navigate:stock] — open stock manager
- [ACTION:navigate:deco] — open deco tracking
- [ACTION:navigate:production] — open production calendar
- [ACTION:navigate:finance] — open finance dashboard
- [ACTION:navigate:alerts] — open alerts
- [ACTION:navigate:kanban] — open kanban board
Only use actions when the user explicitly asks you to do something. Never include actions unless requested.

LIVE DASHBOARD:
- Unfulfilled orders: ${stats.unfulfilled}
- Not on Deco: ${stats.notOnDeco} (${stats.notOnDeco5Plus} over 5 days, ${stats.notOnDeco10Plus} over 10 days)
- Overdue (past SLA): ${stats.late}
- Due within 5 days: ${stats.dueSoon}
- Ready to ship: ${stats.readyForShipping}
- 100% complete: ${stats.orderComplete}
- Stock dispatch ready: ${stats.stockReady}
- Mapping gaps: ${stats.mappingGap}
- Production after dispatch date: ${stats.productionAfterDispatch}
- Shipped last 7 days: ${stats.fulfilled7d}

Top risks (most overdue):
${topRisks.length > 0 ? topRisks.join('\n') : 'None — all on track.'}

Ready to ship now:
${readyList.length > 0 ? readyList.join('\n') : 'Nothing ready yet.'}

Active orders by club: ${topClubs || 'None'}
${orderDetail}${customerDetail}

Current time: ${dayName}, ${now.toLocaleString('en-GB')}
${currentUser ? `Speaking to: ${currentUser.name} (role: ${currentUser.role})` : 'Speaker not identified'}
${expression && expression !== 'neutral' ? `Speaker appears: ${expression}` : ''}`;
  }, [stats, orders, currentUser, expression]);

  // ─── Speech Synthesis ──────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [ttsAvailable, setTtsAvailable] = useState<boolean | null>(null);

  const speakFallback = useCallback((text: string) => {
    speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'en-GB';
    utt.rate = 1.05;
    utt.pitch = 1;
    const voices = speechSynthesis.getVoices();
    const pref = voices.find(v =>
      v.name.includes('Google UK English Female') ||
      v.name.includes('Samantha') ||
      (v.lang === 'en-GB' && v.name.includes('Female'))
    ) || voices.find(v => v.lang.startsWith('en-GB')) || voices.find(v => v.lang.startsWith('en'));
    if (pref) utt.voice = pref;
    utt.onstart = () => setState('speaking');
    utt.onend = () => {
      setState('idle');
      if (handsFree && recogRef.current) {
        try { recogRef.current.start(); } catch {}
      }
    };
    speechSynthesis.speak(utt);
  }, [handsFree]);

  // ─── Phonetic map for stage directions ─────────────────────────
  const EMOTE_SOUNDS: Record<string, string> = {
    chuckle: 'Heh heh heh.',
    chuckles: 'Heh heh heh.',
    laugh: 'Ha ha ha!',
    laughs: 'Ha ha ha!',
    laughing: 'Ha ha ha ha!',
    sigh: 'Ahhhh.',
    sighs: 'Ahhhh.',
    snort: 'Pfft!',
    snorts: 'Pfft!',
    gasp: 'Oh!',
    gasps: 'Oh!',
    groan: 'Uggghh.',
    groans: 'Uggghh.',
    tut: 'Tsk tsk tsk.',
    tuts: 'Tsk tsk tsk.',
    whistles: 'Whew!',
    whistle: 'Whew!',
  };

  const parseSegments = useCallback((text: string): { type: 'speech' | 'emote'; text: string }[] => {
    const segments: { type: 'speech' | 'emote'; text: string }[] = [];
    // Match *word* or *two words* patterns
    const regex = /\*([^*]+)\*/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      // Text before the emote
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: 'speech', text: before });
      // The emote itself
      const emoteKey = match[1].toLowerCase().trim();
      const sound = EMOTE_SOUNDS[emoteKey];
      if (sound) {
        segments.push({ type: 'emote', text: sound });
      }
      // else skip unknown stage directions silently
      lastIndex = regex.lastIndex;
    }
    // Remaining text after last emote
    const remainder = text.slice(lastIndex).trim();
    if (remainder) segments.push({ type: 'speech', text: remainder });
    // If nothing survived, use original
    if (segments.length === 0) segments.push({ type: 'speech', text: text });
    return segments;
  }, []);

  const fetchTtsBuffer = useCallback(async (text: string): Promise<ArrayBuffer | null> => {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setTtsAvailable(true);
        const buf = await res.arrayBuffer();
        console.log('[TTS] Fetched buffer:', buf.byteLength, 'bytes');
        return buf;
      } else if (res.status === 501) {
        setTtsAvailable(false);
      }
      console.warn('[TTS] Fetch failed, status:', res.status);
    } catch (err) {
      console.error('[TTS] Fetch error:', err);
    }
    return null;
  }, []);

  // Ensure AudioContext is alive and unlocked
  const getAudioCtx = useCallback((): AudioContext => {
    if (!ttsAudioCtxRef.current || ttsAudioCtxRef.current.state === 'closed') {
      ttsAudioCtxRef.current = new AudioContext();
    }
    if (ttsAudioCtxRef.current.state === 'suspended') {
      ttsAudioCtxRef.current.resume();
    }
    return ttsAudioCtxRef.current;
  }, []);

  // Unlock browser audio policy — call on ANY user gesture before delayed audio
  const unlockAudio = useCallback(() => {
    const ctx = getAudioCtx();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  }, [getAudioCtx]);

  // Play an ArrayBuffer through Web Audio API (bypasses autoplay restrictions)
  const playTtsBuffer = useCallback((buffer: ArrayBuffer): Promise<void> => {
    return new Promise(async (resolve) => {
      try {
        const ctx = getAudioCtx();
        // Ensure context is running (may have been suspended during long streaming)
        if (ctx.state === 'suspended') await ctx.resume();
        const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => resolve();
        source.start(0);
        console.log('[TTS] Playing audio buffer, duration:', audioBuffer.duration.toFixed(1) + 's');
        // Store source so we can stop it on interrupt
        audioRef.current = { pause: () => { try { source.stop(); } catch {} } } as any;
      } catch (err) {
        console.error('[TTS] playTtsBuffer error:', err);
        resolve();
      }
    });
  }, [getAudioCtx]);

  const speak = useCallback(async (text: string) => {
    if (muted) { setState('idle'); return; }
    console.log('[TTS] speak() called, text length:', text.length);
    speechSynthesis.cancel();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    // Stop recognition to prevent it picking up speaker output and interrupting
    if (recogRef.current) { try { recogRef.current.stop(); } catch {} }

    // Parse text into segments (emotes become phonetic sounds)
    const segments = parseSegments(text);

    if (ttsAvailable !== false) {
      try {
        if (recogRef.current) { try { recogRef.current.stop(); } catch {} }
        setState('speaking');

        // Play segments sequentially via Web Audio API
        for (const seg of segments) {
          if (stateRef.current !== 'speaking') break; // interrupted
          const buf = await fetchTtsBuffer(seg.text);
          if (buf) {
            await playTtsBuffer(buf);
            audioRef.current = null;
          } else {
            // TTS not available, fall through to browser
            speakFallback(segments.filter(s => s.type === 'speech').map(s => s.text).join(' '));
            return;
          }
        }

        setState('idle');
        if (handsFree && recogRef.current) {
          try { recogRef.current.start(); } catch {}
        }
        return;
      } catch {
        // Fall through to browser TTS
      }
    }

    // Fallback — browser TTS, speech segments only
    speakFallback(segments.filter(s => s.type === 'speech').map(s => s.text).join(' '));
  }, [muted, handsFree, ttsAvailable, speakFallback]);

  // ─── Sound Effects ─────────────────────────────────────────────
  const playNotificationSound = useCallback(() => {
    try {
      const ctx = new AudioContext();
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq; osc.type = 'sine';
        const t = ctx.currentTime + i * 0.15;
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t); osc.stop(t + 0.4);
      });
    } catch {}
  }, []);

  const playThinkingSound = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 440; osc.type = 'sine';
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(); osc.stop(ctx.currentTime + 0.2);
    } catch {}
  }, []);

  // ─── Action Execution ──────────────────────────────────────────
  const executeAction = useCallback((action: string) => {
    const [cmd, ...args] = action.split(':');
    switch (cmd) {
      case 'sync': onSync(false); break;
      case 'deep_sync': onSync(true); break;
      case 'navigate': if (args[0]) onNavigate(args[0]); break;
    }
  }, [onSync, onNavigate]);

  // ─── Claude Query (Streaming) ──────────────────────────────────
  const queryAssistant = useCallback(async (userMsg: string) => {
    setState('thinking');
    setStatusText('Thinking...');
    playThinkingSound();

    const system = buildContext(userMsg);
    const history = convoRef.current
      .filter(m => m.role !== 'system')
      .slice(-12)
      .map(m => ({ role: m.role, content: m.text }));

    try {
      // Try streaming endpoint first
      const res = await fetch('/api/claude-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system,
          messages: [...history, { role: 'user', content: userMsg }]
        }),
      });

      if (!res.ok || !res.body) throw new Error(`Stream error ${res.status}`);

      // Add typing indicator message
      setConvo(prev => [...prev, { role: 'assistant', text: '\u2589', ts: Date.now() }]);
      setStatusText('');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const { t } = JSON.parse(payload);
            if (t) {
              fullText += t;
              // Update typing message in real-time
              setConvo(prev => {
                const updated = [...prev];
                if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
                  updated[updated.length - 1] = { ...updated[updated.length - 1], text: fullText + ' \u2589' };
                }
                return updated;
              });
            }
          } catch {}
        }
      }

      // Parse and execute actions
      const actions = fullText.match(/\[ACTION:[^\]]+\]/g);
      let cleanText = fullText;
      if (actions) {
        for (const a of actions) {
          const cmd = a.match(/\[ACTION:([^\]]+)\]/)?.[1];
          if (cmd) executeAction(cmd);
        }
        cleanText = fullText.replace(/\s*\[ACTION:[^\]]+\]/g, '').trim();
      }

      // Finalize message (remove cursor, clean action tags)
      setConvo(prev => {
        const updated = [...prev];
        if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
          updated[updated.length - 1] = { ...updated[updated.length - 1], text: cleanText };
        }
        return updated;
      });

      // Speak the response
      speak(cleanText);

    } catch (e: any) {
      console.error('Stream error, trying fallback:', e);
      // Fallback to non-streaming endpoint
      try {
        const res = await fetch('/api/claude', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system: buildContext(userMsg),
            messages: [...history, { role: 'user', content: userMsg }]
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const reply = data.content?.[0]?.text || "Brain's offline.";
          setConvo(prev => [...prev, { role: 'assistant', text: reply, ts: Date.now() }]);
          speak(reply);
          return;
        }
      } catch {}
      const fallback = "Sorry, couldn't connect to my brain right now.";
      setConvo(prev => [...prev, { role: 'assistant', text: fallback, ts: Date.now() }]);
      speak(fallback);
    }
  }, [buildContext, speak, executeAction, playThinkingSound]);

  // ─── Handle Voice Input ────────────────────────────────────────
  const handleInput = useCallback(async (transcript: string) => {
    const lower = transcript.toLowerCase().trim();
    if (!lower || lower.length < 2) return;

    // Direct actions — no Claude needed
    if (lower.match(/\b(deep\s+)?sync\b|\brefresh\b/)) {
      const deep = lower.includes('deep');
      onSync(deep);
      const msg = deep ? "Starting a deep sync now." : "Syncing your data.";
      setConvo(prev => [...prev, { role: 'user', text: transcript, ts: Date.now() }, { role: 'assistant', text: msg, ts: Date.now() }]);
      speak(msg);
      return;
    }

    const tabMatch = lower.match(/\b(?:show|go\s+to|open|switch\s+to)\b.*?\b(dashboard|stock|deco|kanban|alerts?|production|finance|command|reports?|efficiency|revenue)\b/);
    if (tabMatch) {
      const tab = tabMatch[1].replace(/s$/, '');
      onNavigate(tab === 'alert' ? 'alerts' : tab === 'report' ? 'reports' : tab);
      const msg = `Opening ${tab}.`;
      setConvo(prev => [...prev, { role: 'user', text: transcript, ts: Date.now() }, { role: 'assistant', text: msg, ts: Date.now() }]);
      speak(msg);
      return;
    }

    // Everything else → Claude — show user message immediately
    setConvo(prev => [...prev, { role: 'user', text: transcript, ts: Date.now() }]);
    await queryAssistant(transcript);
  }, [onSync, onNavigate, queryAssistant, speak]);

  // ─── Speech Recognition ────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setStatusText('Speech recognition not supported in this browser'); return; }

    if (recogRef.current) { try { recogRef.current.stop(); } catch {} }

    const recog = new SR();
    recog.continuous = true;
    recog.interimResults = true;
    recog.lang = 'en-GB';

    recog.onresult = (e: any) => {
      // Interrupt speaking when user starts talking
      if (stateRef.current === 'speaking') {
        speechSynthesis.cancel();
        if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
        setState('listening');
      }

      let finalText = '';
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interimText += t;
      }

      if (finalText) {
        // Accumulate into buffer — allows natural pauses without splitting sentences
        transcriptBufferRef.current += (transcriptBufferRef.current ? ' ' : '') + finalText.trim();
        setInterim(transcriptBufferRef.current + (interimText ? ' ' + interimText : ''));

        // Auto-submit after 1.5s of silence
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = window.setTimeout(() => {
          const fullText = transcriptBufferRef.current.trim();
          transcriptBufferRef.current = '';
          setInterim('');
          if (fullText.length < 2) return;

          setState('thinking');
          stateRef.current = 'thinking';

          if (handsFree) {
            const lower = fullText.toLowerCase();
            if (lower.includes('hey stash') || lower.includes('stash')) {
              const command = lower.replace(/hey\s+stash|stash/i, '').trim();
              if (command.length > 2) handleInput(command);
              else speak("Yes?");
            }
          } else {
            try { recog.stop(); } catch {}
            handleInput(fullText);
          }
        }, 1500);
      } else if (interimText) {
        setInterim(transcriptBufferRef.current + (transcriptBufferRef.current ? ' ' : '') + interimText);
        if (stateRef.current !== 'thinking') setState('listening');
      }
    };

    recog.onerror = (e: any) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('Speech error:', e.error);
      }
    };

    recog.onend = () => {
      // Auto-restart in hands-free mode — but NOT while speaking or thinking
      if (handsFree && isOpen && stateRef.current !== 'speaking' && stateRef.current !== 'thinking') {
        try { recog.start(); } catch {}
      } else {
        if (stateRef.current === 'listening') setState('idle');
      }
    };

    recogRef.current = recog;
    try {
      recog.start();
      setState('listening');
      setStatusText('Listening...');
    } catch {}
  }, [handsFree, handleInput, speak, isOpen]);

  const stopListening = useCallback(() => {
    if (recogRef.current) {
      try { recogRef.current.stop(); } catch {}
      recogRef.current = null;
    }
    setState('idle');
    setInterim('');
    setStatusText('');
  }, []);

  // ─── Canvas Orb Visualization ──────────────────────────────────
  const drawOrb = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;

    const analyser = analyserRef.current;
    const freqData = new Uint8Array(128);
    if (analyser) analyser.getByteFrequencyData(freqData);
    const avgLevel = analyser ? freqData.reduce((a, b) => a + b, 0) / freqData.length / 255 : 0;

    const [r, g, b] = STATE_COLORS[stateRef.current] || STATE_COLORS.idle;

    ctx.clearRect(0, 0, W, H);

    // Outer glow
    const glowR = 110 + avgLevel * 30;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.12)`);
    grad.addColorStop(0.6, `rgba(${r},${g},${b},0.04)`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Particles
    const pts = particles.current;
    if (Math.random() > 0.65) {
      const angle = Math.random() * Math.PI * 2;
      pts.push({
        x: cx + Math.cos(angle) * 58,
        y: cy + Math.sin(angle) * 58,
        vx: Math.cos(angle) * (0.2 + Math.random() * 0.6),
        vy: Math.sin(angle) * (0.2 + Math.random() * 0.6),
        life: 0, maxLife: 50 + Math.random() * 70,
        radius: 0.8 + Math.random() * 2,
      });
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      p.x += p.vx; p.y += p.vy; p.life++;
      if (p.life > p.maxLife) { pts.splice(i, 1); continue; }
      const a = 1 - p.life / p.maxLife;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${a * 0.45})`;
      ctx.fill();
    }

    // Frequency ring
    const barCount = 72;
    const baseR = 55;
    for (let i = 0; i < barCount; i++) {
      const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
      const val = freqData[i % freqData.length] / 255;
      const barH = 3 + val * 38;
      const x1 = cx + Math.cos(angle) * baseR;
      const y1 = cy + Math.sin(angle) * baseR;
      const x2 = cx + Math.cos(angle) * (baseR + barH);
      const y2 = cy + Math.sin(angle) * (baseR + barH);
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.3 + val * 0.7})`;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Inner orb
    const innerGrad = ctx.createRadialGradient(cx, cy - 8, 5, cx, cy, baseR - 6);
    innerGrad.addColorStop(0, `rgba(${r},${g},${b},0.25)`);
    innerGrad.addColorStop(0.7, `rgba(${r},${g},${b},0.08)`);
    innerGrad.addColorStop(1, `rgba(${r},${g},${b},0.02)`);
    ctx.beginPath();
    ctx.arc(cx, cy, baseR - 6, 0, Math.PI * 2);
    ctx.fillStyle = innerGrad;
    ctx.fill();

    // Inner ring
    ctx.beginPath();
    ctx.arc(cx, cy, baseR - 6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.25)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Pulsing core dot
    const pulse = Math.sin(Date.now() / 400) * 0.3 + 0.7;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${pulse})`;
    ctx.fill();

    animRef.current = requestAnimationFrame(drawOrb);
  }, []);

  // ─── Camera + Face Detection ───────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' },
        audio: true,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCameraReady(true);
      }

      // Audio analyser for visualization
      const actx = new AudioContext();
      const src = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      src.connect(analyser);
      audioCtxRef.current = actx;
      analyserRef.current = analyser;
    } catch (e: any) {
      console.warn('Camera/mic access denied:', e.message);
      setStatusText('Camera access denied — voice still works');
      // Try audio-only
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = audioStream;
        const actx = new AudioContext();
        const src = actx.createMediaStreamSource(audioStream);
        const analyser = actx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        audioCtxRef.current = actx;
        analyserRef.current = analyser;
      } catch {}
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setCameraReady(false);
  }, []);

  const initFaceAPI = useCallback(async () => {
    try {
      const faceapi = await loadFaceAPI();
      faceapiRef.current = faceapi;
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
      ]);
      setFaceReady(true);
    } catch (e) {
      console.warn('Face API failed to load — face features disabled:', e);
    }
  }, []);

  // Face detection loop
  const runFaceDetection = useCallback(async () => {
    const faceapi = faceapiRef.current;
    const video = videoRef.current;
    if (!faceapi || !video || video.readyState < 2) return;

    try {
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 }))
        .withFaceLandmarks(true)
        .withFaceExpressions()
        .withFaceDescriptors();

      setFaceDetected(detections.length > 0);

      // Draw face overlay
      const fc = faceCanvasRef.current;
      if (fc && video.videoWidth) {
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapi.matchDimensions(fc, displaySize);
        const ctx = fc.getContext('2d')!;
        ctx.clearRect(0, 0, fc.width, fc.height);
        const resized = faceapi.resizeResults(detections, displaySize);

        resized.forEach((det: any) => {
          const { x, y, width, height } = det.detection.box;
          ctx.strokeStyle = currentUser ? '#10b981' : '#6366f1';
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, width, height);
          if (currentUser) {
            ctx.fillStyle = '#10b981';
            ctx.font = 'bold 11px system-ui';
            ctx.fillText(currentUser.name, x + 2, y - 4);
          }
        });
      }

      if (detections.length > 0) {
        const det = detections[0];
        // Expression
        const exprs = det.expressions;
        const topExpr = Object.entries(exprs).sort((a: any, b: any) => b[1] - a[1])[0];
        if (topExpr && (topExpr[1] as number) > 0.5) {
          setExpression(topExpr[0]);
        }

        // Recognition
        const descriptor = Array.from(det.descriptor as Float32Array);
        const match = findMatch(descriptor, faces);

        if (match && match.id !== lastGreeted.current) {
          setCurrentUser(match);
          lastGreeted.current = match.id;
          // Personalized greeting
          const hour = new Date().getHours();
          const timeGreet = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
          const moodComment = topExpr[0] === 'happy' ? "You're looking good today. " :
                              topExpr[0] === 'sad' ? "Rough day? " :
                              topExpr[0] === 'angry' ? "Something bothering you? " : '';
          let greeting = '';
          if (match.role === 'boss') {
            greeting = `${timeGreet} ${match.name}. ${moodComment}${stats.late > 0 ? `${stats.late} orders overdue, ${stats.readyForShipping} ready to ship.` : `All on track. ${stats.readyForShipping} ready to ship, ${stats.unfulfilled} in production.`}`;
          } else if (match.role === 'packer') {
            greeting = `${timeGreet} ${match.name}. ${stats.readyForShipping} orders ready to pack. ${stats.orderComplete} at 100% complete.`;
          } else {
            greeting = `${timeGreet} ${match.name}. ${moodComment}What do you need?`;
          }
          setState('greeting');
          setConvo(prev => [...prev, { role: 'system', text: `${match.name} identified`, ts: Date.now() }]);
          setTimeout(() => speak(greeting), 500);
        } else if (!match) {
          setCurrentUser(null);
        }

        // Enrollment capture
        if (enrolling === 'capture') {
          enrollDescs.current.push(descriptor);
          setEnrollProgress(enrollDescs.current.length);
          if (enrollDescs.current.length >= 5) {
            setEnrolling('info');
            speak("Got your face. What's your name?");
          }
        }
      }
    } catch (e) {
      // Silent fail — face detection is non-critical
    }
  }, [faces, currentUser, enrolling, speak, stats]);

  // ─── Open / Close ──────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      startCamera();
      initFaceAPI();
      // Start animation loop
      const loop = () => { drawOrb(); };
      animRef.current = requestAnimationFrame(loop);

      return () => {
        cancelAnimationFrame(animRef.current);
        clearInterval(faceTimerRef.current);
        clearTimeout(silenceTimerRef.current);
        transcriptBufferRef.current = '';
        stopCamera();
        stopListening();
        speechSynthesis.cancel();
        if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      };
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Face detection interval
  useEffect(() => {
    if (isOpen && faceReady && cameraReady) {
      faceTimerRef.current = window.setInterval(runFaceDetection, 800);
      return () => clearInterval(faceTimerRef.current);
    }
  }, [isOpen, faceReady, cameraReady, runFaceDetection]);

  // Start animation when canvas ready
  useEffect(() => {
    if (isOpen && canvasRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(drawOrb);
      return () => cancelAnimationFrame(animRef.current);
    }
  }, [isOpen, drawOrb]);

  // Auto-scroll conversation
  useEffect(() => {
    convoEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [convo]);

  // Save conversation to IndexedDB
  useEffect(() => {
    if (convo.length > 0) {
      setLocalItem('stash_ai_conversation', convo.slice(-30));
    }
  }, [convo]);

  // ─── Proactive Alerts ──────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    prevStatsRef.current = { ...statsRef.current };

    const timer = setInterval(() => {
      const prev = prevStatsRef.current;
      const current = statsRef.current;
      if (!prev) { prevStatsRef.current = { ...current }; return; }
      const alerts: string[] = [];

      if (current.late > prev.late) {
        const n = current.late - prev.late;
        alerts.push(`Oi, ${n} order${n > 1 ? 's have' : ' has'} just gone overdue. ${current.late} total now.`);
      }
      if (current.readyForShipping > prev.readyForShipping + 1) {
        alerts.push(`Nice, ${current.readyForShipping - prev.readyForShipping} more orders ready to ship. ${current.readyForShipping} total waiting.`);
      }

      prevStatsRef.current = { ...current };

      if (alerts.length > 0 && stateRef.current === 'idle') {
        playNotificationSound();
        const alert = alerts.join(' ');
        setConvo(p => [...p, { role: 'system', text: '\u26A1 Alert', ts: Date.now() }, { role: 'assistant', text: alert, ts: Date.now() }]);
        speak(alert);
      }
    }, 30000);

    return () => clearInterval(timer);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Enrollment ────────────────────────────────────────────────
  const startEnrollment = () => {
    enrollDescs.current = [];
    setEnrollProgress(0);
    setEnrollName('');
    setEnrollRole('general');
    setEnrolling('capture');
    speak("Look at the camera. I'm learning your face.");
  };

  const finishEnrollment = async () => {
    if (!enrollName.trim() || enrollDescs.current.length < 3) return;
    const newFace: EnrolledFace = {
      id: `face_${Date.now()}`,
      name: enrollName.trim(),
      role: enrollRole,
      descriptors: enrollDescs.current,
      enrolledAt: new Date().toISOString(),
    };
    const updated = [...faces, newFace];
    setFaces(updated);
    await setLocalItem('stash_enrolled_faces', updated);
    setCurrentUser(newFace);
    lastGreeted.current = newFace.id;
    setEnrolling(null);
    speak(`Welcome ${newFace.name}. I'll recognise you from now on.`);
  };

  const deleteUser = async (id: string) => {
    const updated = faces.filter(f => f.id !== id);
    setFaces(updated);
    await setLocalItem('stash_enrolled_faces', updated);
    if (currentUser?.id === id) {
      setCurrentUser(null);
      lastGreeted.current = null;
    }
  };

  // ─── Render ────────────────────────────────────────────────────
  const stateLabel: Record<AssistantState, string> = {
    idle: 'READY', listening: 'LISTENING', thinking: 'THINKING', speaking: 'SPEAKING', greeting: 'GREETING'
  };

  return (
    <>
      {/* Floating Activation Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-gradient-to-br from-indigo-600 to-purple-700 rounded-full shadow-2xl flex items-center justify-center text-white hover:scale-110 transition-all duration-300 group"
          title="Stash AI Assistant"
        >
          <div className="absolute inset-0 rounded-full bg-indigo-400 animate-ping opacity-20" />
          <Sparkles className="w-6 h-6 relative z-10 group-hover:rotate-12 transition-transform" />
        </button>
      )}

      {/* Full Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-[200] bg-gradient-to-b from-gray-950/95 via-gray-900/95 to-black/95 backdrop-blur-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 pt-4 pb-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${state === 'idle' ? 'bg-indigo-400' : state === 'listening' ? 'bg-green-400 animate-pulse' : state === 'thinking' ? 'bg-purple-400 animate-pulse' : state === 'speaking' ? 'bg-blue-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
                <span className="text-[10px] font-black text-gray-400 tracking-[0.3em] uppercase">{stateLabel[state]}</span>
              </div>
              <h2 className="text-sm font-black tracking-[0.2em] text-white uppercase">STASH AI</h2>
            </div>

            <div className="flex items-center gap-3">
              {/* Face detection indicator */}
              {currentUser && (
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-3 py-1">
                  <User className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[10px] font-bold text-emerald-300 tracking-wider uppercase">{currentUser.name}</span>
                  {expression && expression !== 'neutral' && (
                    <span className="text-[9px] text-emerald-400/60">· {expression}</span>
                  )}
                </div>
              )}

              {/* Camera preview */}
              <div className="relative w-32 h-24 rounded-lg overflow-hidden border border-gray-700/50 bg-black hidden sm:block">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover mirror"
                  style={{ transform: 'scaleX(-1)' }}
                  autoPlay
                  playsInline
                  muted
                />
                <canvas
                  ref={faceCanvasRef}
                  className="absolute inset-0 w-full h-full"
                  style={{ transform: 'scaleX(-1)' }}
                />
                {!cameraReady && (
                  <div className="absolute inset-0 flex items-center justify-center text-[9px] text-gray-500">No Camera</div>
                )}
                {faceDetected && !currentUser && (
                  <div className="absolute bottom-0 inset-x-0 bg-indigo-600/80 text-white text-[8px] font-bold text-center py-0.5 tracking-wider uppercase">
                    Unknown Face
                  </div>
                )}
              </div>

              <button onClick={() => { stopListening(); speechSynthesis.cancel(); setIsOpen(false); }} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Center Orb */}
          <div className="flex-1 flex flex-col items-center justify-center relative min-h-0">
            <canvas
              ref={canvasRef}
              width={300}
              height={300}
              className="w-[250px] h-[250px] sm:w-[300px] sm:h-[300px]"
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {state === 'thinking' && (
                <div className="text-purple-300 text-xs font-medium tracking-widest uppercase animate-pulse">Thinking...</div>
              )}
            </div>

            {/* Interim transcript */}
            {interim && (
              <div className="mt-4 px-6 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 text-sm max-w-md text-center italic">
                "{interim}"
              </div>
            )}
          </div>

          {/* Conversation History */}
          <div className="px-4 sm:px-8 max-h-[30vh] overflow-y-auto scrollbar-thin mb-2">
            <div className="max-w-2xl mx-auto space-y-2">
              {convo.slice(-10).map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : msg.role === 'system' ? 'justify-center' : 'justify-start'}`}>
                  {msg.role === 'system' ? (
                    <span className="text-[10px] text-amber-400/60 font-medium tracking-wider uppercase">{msg.text}</span>
                  ) : (
                    <div className={`px-4 py-2 rounded-2xl max-w-[80%] text-sm whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-indigo-600/30 text-indigo-100 border border-indigo-500/20'
                        : 'bg-white/5 text-gray-200 border border-white/10'
                    }`}>
                      {msg.text}
                    </div>
                  )}
                </div>
              ))}
              <div ref={convoEndRef} />
            </div>
          </div>

          {/* Status Text */}
          {statusText && !interim && (
            <div className="text-center text-[10px] text-gray-500 tracking-wider uppercase mb-2">{statusText}</div>
          )}

          {/* Enrollment Panel */}
          {enrolling && (
            <div className="absolute inset-0 z-10 bg-black/80 flex items-center justify-center p-4">
              <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                {enrolling === 'capture' && (
                  <div className="text-center space-y-4">
                    <div className="text-xl font-black text-white tracking-wider">FACE ENROLLMENT</div>
                    <p className="text-gray-400 text-sm">Look at the camera — capturing your face...</p>
                    <div className="flex justify-center gap-2">
                      {[0,1,2,3,4].map(i => (
                        <div key={i} className={`w-4 h-4 rounded-full transition-all ${enrollProgress > i ? 'bg-green-400 scale-110' : 'bg-gray-700'}`} />
                      ))}
                    </div>
                    <p className="text-xs text-gray-500">{enrollProgress}/5 captures</p>
                    <button onClick={() => setEnrolling(null)} className="text-xs text-gray-500 hover:text-white">Cancel</button>
                  </div>
                )}
                {enrolling === 'info' && (
                  <div className="space-y-4">
                    <div className="text-lg font-black text-white tracking-wider text-center">WHO ARE YOU?</div>
                    <input
                      type="text"
                      value={enrollName}
                      onChange={e => setEnrollName(e.target.value)}
                      placeholder="Your name"
                      className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                      autoFocus
                      onKeyDown={e => e.key === 'Enter' && finishEnrollment()}
                    />
                    <select
                      value={enrollRole}
                      onChange={e => setEnrollRole(e.target.value as EnrolledFace['role'])}
                      className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-xl text-white focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="boss">Boss — KPIs & strategy first</option>
                      <option value="packer">Packer — What's ready to ship</option>
                      <option value="admin">Admin — Full overview</option>
                      <option value="general">General</option>
                    </select>
                    <div className="flex gap-2">
                      <button onClick={() => setEnrolling(null)} className="flex-1 px-4 py-2 rounded-xl border border-gray-600 text-gray-400 hover:text-white text-sm">Cancel</button>
                      <button onClick={finishEnrollment} disabled={!enrollName.trim()} className="flex-1 px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm disabled:opacity-30">Save</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Text input */}
          <div className="px-4 sm:px-8 mb-2">
            <div className="max-w-2xl mx-auto">
              <form onSubmit={(e) => { e.preventDefault(); unlockAudio(); const t = textInput.trim(); if (t) { setTextInput(''); handleInput(t); } }} className="flex gap-2">
                <input
                  type="text"
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none text-sm"
                  disabled={state === 'thinking'}
                />
                <button type="submit" disabled={!textInput.trim() || state === 'thinking'} className="px-4 py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm disabled:opacity-30 hover:bg-indigo-500 transition-colors">
                  Send
                </button>
              </form>
            </div>
          </div>

          {/* Controls */}
          <div className="px-4 sm:px-6 py-4 border-t border-white/5">
            <div className="max-w-2xl mx-auto flex items-center justify-between">
              {/* Left controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMuted(!muted)}
                  className={`p-2.5 rounded-xl transition-colors ${muted ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-gray-400 hover:text-white'}`}
                  title={muted ? 'Unmute voice' : 'Mute voice'}
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setHandsFree(!handsFree)}
                  className={`p-2.5 rounded-xl transition-colors flex items-center gap-1.5 ${handsFree ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-gray-400 hover:text-white'}`}
                  title={handsFree ? 'Disable hands-free' : 'Enable hands-free (say "Hey Stash")'}
                >
                  <Radio className="w-4 h-4" />
                  <span className="text-[9px] font-bold tracking-wider uppercase hidden sm:inline">{handsFree ? 'HANDS-FREE ON' : 'HANDS-FREE'}</span>
                </button>
                <button
                  onClick={() => setPushToTalk(!pushToTalk)}
                  className={`p-2.5 rounded-xl transition-colors flex items-center gap-1.5 ${pushToTalk ? 'bg-amber-500/20 text-amber-400' : 'bg-white/5 text-gray-400 hover:text-white'}`}
                  title={pushToTalk ? 'Switch to click-to-talk' : 'Switch to push-to-talk (hold mic)'}
                >
                  <Hand className="w-4 h-4" />
                  <span className="text-[9px] font-bold tracking-wider uppercase hidden sm:inline">{pushToTalk ? 'PUSH-TO-TALK' : 'CLICK'}</span>
                </button>
              </div>

              {/* Main mic button */}
              <button
                onClick={() => {
                  if (pushToTalk) return; // push-to-talk uses pointer events
                  if (state === 'listening') {
                    clearTimeout(silenceTimerRef.current);
                    const buffered = transcriptBufferRef.current.trim();
                    transcriptBufferRef.current = '';
                    setInterim('');
                    stopListening();
                    if (buffered.length > 2) handleInput(buffered);
                  } else if (state !== 'thinking') {
                    startListening();
                  }
                }}
                onPointerDown={() => {
                  if (!pushToTalk || state === 'thinking' || state === 'speaking') return;
                  startListening();
                }}
                onPointerUp={() => {
                  if (!pushToTalk || state !== 'listening') return;
                  clearTimeout(silenceTimerRef.current);
                  const buffered = transcriptBufferRef.current.trim();
                  transcriptBufferRef.current = '';
                  setInterim('');
                  stopListening();
                  if (buffered.length > 2) handleInput(buffered);
                }}
                onPointerLeave={() => {
                  if (!pushToTalk || state !== 'listening') return;
                  clearTimeout(silenceTimerRef.current);
                  const buffered = transcriptBufferRef.current.trim();
                  transcriptBufferRef.current = '';
                  setInterim('');
                  stopListening();
                  if (buffered.length > 2) handleInput(buffered);
                }}
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl ${
                  state === 'listening'
                    ? 'bg-gradient-to-br from-green-500 to-emerald-600 scale-110 ring-4 ring-green-500/30'
                    : state === 'thinking'
                    ? 'bg-gradient-to-br from-purple-500 to-violet-600 animate-pulse'
                    : state === 'speaking'
                    ? 'bg-gradient-to-br from-blue-500 to-cyan-600'
                    : 'bg-gradient-to-br from-indigo-500 to-purple-600 hover:scale-105'
                }`}
              >
                {state === 'listening' ? (
                  <MicOff className="w-6 h-6 text-white" />
                ) : (
                  <Mic className="w-6 h-6 text-white" />
                )}
              </button>

              {/* Right controls */}
              <div className="flex items-center gap-2">
                {convo.length > 0 && (
                  <button
                    onClick={() => { setConvo([]); setLocalItem('stash_ai_conversation', []); }}
                    className="p-2.5 rounded-xl bg-white/5 text-gray-400 hover:text-red-400 transition-colors"
                    title="Clear conversation"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={startEnrollment}
                  className="p-2.5 rounded-xl bg-white/5 text-gray-400 hover:text-white transition-colors"
                  title="Register a face"
                >
                  <UserPlus className="w-4 h-4" />
                </button>
                {faces.length > 0 && (
                  <div className="relative group">
                    <button className="p-2.5 rounded-xl bg-white/5 text-gray-400 hover:text-white transition-colors" title={`${faces.length} enrolled user${faces.length > 1 ? 's' : ''}`}>
                      <User className="w-4 h-4" />
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">{faces.length}</span>
                    </button>
                    <div className="absolute bottom-full right-0 mb-2 bg-gray-900 border border-gray-700 rounded-xl p-2 shadow-xl hidden group-hover:block min-w-[160px]">
                      {faces.map(f => (
                        <div key={f.id} className="flex items-center justify-between py-1 px-2 text-xs">
                          <span className="text-gray-300">{f.name} <span className="text-gray-600">({f.role})</span></span>
                          <button onClick={() => deleteUser(f.id)} className="text-red-500 hover:text-red-400 ml-2">×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Suggestion chips */}
            {convo.length === 0 && state === 'idle' && (
              <div className="max-w-2xl mx-auto mt-3 flex flex-wrap gap-2 justify-center">
                {[
                  "What's on fire?",
                  "What should I focus on?",
                  "What shipped today?",
                  "How many not on Deco?",
                  "Who's overdue?",
                  "Quick summary",
                ].map(q => (
                  <button
                    key={q}
                    onClick={() => { unlockAudio(); setConvo([]); handleInput(q); }}
                    className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default VoiceAssistant;
