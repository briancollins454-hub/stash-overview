import { Job } from '../types';

const API_URL =
  import.meta.env.VITE_LABEL_PRINTER_API
  || 'https://www.stashoverview.co.uk/api/label-printer';

const DEMO_JOB: Job = {
  jobNumber: '999999',
  customerName: 'ACME CORP DEMO',
  jobName: 'SUMMER STAFF UNIFORMS 2024',
  dateScheduled: new Date().toISOString(),
  items: [
    { id: 'd1', description: 'Gildan 5000 - Navy - L x 50', quantity: 50, isReceived: true, receivedDate: new Date().toISOString() },
    { id: 'd2', description: 'Gildan 5000 - Navy - XL x 25', quantity: 25, isReceived: true, receivedDate: new Date().toISOString() },
    { id: 'd3', description: 'Gildan 5000 - Black - M x 10', quantity: 10, isReceived: false },
    { id: 'd4', description: 'Richardson 112 - Charcoal/Black x 100', quantity: 100, isReceived: true, receivedDate: new Date(Date.now() - 86400000).toISOString() },
  ],
};

export const searchJobApi = async (query: string): Promise<Job | null> => {
  if (query.toUpperCase() === 'DEMO') return DEMO_JOB;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || `Lookup failed (${response.status})`);
    }

    return payload?.job ?? null;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('Lookup timed out. Check your connection and try again.');
    }
    throw new Error(error.message || 'Could not reach the job lookup service.');
  } finally {
    clearTimeout(timeoutId);
  }
};
