-- ═══════════════════════════════════════════════════════════════════
-- AI Consciousness Tables — Persistent learning & awareness memory
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ═══════════════════════════════════════════════════════════════════

-- 1. ai_observations — Notable moments the AI witnessed through the camera
-- Stores significant visual events: gestures, expressions, arrivals, objects
CREATE TABLE IF NOT EXISTS ai_observations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_name text NOT NULL,
  observation_type text NOT NULL, -- 'gesture', 'expression', 'arrival', 'departure', 'object', 'interaction', 'environment', 'posture'
  detail text NOT NULL, -- Natural language description of what was observed
  context jsonb DEFAULT '{}', -- Additional structured data: {expression, gaze, people_count, objects, etc}
  mood_at_time text, -- User's detected mood when this happened
  session_id text, -- Links to the session this happened in
  created_at timestamptz DEFAULT now()
);

-- Index for fast user lookups and recent observations
CREATE INDEX IF NOT EXISTS idx_observations_user ON ai_observations(user_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_type ON ai_observations(observation_type, created_at DESC);

-- 2. ai_learned_patterns — Patterns the AI has extracted over time
-- "Brian arrives between 8:50-9:10", "When stressed, he rubs his face"
CREATE TABLE IF NOT EXISTS ai_learned_patterns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_name text, -- NULL = applies to everyone / environment
  pattern_type text NOT NULL, -- 'routine', 'behavior', 'preference', 'habit', 'reaction', 'social'
  pattern text NOT NULL, -- Natural language description of the pattern
  confidence real DEFAULT 0.5, -- 0.0 to 1.0, increases with evidence
  evidence_count int DEFAULT 1, -- How many times this has been confirmed
  last_seen timestamptz DEFAULT now(),
  first_seen timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}', -- Extra context: {times_of_day, frequency, etc}
  active boolean DEFAULT true, -- Can be retired if pattern stops matching
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patterns_user ON ai_learned_patterns(user_name, active, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_type ON ai_learned_patterns(pattern_type);

-- 3. ai_entity_knowledge — Facts the AI knows about people, objects, environment
-- "Brian drinks coffee with milk", "The printer is in the back room"
CREATE TABLE IF NOT EXISTS ai_entity_knowledge (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entity text NOT NULL, -- Person name, object name, or 'environment'
  category text NOT NULL, -- 'preference', 'fact', 'relationship', 'work_style', 'personal', 'physical', 'environment'
  fact text NOT NULL, -- The actual knowledge: "prefers direct answers"
  source text NOT NULL, -- 'conversation', 'observation', 'inference', 'told_directly'
  confidence real DEFAULT 0.7, -- How sure the AI is about this
  times_confirmed int DEFAULT 1, -- Reinforcement counter
  last_confirmed timestamptz DEFAULT now(),
  superseded_by uuid REFERENCES ai_entity_knowledge(id), -- If a newer fact replaces this one
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_entity ON ai_entity_knowledge(entity, category);
CREATE INDEX IF NOT EXISTS idx_knowledge_active ON ai_entity_knowledge(entity) WHERE superseded_by IS NULL;

-- 4. Cleanup function — prune old observations (keep last 500 per user)
CREATE OR REPLACE FUNCTION prune_old_observations()
RETURNS void AS $$
BEGIN
  DELETE FROM ai_observations
  WHERE id IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY user_name ORDER BY created_at DESC) as rn
      FROM ai_observations
    ) ranked WHERE rn > 500
  );
END;
$$ LANGUAGE plpgsql;
