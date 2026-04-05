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
  type: 'silence' | 'time' | 'data' | 'return' | 'vibe' | 'change';
  message: string;
  priority: number; // 1-10
}

export interface FullStats {
  late: number;
  readyForShipping: number;
  unfulfilled: number;
  dueSoon: number;
  notOnDeco: number;
  notOnDeco5Plus: number;
  notOnDeco10Plus: number;
  orderComplete: number;
  fulfilled7d: number;
  stockReady: number;
  mappingGap: number;
  productionAfterDispatch: number;
}

// Pick a random item from an array
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// Actively scans all metrics, detects changes, comments on both good and bad
function scanData(stats: FullStats, prevStats: FullStats | null, userName?: string): AmbientTrigger | null {
  const name = userName || 'mate';
  const observations: AmbientTrigger[] = [];

  // ── CHANGE DETECTION — most interesting when things shift ──
  if (prevStats) {
    const overdueDelta = stats.late - prevStats.late;
    const readyDelta = stats.readyForShipping - prevStats.readyForShipping;
    const completedDelta = stats.orderComplete - prevStats.orderComplete;
    const shippedDelta = stats.fulfilled7d - prevStats.fulfilled7d;
    const notOnDecoDelta = stats.notOnDeco - prevStats.notOnDeco;
    const dueSoonDelta = stats.dueSoon - prevStats.dueSoon;

    // Overdue went UP
    if (overdueDelta > 0) {
      observations.push({ type: 'change', priority: 8, message: pick([
        `Right... ${overdueDelta} more order${overdueDelta > 1 ? 's have' : ' has'} gone overdue. We're at ${stats.late} total now.`,
        `That overdue number just went up by ${overdueDelta}. ${stats.late} total. Not ideal.`,
        `Another ${overdueDelta} overdue. ${stats.late} and counting. Might want to look at that, ${name}.`,
      ])});
    }

    // Overdue went DOWN — celebrate!
    if (overdueDelta < 0) {
      observations.push({ type: 'change', priority: 7, message: pick([
        `Oh nice, overdue dropped by ${Math.abs(overdueDelta)}. Down to ${stats.late} now. Progress.`,
        `That overdue count just went down. ${stats.late} now. Someone's been busy.`,
        `${Math.abs(overdueDelta)} fewer overdue than before. I like this trend.`,
      ])});
    }

    // New orders completed
    if (completedDelta > 0) {
      observations.push({ type: 'change', priority: 6, message: pick([
        `${completedDelta} more order${completedDelta > 1 ? 's' : ''} just hit 100% complete. ${stats.orderComplete} total ready.`,
        `Nice one. ${completedDelta} order${completedDelta > 1 ? 's' : ''} finished. That's what I like to see.`,
        `Someone's smashing it — ${completedDelta} order${completedDelta > 1 ? 's' : ''} just completed.`,
      ])});
    }

    // New orders ready to ship
    if (readyDelta > 0) {
      observations.push({ type: 'change', priority: 6, message: pick([
        `${readyDelta} more order${readyDelta > 1 ? 's are' : ' is'} ready to ship. ${stats.readyForShipping} waiting to go out the door.`,
        `Heads up, ${readyDelta} just became ready to ship. Don't let them sit there too long.`,
      ])});
    }

    // Orders shipped
    if (shippedDelta > 0) {
      observations.push({ type: 'change', priority: 5, message: pick([
        `${shippedDelta} order${shippedDelta > 1 ? 's' : ''} shipped. We've done ${stats.fulfilled7d} this week.`,
        `Another ${shippedDelta} out the door. ${stats.fulfilled7d} shipped in the last 7 days. Solid.`,
      ])});
    }

    // Not on Deco increasing
    if (notOnDecoDelta > 2) {
      observations.push({ type: 'change', priority: 7, message: pick([
        `${notOnDecoDelta} more orders not on Deco. ${stats.notOnDeco} total now, ${stats.notOnDeco5Plus} of those over 5 days. That queue needs attention.`,
        `The "not on Deco" pile just grew by ${notOnDecoDelta}. We're at ${stats.notOnDeco} now.`,
      ])});
    }

    // Due soon spike
    if (dueSoonDelta > 3) {
      observations.push({ type: 'change', priority: 7, message: pick([
        `Careful — ${dueSoonDelta} more orders just entered the "due soon" zone. ${stats.dueSoon} total ticking.`,
        `Due soon count jumped by ${dueSoonDelta}. ${stats.dueSoon} orders on the clock now.`,
      ])});
    }
  }

  // ── STATIC OBSERVATIONS — comment on current state ──

  // Overdue situation
  if (stats.late === 0) {
    observations.push({ type: 'data', priority: 6, message: pick([
      `Zero overdue, by the way. Clean sheet. Enjoy it while it lasts.`,
      `Not a single overdue order right now. Savour that.`,
      `Overdue count is zero. I'm almost suspicious.`,
    ])});
  } else if (stats.late > 20) {
    observations.push({ type: 'data', priority: 8, message: pick([
      `${stats.late} overdue. That's... a lot. Might be worth a deep dive into what's blocking things.`,
      `We're at ${stats.late} overdue now. Something's clearly stuck in the pipeline.`,
    ])});
  } else if (stats.late > 10) {
    observations.push({ type: 'data', priority: 6, message: pick([
      `${stats.late} overdue. Not catastrophic but not great either.`,
      `Overdue's sitting at ${stats.late}. Could use some attention.`,
    ])});
  }

  // Ready to ship sitting there
  if (stats.readyForShipping > 5) {
    observations.push({ type: 'data', priority: 5, message: pick([
      `${stats.readyForShipping} orders just sitting there ready to ship. That's revenue waiting to leave the building.`,
      `We've got ${stats.readyForShipping} ready to go. Might want to get those moving.`,
    ])});
  }

  // Stock ready — positive
  if (stats.stockReady > 5) {
    observations.push({ type: 'data', priority: 4, message: pick([
      `${stats.stockReady} orders with stock ready. Good position to be in.`,
      `Stock's looking healthy — ${stats.stockReady} orders with everything in hand.`,
    ])});
  }

  // Due soon pressure
  if (stats.dueSoon > 15) {
    observations.push({ type: 'data', priority: 7, message: pick([
      `${stats.dueSoon} orders due soon. Tomorrow's going to be fun.`,
      `Big wave incoming — ${stats.dueSoon} orders due shortly. Might want to prioritise.`,
    ])});
  }

  // Not on Deco — long waiters
  if (stats.notOnDeco10Plus > 3) {
    observations.push({ type: 'data', priority: 7, message: pick([
      `${stats.notOnDeco10Plus} orders have been waiting over 10 days to get onto Deco. That's too long.`,
      `Quick one — ${stats.notOnDeco10Plus} orders sitting over 10 days with no Deco job. Customers won't be happy.`,
    ])});
  } else if (stats.notOnDeco5Plus > 5) {
    observations.push({ type: 'data', priority: 5, message: pick([
      `${stats.notOnDeco5Plus} orders over 5 days without a Deco job. Worth chasing.`,
      `Not on Deco for 5+ days: ${stats.notOnDeco5Plus} orders. That queue's getting stale.`,
    ])});
  }

  // Mapping gaps
  if (stats.mappingGap > 5) {
    observations.push({ type: 'data', priority: 4, message: pick([
      `${stats.mappingGap} mapping gaps still. Not urgent but they'll cause confusion eventually.`,
      `We've got ${stats.mappingGap} items with mapping gaps. Might want to sort those when you get a chance.`,
    ])});
  }

  // Production after dispatch — bad
  if (stats.productionAfterDispatch > 0) {
    observations.push({ type: 'data', priority: 8, message: pick([
      `Hang on — ${stats.productionAfterDispatch} order${stats.productionAfterDispatch > 1 ? 's have' : ' has'} production happening after dispatch. That shouldn't be right.`,
      `${stats.productionAfterDispatch} with production after dispatch. That's either a data issue or we've shipped incomplete orders.`,
    ])});
  }

  // Shipped this week — positive commentary
  if (stats.fulfilled7d > 20) {
    observations.push({ type: 'data', priority: 4, message: pick([
      `${stats.fulfilled7d} shipped this week. Decent output.`,
      `We've pushed out ${stats.fulfilled7d} orders in 7 days. Not bad at all.`,
    ])});
  }

  // Overall health check
  if (stats.late === 0 && stats.readyForShipping > 0 && stats.notOnDeco < 5) {
    observations.push({ type: 'data', priority: 5, message: pick([
      `Actually... things are looking pretty good right now. No overdue, ${stats.readyForShipping} ready to ship, only ${stats.notOnDeco} not on Deco. Rare day.`,
      `I've been looking at the numbers and honestly... not bad. Not bad at all.`,
    ])});
  }

  // Unfulfilled volume
  if (stats.unfulfilled > 100) {
    observations.push({ type: 'data', priority: 4, message: pick([
      `${stats.unfulfilled} unfulfilled orders in the system. Busy times.`,
      `Total pipeline is ${stats.unfulfilled} orders. That's a full plate.`,
    ])});
  }

  // Completed orders — milestone check
  if (stats.orderComplete > 10) {
    observations.push({ type: 'data', priority: 4, message: pick([
      `${stats.orderComplete} orders at 100% complete. Let's get those shipped.`,
      `There's ${stats.orderComplete} fully complete orders. They should be going out, no?`,
    ])});
  }

  // Return ONE observation — with dedup to avoid repeating the same category
  if (observations.length > 0) {
    // Filter out recently-used categories if we have alternatives
    const recentTypes = (globalThis as any).__recentAmbientCategories || [];
    const fresh = observations.filter(o => !recentTypes.includes(getCategoryKey(o)));
    const pool = fresh.length > 0 ? fresh : observations; // fallback to all if everything's been said
    
    // Weighted random: higher priority = more tickets in the lottery, but not dominant
    const weighted: AmbientTrigger[] = [];
    for (const obs of pool) {
      const tickets = Math.max(1, obs.priority - 2); // priority 4=2 tickets, 8=6 tickets
      for (let i = 0; i < tickets; i++) weighted.push(obs);
    }
    const chosen = pick(weighted);
    
    // Track this category as recently used (keep last 5)
    const catKey = getCategoryKey(chosen);
    const recent: string[] = [...recentTypes, catKey].slice(-5);
    (globalThis as any).__recentAmbientCategories = recent;
    
    return chosen;
  }

  return null;
}

