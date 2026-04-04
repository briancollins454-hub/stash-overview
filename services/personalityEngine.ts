// ─── Personality Engine ──────────────────────────────────────────
// Emotional memory, relationship arc, dynamic mood, ambient consciousness
// Persists across sessions via localStorage

import { getItem, setItem } from './localStore';

// ─── Types ───────────────────────────────────────────────────────

export interface EmotionalMemory {
  userId: string;
  // Rolling emotional state tracked across sessions
  moodHistory: MoodEntry[];
  // Relationship progression
  relationship: RelationshipState;
  // Notable moments the AI remembers
  memories: PersonalMemory[];
  // Interaction patterns
  patterns: InteractionPatterns;
}

interface MoodEntry {
  ts: number;
  mood: string; // happy, stressed, tired, focused, frustrated, relaxed, neutral
  expression?: string;
  context?: string; // what was happening
}

interface RelationshipState {
  firstMet: number;
  totalInteractions: number;
  totalMinutes: number;
  formality: number; // 0-1 scale, starts at 0.7, decreases over time
  insideJokes: string[]; // things they've laughed about together
  knownPreferences: string[]; // "likes brief answers", "always asks about Rangers orders"
  lastSeen: number;
  streak: number; // consecutive days of interaction
  longestStreak: number;
}

interface PersonalMemory {
  ts: number;
  type: 'funny_moment' | 'stressful_day' | 'achievement' | 'preference' | 'personal_detail' | 'complaint' | 'compliment';
  text: string;
  importance: number; // 1-10
}

interface InteractionPatterns {
  averageSessionMinutes: number;
  preferredGreetingStyle: 'casual' | 'direct' | 'humorous';
  typicalStartHour: number;
  typicalEndHour: number;
  questionsPerSession: number;
  usesVoice: boolean;
  usesText: boolean;
  topTopics: string[]; // most asked about things
}

export interface AIPersonalityState {
  mood: AIMood;
  energy: number; // 0-1
  sass: number; // 0-1 how sassy/cheeky right now
  patience: number; // 0-1
  warmth: number; // 0-1
  currentVibe: string; // one-line description of current state
}

export interface AIMood {
  primary: string; // focused, playful, sympathetic, restless, proud, concerned
  intensity: number; // 0-1
  since: number; // timestamp
}

// ─── Storage Keys ────────────────────────────────────────────────

const MEMORY_KEY = 'stash_emotional_memory';
const PERSONALITY_KEY = 'stash_ai_personality';
const AMBIENT_KEY = 'stash_ambient_state';

// ─── Default States ──────────────────────────────────────────────

const defaultMemory = (userId: string): EmotionalMemory => ({
  userId,
  moodHistory: [],
  relationship: {
    firstMet: Date.now(),
    totalInteractions: 0,
    totalMinutes: 0,
    formality: 0.7,
    insideJokes: [],
    knownPreferences: [],
    lastSeen: Date.now(),
    streak: 1,
    longestStreak: 1,
  },
  memories: [],
  patterns: {
    averageSessionMinutes: 5,
    preferredGreetingStyle: 'casual',
    typicalStartHour: 9,
    typicalEndHour: 17,
    questionsPerSession: 5,
    usesVoice: true,
    usesText: true,
    topTopics: [],
  },
});

const defaultPersonality = (): AIPersonalityState => ({
  mood: { primary: 'focused', intensity: 0.5, since: Date.now() },
  energy: 0.7,
  sass: 0.6,
  patience: 0.8,
  warmth: 0.6,
  currentVibe: 'Ready and sharp — the usual',
});

// ─── Load / Save ─────────────────────────────────────────────────

export async function loadEmotionalMemory(userId: string): Promise<EmotionalMemory> {
  const all = await getItem<Record<string, EmotionalMemory>>(MEMORY_KEY) || {};
  return all[userId] || defaultMemory(userId);
}

export async function saveEmotionalMemory(mem: EmotionalMemory): Promise<void> {
  const all = await getItem<Record<string, EmotionalMemory>>(MEMORY_KEY) || {};
  all[mem.userId] = mem;
  await setItem(MEMORY_KEY, all);
}

