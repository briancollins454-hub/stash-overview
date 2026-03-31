import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNotifications } from '../hooks/useNotifications';

describe('useNotifications', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a notify function', () => {
    const { result } = renderHook(() => useNotifications());
    expect(typeof result.current.notify).toBe('function');
  });

  it('does not throw when Notification is unavailable', () => {
    const original = globalThis.Notification;
    // @ts-ignore
    delete globalThis.Notification;

    const { result } = renderHook(() => useNotifications());
    expect(() => result.current.notify('test')).not.toThrow();

    globalThis.Notification = original;
  });

  it('does not notify when tab is focused', () => {
    const mockNotification = vi.fn();
    vi.stubGlobal('Notification', Object.assign(mockNotification, { permission: 'granted', requestPermission: vi.fn() }));
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    const { result } = renderHook(() => useNotifications());
    result.current.notify('test');

    expect(mockNotification).not.toHaveBeenCalled();
  });
});