// Extract a category key from a trigger for dedup tracking
function getCategoryKey(trigger: AmbientTrigger): string {
  const msg = trigger.message.toLowerCase();
  if (msg.includes('overdue')) return 'overdue';
  if (msg.includes('ready to ship') || msg.includes('ready to go')) return 'ready_to_ship';
  if (msg.includes('not on deco') || msg.includes('deco job')) return 'not_on_deco';
  if (msg.includes('due soon') || msg.includes('due shortly')) return 'due_soon';
  if (msg.includes('complete') || msg.includes('finished')) return 'completed';
  if (msg.includes('shipped') || msg.includes('out the door')) return 'shipped';
  if (msg.includes('mapping gap')) return 'mapping';
  if (msg.includes('stock ready') || msg.includes('stock')) return 'stock';
  if (msg.includes('production after dispatch')) return 'prod_after_dispatch';
  if (msg.includes('unfulfilled') || msg.includes('pipeline')) return 'unfulfilled';
  if (msg.includes('looking pretty good') || msg.includes('not bad')) return 'health_check';
  return trigger.type + '_' + trigger.priority;
}

export function getAmbientTriggers(context: {
  silenceSeconds: number;
  stats: FullStats;
  prevStats: FullStats | null;
  hour: number;
  dayOfWeek: number;
  personality: AIPersonalityState;
  userPresent: boolean;
  userJustReturned: boolean;
  lastAmbientTs: number;
  userName?: string;
}): AmbientTrigger | null {
  const { silenceSeconds, stats, prevStats, hour, dayOfWeek, personality, userPresent, userJustReturned, lastAmbientTs, userName } = context;
  const timeSinceLastAmbient = (Date.now() - lastAmbientTs) / 1000;

  // Don't trigger too often — minimum 90 seconds between ambient comments
  if (timeSinceLastAmbient < 90) return null;

  // User just came back after being away
  if (userJustReturned && timeSinceLastAmbient > 300) {
    const name = userName || 'mate';
    return { type: 'return', priority: 7, message: pick([
      `Oh, ${name}'s back. Miss me?`,
      `There you are. I was starting to get bored.`,
      `Welcome back. Nothing burned down while you were gone.`,
      `Ah, the prodigal returns.`,
      `Back already? Felt like ages.`,
    ])};
  }

  // ── DATA CHANGES — react immediately to metric shifts ──
  if (prevStats && timeSinceLastAmbient > 90) {
    const change = scanData(stats, prevStats, userName);
    if (change && change.priority >= 6) return change;
  }

  // ── ACTIVE DATA SCANNING — proactively check things every few minutes ──
  if (userPresent && silenceSeconds > 120 && timeSinceLastAmbient > 180) {
    const observation = scanData(stats, null, userName);
    if (observation) return observation;
  }

  // ── TIME-BASED ──
  if (hour === 9 && timeSinceLastAmbient > 600) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const morningTail = stats.late === 0 ? 'Clean start.' : 'Got some catching up to do.';
    return { type: 'time', priority: 5, message: pick([
      `Right then, ${dayNames[dayOfWeek]} morning. ${stats.unfulfilled} orders in the pipe, ${stats.late} overdue, ${stats.readyForShipping} ready to ship. Let's go.`,
      `Morning. Quick status — ${stats.late} overdue, ${stats.dueSoon} due soon, ${stats.readyForShipping} ready to go. ${morningTail}`,
    ])};
  }
  if (hour === 12 && timeSinceLastAmbient > 600) {
    const noonTail = stats.late > 0 ? `Still ${stats.late} overdue though.` : 'And zero overdue. Nice.';
    return { type: 'time', priority: 3, message: pick([
      `Midday check — ${stats.late} overdue, ${stats.orderComplete} complete, ${stats.readyForShipping} ready to ship. Also... have you eaten?`,
      `Noon. We've shipped ${stats.fulfilled7d} this week so far. ${noonTail}`,
    ])};
  }
  if (hour === 15 && timeSinceLastAmbient > 600) {
    const afternoonMsg1 = stats.dueSoon > 5
      ? `Afternoon check. ${stats.readyForShipping} ready to ship — still time to get those out today. And ${stats.dueSoon} due soon, so tomorrow's going to be busy.`
      : `Afternoon check. ${stats.readyForShipping} ready to ship — still time to get those out today.`;
    const afternoonMsg2 = stats.late > 0
      ? `Three o'clock. ${stats.unfulfilled} still in the pipe. ${stats.late} overdue. Anything I can help chase?`
      : `Three o'clock. ${stats.unfulfilled} still in the pipe. No overdue though, so we're in good shape.`;
    return { type: 'time', priority: 4, message: pick([afternoonMsg1, afternoonMsg2]) };
  }
  if (hour === 17 && dayOfWeek >= 1 && dayOfWeek <= 5 && timeSinceLastAmbient > 600) {
    const eodMsg1 = stats.late === 0
      ? `End of day. We shipped ${stats.fulfilled7d} this week. Clean finish. See you tomorrow.`
      : `End of day. We shipped ${stats.fulfilled7d} this week. ${stats.late} overdue carrying into tomorrow though.`;
    const eodMsg2 = stats.readyForShipping > 0
      ? `Five o'clock. Another day survived. ${stats.readyForShipping} still ready to ship if you want to squeeze those out.`
      : `Five o'clock. Another day survived. Everything that could go out, went out.`;
    return { type: 'time', priority: 3, message: pick([eodMsg1, eodMsg2]) };
  }
  if (dayOfWeek === 5 && hour === 16 && timeSinceLastAmbient > 600) {
    const fridayTail = stats.late === 0 ? 'Clean weekend for once.' : 'Those overdue ones will be waiting Monday.';
    return { type: 'time', priority: 4, message: `Right then... Friday at four. ${stats.fulfilled7d} shipped this week, ${stats.late} overdue. ${fridayTail} Finish line's in sight, mate.` };
  }

  // ── SILENCE / VIBE — only after long quiet periods ──
  if (userPresent && silenceSeconds > 600 && timeSinceLastAmbient > 600) {
    return { type: 'silence', priority: 2, message: pick([
      "Hmm. You've gone quiet. Need me to check on anything?",
      "I'm here if you need me. Just... keeping an eye on things.",
      "The silence is actually quite nice. Don't tell anyone I said that.",
      `Quick thought — we've got ${stats.unfulfilled} orders in play. Want me to flag anything specific?`,
    ])};
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