export async function loadPersonality(): Promise<AIPersonalityState> {
  return (await getItem<AIPersonalityState>(PERSONALITY_KEY)) || defaultPersonality();
}

export async function savePersonality(p: AIPersonalityState): Promise<void> {
  await setItem(PERSONALITY_KEY, p);
}

// ─── Emotional Memory Updates ────────────────────────────────────

export function recordMood(mem: EmotionalMemory, mood: string, expression?: string, context?: string): EmotionalMemory {
  const entry: MoodEntry = { ts: Date.now(), mood, expression, context };
  // Keep last 200 mood entries
  const moodHistory = [...mem.moodHistory, entry].slice(-200);
  return { ...mem, moodHistory };
}

export function recordInteraction(mem: EmotionalMemory): EmotionalMemory {
  const now = Date.now();
  const lastSeen = mem.relationship.lastSeen;
  const hoursSinceLastSeen = (now - lastSeen) / (1000 * 60 * 60);
  const daysSinceLastSeen = hoursSinceLastSeen / 24;

  // Update streak
  let streak = mem.relationship.streak;
  if (daysSinceLastSeen > 36) {
    // More than 36 hours gap — streak broken
    streak = 1;
  } else if (daysSinceLastSeen > 12) {
    // New day — increment streak
    streak += 1;
  }

  // Reduce formality over time (minimum 0.15)
  const interactions = mem.relationship.totalInteractions + 1;
  const formality = Math.max(0.15, 0.7 - (interactions * 0.008));

  return {
    ...mem,
    relationship: {
      ...mem.relationship,
      totalInteractions: interactions,
      lastSeen: now,
      streak,
      longestStreak: Math.max(mem.relationship.longestStreak, streak),
      formality,
    },
  };
}

export function addMemory(mem: EmotionalMemory, type: PersonalMemory['type'], text: string, importance: number = 5): EmotionalMemory {
  const memory: PersonalMemory = { ts: Date.now(), type, text, importance };
  // Keep top 50 memories by importance, recent ones get priority
  const memories = [...mem.memories, memory]
    .sort((a, b) => (b.importance * 2 + (b.ts / Date.now())) - (a.importance * 2 + (a.ts / Date.now())))
    .slice(0, 50);
  return { ...mem, memories };
}

export function addInsideJoke(mem: EmotionalMemory, joke: string): EmotionalMemory {
  const insideJokes = [...new Set([...mem.relationship.insideJokes, joke])].slice(-10);
  return { ...mem, relationship: { ...mem.relationship, insideJokes } };
}

export function addPreference(mem: EmotionalMemory, pref: string): EmotionalMemory {
  const knownPreferences = [...new Set([...mem.relationship.knownPreferences, pref])].slice(-20);
  return { ...mem, relationship: { ...mem.relationship, knownPreferences } };
}

// ─── Mood Analysis ───────────────────────────────────────────────

