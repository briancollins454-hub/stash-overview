import { ApiSettings } from '../components/SettingsModal';

export interface AlertRule {
  id: string;
  name: string;
  type: 'stuck_orders' | 'low_stock' | 'production_late' | 'job_failed' | 'custom';
  enabled: boolean;
  threshold?: number;
  webhookUrl?: string;  // Slack webhook URL
  emailTo?: string;     // Email recipients (comma-separated)
  lastTriggered?: number;
  cooldownMinutes: number; // Prevent alert spam
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  message: string;
  timestamp: number;
  delivered: boolean;
  channel: 'slack' | 'email' | 'browser';
}

const STORAGE_KEY = 'stash_alert_rules';
const EVENTS_KEY = 'stash_alert_events';

export function loadAlertRules(): AlertRule[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : getDefaultRules();
  } catch {
    return getDefaultRules();
  }
}

export function saveAlertRules(rules: AlertRule[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
}

export function loadAlertEvents(): AlertEvent[] {
  try {
    const saved = localStorage.getItem(EVENTS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function saveAlertEvent(event: AlertEvent) {
  const events = loadAlertEvents();
  events.unshift(event);
  // Keep only last 100 events
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events.slice(0, 100)));
}

function getDefaultRules(): AlertRule[] {
  return [
    {
      id: 'stuck-5d',
      name: 'Orders stuck 5+ days without Deco job',
      type: 'stuck_orders',
      enabled: false,
      threshold: 5,
      cooldownMinutes: 60,
    },
    {
      id: 'production-late',
      name: 'Production overdue (past SLA target)',
      type: 'production_late',
      enabled: false,
      cooldownMinutes: 120,
    },
    {
      id: 'low-stock',
      name: 'Stock below reorder point',
      type: 'low_stock',
      threshold: 5,
      enabled: false,
      cooldownMinutes: 240,
    },
  ];
}

/**
 * Sends a Slack webhook notification.
 */
export async function sendSlackAlert(webhookUrl: string, message: string): Promise<boolean> {
  try {
    // Use the proxy to avoid CORS issues
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message,
          username: 'Stash Shop Sync',
          icon_emoji: ':package:',
        }),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Sends an email alert via a simple Supabase Edge Function (or similar).
 * This is a stub — in production you'd call your email service endpoint.
 */
export async function sendEmailAlert(
  settings: ApiSettings,
  to: string,
  subject: string,
  body: string
): Promise<boolean> {
  // In production, call a Supabase Edge Function or dedicated email API
  console.log(`[EMAIL ALERT] To: ${to}, Subject: ${subject}, Body: ${body}`);
  // For now, record it as a browser notification
  if (Notification.permission === 'granted') {
    new Notification(subject, { body });
  }
  return true;
}

/**
 * Evaluates alert rules against current state and fires notifications.
 */
export async function evaluateAlerts(
  rules: AlertRule[],
  stats: { notOnDeco5Plus: number; late: number },
  settings: ApiSettings,
  lowStockCount?: number
): Promise<AlertEvent[]> {
  const events: AlertEvent[] = [];
  const now = Date.now();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    // Check cooldown
    if (rule.lastTriggered && now - rule.lastTriggered < rule.cooldownMinutes * 60 * 1000) continue;

    let shouldFire = false;
    let message = '';

    switch (rule.type) {
      case 'stuck_orders':
        if (stats.notOnDeco5Plus > 0) {
          shouldFire = true;
          message = `⚠️ ${stats.notOnDeco5Plus} orders have been waiting 5+ days without a Deco job.`;
        }
        break;
      case 'production_late':
        if (stats.late > 0) {
          shouldFire = true;
          message = `🚨 ${stats.late} orders are past their SLA target date.`;
        }
        break;
      case 'low_stock':
        if (lowStockCount && lowStockCount > 0) {
          shouldFire = true;
          message = `📦 ${lowStockCount} stock items are below their reorder point.`;
        }
        break;
    }

    if (shouldFire) {
      rule.lastTriggered = now;

      if (rule.webhookUrl) {
        const delivered = await sendSlackAlert(rule.webhookUrl, message);
        events.push({
          id: `${rule.id}-${now}`,
          ruleId: rule.id,
          ruleName: rule.name,
          message,
          timestamp: now,
          delivered,
          channel: 'slack',
        });
      }

      if (rule.emailTo) {
        const delivered = await sendEmailAlert(settings, rule.emailTo, `Stash Alert: ${rule.name}`, message);
        events.push({
          id: `${rule.id}-email-${now}`,
          ruleId: rule.id,
          ruleName: rule.name,
          message,
          timestamp: now,
          delivered,
          channel: 'email',
        });
      }

      // Always send browser notification
      if (Notification.permission === 'granted') {
        new Notification(`Stash Alert: ${rule.name}`, { body: message });
      }
      events.push({
        id: `${rule.id}-browser-${now}`,
        ruleId: rule.id,
        ruleName: rule.name,
        message,
        timestamp: now,
        delivered: true,
        channel: 'browser',
      });
    }
  }

  if (events.length > 0) {
    saveAlertRules(rules);
    events.forEach(e => saveAlertEvent(e));
  }

  return events;
}