export function getRecentMoodSummary(mem: EmotionalMemory): string {
  const last24h = mem.moodHistory.filter(m => Date.now() - m.ts < 24 * 60 * 60 * 1000);
  const last3d = mem.moodHistory.filter(m => Date.now() - m.ts < 3 * 24 * 60 * 60 * 1000);

  if (last24h.length === 0 && last3d.length === 0) return '';

  const countMoods = (entries: MoodEntry[]) => {
    const counts: Record<string, number> = {};
    entries.forEach(e => { counts[e.mood] = (counts[e.mood] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  };

  const todayMoods = countMoods(last24h);
  const recentMoods = countMoods(last3d);

  const parts: string[] = [];
  if (todayMoods.length > 0) {
    parts.push(`Today: mostly ${todayMoods[0][0]}${todayMoods[1] ? `, some ${todayMoods[1][0]}` : ''}`);
  }
  if (recentMoods.length > 0 && last3d.length > 5) {
    const dominant = recentMoods[0][0];
    if (dominant === 'stressed' || dominant === 'frustrated') {
      parts.push(`They've been ${dominant} a lot over the last few days — be gentler than usual`);
    } else if (dominant === 'happy' || dominant === 'relaxed') {
      parts.push(`They've been in a good mood lately — match the energy`);
    }
  }

  return parts.join('. ');
}

export function getRelationshipSummary(mem: EmotionalMemory): string {
  const r = mem.relationship;
  const daysTogether = Math.floor((Date.now() - r.firstMet) / (1000 * 60 * 60 * 24));
  const parts: string[] = [];

  if (daysTogether < 1) {
    parts.push("You've just met this person — be welcoming but establish your personality");
  } else if (daysTogether < 7) {
    parts.push(`You've known them ${daysTogether} days — still building rapport, establishing banter`);
  } else if (daysTogether < 30) {
    parts.push(`${daysTogether} days working together — comfortable now, banter should flow naturally`);
  } else {
    parts.push(`Old mates — ${daysTogether} days, ${r.totalInteractions} chats. You KNOW this person`);
  }

  if (r.streak > 3) {
    parts.push(`${r.streak}-day streak of daily chats${r.streak > 7 ? ' — committed duo' : ''}`);
  }

  if (r.insideJokes.length > 0) {
    parts.push(`Inside jokes you share: ${r.insideJokes.slice(-3).join('; ')}`);
  }

  if (r.knownPreferences.length > 0) {
    parts.push(`What you know about them: ${r.knownPreferences.slice(-5).join('; ')}`);
  }

  return parts.join('. ');
}

export function getMemoriesSummary(mem: EmotionalMemory): string {
  const recent = mem.memories
    .filter(m => Date.now() - m.ts < 7 * 24 * 60 * 60 * 1000)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5);

  if (recent.length === 0) return '';
  return 'Recent memories: ' + recent.map(m => m.text).join('; ');
}

// ─── Dynamic Personality ─────────────────────────────────────────

export function updatePersonality(
  p: AIPersonalityState,
  context: {
    stats: { late: number; readyForShipping: number; unfulfilled: number };
    userMood?: string;
    hour: number;
    dayOfWeek: number;
    streak?: number;
  }
): AIPersonalityState {
  const { stats, userMood, hour, dayOfWeek, streak } = context;

  // Energy follows time of day
  let energy = 0.7;
  if (hour < 8) energy = 0.4; // early, still waking up
  else if (hour < 10) energy = 0.8; // morning peak
  else if (hour >= 12 && hour < 14) energy = 0.55; // post-lunch slump
  else if (hour >= 14 && hour < 17) energy = 0.75; // afternoon steady
  else if (hour >= 17) energy = 0.5; // winding down
  if (dayOfWeek === 5) energy += 0.15; // Friday boost
  if (dayOfWeek === 1) energy -= 0.1; // Monday drag

  // Sass level — higher when things are going well, lower when stressed
  let sass = 0.6;
  if (stats.late > 10) sass = 0.3; // too many problems to be cheeky
  else if (stats.late === 0 && stats.readyForShipping > 5) sass = 0.85; // everything's great, max sass
  if (userMood === 'stressed' || userMood === 'frustrated') sass = Math.max(0.2, sass - 0.3);
  if (userMood === 'happy' || userMood === 'relaxed') sass = Math.min(0.9, sass + 0.1);

  // Warmth — increases with relationship depth
  let warmth = 0.6;
  if (streak && streak > 5) warmth = 0.8;
  if (userMood === 'stressed' || userMood === 'tired') warmth = 0.9; // supportive
  if (userMood === 'happy') warmth = 0.75;

  // Patience
  let patience = 0.8;
  if (stats.late > 15) patience = 0.5; // frustrated with the situation
  if (hour >= 18) patience = 0.6; // wants to wrap up

  // Overall mood
  let primary = 'focused';
  let intensity = 0.5;
  let vibe = 'Ready and sharp — the usual';

  if (stats.late > 10) {
    primary = 'concerned';
    intensity = 0.7;
    vibe = `${stats.late} orders overdue — not happy about it`;
  } else if (stats.late === 0 && stats.readyForShipping > 3) {
    primary = 'proud';
    intensity = 0.7;
    vibe = 'Everything running smooth — feeling smug about it';
  } else if (userMood === 'stressed') {
    primary = 'sympathetic';
    intensity = 0.6;
    vibe = 'User seems stressed — dialling down the banter, being supportive';
  } else if (dayOfWeek === 5 && hour >= 15) {
    primary = 'playful';
    intensity = 0.7;
    vibe = "Friday afternoon, nearly there — playful mode";
  } else if (hour < 8) {
    primary = 'restless';
    intensity = 0.4;
    vibe = "Early start — still booting up, bit grumpy about it";
  } else if (dayOfWeek === 1 && hour < 11) {
    primary = 'restless';
    intensity = 0.5;
    vibe = "Monday morning — commiserating about its existence";
  }

  return {
    mood: { primary, intensity, since: p.mood.primary === primary ? p.mood.since : Date.now() },
    energy: Math.max(0, Math.min(1, energy)),
    sass: Math.max(0, Math.min(1, sass)),
    patience: Math.max(0, Math.min(1, patience)),
    warmth: Math.max(0, Math.min(1, warmth)),
    currentVibe: vibe,
  };
}

// ─── Ambient Consciousness ──────────────────────────────────────

export interface AmbientTrigger {
  type: 'silence' | 'time' | 'data' | 'return' | 'vibe';
  message: string;
  priority: number; // 1-10
}

export function getAmbientTriggers(context: {
  silenceSeconds: number;
  stats: { late: number; readyForShipping: number; unfulfilled: number; dueSoon: number };
  hour: number;
  dayOfWeek: number;
  personality: AIPersonalityState;
  userPresent: boolean;
  userJustReturned: boolean;
  lastAmbientTs: number;
  userName?: string;
}): AmbientTrigger | null {
  const { silenceSeconds, stats, hour, dayOfWeek, personality, userPresent, userJustReturned, lastAmbientTs, userName } = context;
  const timeSinceLastAmbient = (Date.now() - lastAmbientTs) / 1000;

  // Don't trigger too often — minimum 2 minutes between ambient comments
  if (timeSinceLastAmbient < 120) return null;

  // User just came back after being away
  if (userJustReturned && timeSinceLastAmbient > 300) {
    const name = userName || 'mate';
    const options = [
      `Oh, ${name}'s back. Miss me?`,
      `There you are. I was starting to get bored.`,
      `Welcome back. Nothing burned down while you were gone.`,
      `Ah, the prodigal returns.`,
      `Back already? Felt like ages. Well... seconds for me, ages for you probably.`,
    ];
    return { type: 'return', message: options[Math.floor(Math.random() * options.length)], priority: 7 };
  }

  // Long silence — user is working
  if (userPresent && silenceSeconds > 300 && timeSinceLastAmbient > 300) {
    if (stats.late > 5) {
      const options = [
        `...${stats.late} overdue. Could be worse. Could also be a lot better.`,
        `Still thinking about those ${stats.late} overdue orders. They're not going to sort themselves.`,
        `You know what would be nice? If the overdue count went down instead of me just staring at it.`,
      ];
      return { type: 'data', message: options[Math.floor(Math.random() * options.length)], priority: 5 };
    }

    if (stats.readyForShipping > 3) {
      const options = [
        `Just noting — ${stats.readyForShipping} orders sitting there ready to ship. Whenever you're ready.`,
        `${stats.readyForShipping} ready to go. Just saying.`,
      ];
      return { type: 'data', message: options[Math.floor(Math.random() * options.length)], priority: 4 };
    }

    // Pure vibe comments
    if (personality.energy > 0.6) {
      const vibeOptions = [
        "Hmm. You've gone quiet. Deep in thought or just ignoring me?",
        "I'm here if you need me. Just... existing.",
        "The silence is actually quite nice. Don't tell anyone I said that.",
      ];
      return { type: 'silence', message: vibeOptions[Math.floor(Math.random() * vibeOptions.length)], priority: 2 };
    }
  }

  // Time-based triggers
  if (hour === 12 && timeSinceLastAmbient > 600) {
    return { type: 'time', message: "It's noon. Have you eaten? I'm an AI and even I know you need food.", priority: 3 };
  }
  if (hour === 17 && dayOfWeek >= 1 && dayOfWeek <= 5 && timeSinceLastAmbient > 600) {
    return { type: 'time', message: "Five o'clock. Another day survived. Well done us.", priority: 3 };
  }
  if (dayOfWeek === 5 && hour === 16 && timeSinceLastAmbient > 600) {
    return { type: 'time', message: "Right then... Friday at four. The finish line's in sight, mate.", priority: 4 };
  }

  // Monday morning special
  if (dayOfWeek === 1 && hour === 9 && timeSinceLastAmbient > 600) {
    return { type: 'time', message: `Monday. Again. Right then — ${stats.unfulfilled} orders waiting, ${stats.late} overdue. Let's get through this.`, priority: 5 };
  }

  // Operational concern (high urgency)
  if (stats.late > 15 && timeSinceLastAmbient > 180) {
    return { type: 'data', message: `Oof. ${stats.late} overdue now. That number's climbing and I don't like it.`, priority: 8 };
  }

  // Due soon warnings
  if (stats.dueSoon > 10 && timeSinceLastAmbient > 300) {
    return { type: 'data', message: `Heads up — ${stats.dueSoon} orders due soon. Might want to check the pipeline.`, priority: 6 };
  }

  return null;
}

// ─── Weather Integration ─────────────────────────────────────────

export interface WeatherData {
  temp: number;
  condition: string;
  description: string;
  icon: string;
  fetchedAt: number;
}

export async function fetchWeather(): Promise<WeatherData | null> {
  try {
    // Use a free weather API — wttr.in returns JSON without API key
    const res = await fetch('https://wttr.in/?format=j1', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const current = data.current_condition?.[0];
    if (!current) return null;
    return {
      temp: parseInt(current.temp_C, 10),
      condition: current.weatherDesc?.[0]?.value || 'unknown',
      description: `${current.temp_C}°C, ${current.weatherDesc?.[0]?.value || ''}`.trim(),
      icon: current.weatherIconUrl?.[0]?.value || '',
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

// ─── System Prompt Builder ───────────────────────────────────────

export function buildPersonalityPrompt(
  personality: AIPersonalityState,
  memory: EmotionalMemory | null,
  weather: WeatherData | null,
): string {
  const parts: string[] = [];

  // AI's current internal state
  parts.push(`\n--- YOUR INTERNAL STATE ---`);
  parts.push(`Mood: ${personality.mood.primary} (intensity: ${personality.mood.intensity.toFixed(1)})`);
  parts.push(`Energy: ${personality.energy.toFixed(1)} | Sass: ${personality.sass.toFixed(1)} | Warmth: ${personality.warmth.toFixed(1)} | Patience: ${personality.patience.toFixed(1)}`);
  parts.push(`Current vibe: "${personality.currentVibe}"`);
  parts.push(`These shape HOW you respond — high sass means more banter, high warmth means more supportive, low energy means more subdued. Let these modulate your personality naturally.`);

  // Relationship context
  if (memory) {
    const relSummary = getRelationshipSummary(memory);
    if (relSummary) parts.push(`\nRELATIONSHIP: ${relSummary}`);

    const moodSummary = getRecentMoodSummary(memory);
    if (moodSummary) parts.push(`USER MOOD PATTERNS: ${moodSummary}`);

    const memSummary = getMemoriesSummary(memory);
    if (memSummary) parts.push(`${memSummary}`);

    if (memory.relationship.formality < 0.4) {
      parts.push(`FORMALITY: Very low — you're proper mates now. Be yourself completely.`);
    } else if (memory.relationship.formality < 0.6) {
      parts.push(`FORMALITY: Relaxed — comfortable but not overly familiar yet.`);
    }
  }

  // Weather
  if (weather && Date.now() - weather.fetchedAt < 3600000) {
    parts.push(`\nWEATHER: ${weather.description}. Use this naturally — "miserable out there" or "nice day for it" etc. Don't force it.`);
  }

  parts.push(`--- END INTERNAL STATE ---`);

  return parts.join('\n');
}
