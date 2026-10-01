import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queue: [] as unknown[],
  saveMapping: vi.fn(),
  getMappingUpdatedAt: vi.fn(),
}));

vi.mock('../services/localStore', () => ({
  getItem: vi.fn(async () => mocks.queue),
  setItem: vi.fn(async (_key: string, value: unknown[]) => {
    mocks.queue = structuredClone(value);
  }),
}));

vi.mock('../services/syncService', () => ({
  saveCloudMappingStrict: mocks.saveMapping,
  saveCloudJobLinkStrict: vi.fn(),
  saveCloudProductPatternStrict: vi.fn(),
  deleteCloudMapping: vi.fn(),
  deleteCloudJobLink: vi.fn(),
  deleteCloudProductPattern: vi.fn(),
  getCloudMappingUpdatedAt: mocks.getMappingUpdatedAt,
  getCloudJobLinkUpdatedAt: vi.fn(),
  getCloudPatternUpdatedAt: vi.fn(),
}));

import {
  enqueueMappingUpsert,
  flushPending,
} from '../services/pendingSyncQueue';

describe('pending sync queue durability', () => {
  beforeEach(() => {
    mocks.queue = [];
    mocks.saveMapping.mockReset();
    mocks.getMappingUpdatedAt.mockReset();
    mocks.getMappingUpdatedAt.mockResolvedValue(null);
  });

  it('ops are never dropped after MAX_ATTEMPTS', async () => {
    mocks.saveMapping.mockResolvedValue(false);
    await enqueueMappingUpsert('item-1', 'deco-1');

    for (let attempt = 0; attempt < 10; attempt++) {
      await flushPending();
    }

    expect(mocks.queue).toHaveLength(1);
    expect(mocks.queue[0]).toMatchObject({ attempts: 10 });
  });

  it('small clock drift does not skip the write', async () => {
    const updatedAt = '2026-10-01T12:00:00.000Z';
    mocks.getMappingUpdatedAt.mockResolvedValue('2026-10-01T12:00:30.000Z');
    mocks.saveMapping.mockResolvedValue(true);
    await enqueueMappingUpsert('item-1', 'deco-1', updatedAt);

    const result = await flushPending();

    expect(mocks.saveMapping).toHaveBeenCalledWith('item-1', 'deco-1', updatedAt);
    expect(result.skipped).toBe(0);
  });

  it('large clock drift still skips the write', async () => {
    mocks.getMappingUpdatedAt.mockResolvedValue('2026-10-01T12:01:30.000Z');
    await enqueueMappingUpsert('item-1', 'deco-1', '2026-10-01T12:00:00.000Z');

    const result = await flushPending();

    expect(mocks.saveMapping).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(mocks.queue).toHaveLength(0);
  });

  it('lastError is captured on failure', async () => {
    mocks.saveMapping.mockRejectedValue(new Error('specific cloud failure'));
    await enqueueMappingUpsert('item-1', 'deco-1');

    await flushPending();

    expect(mocks.queue[0]).toMatchObject({ lastError: 'specific cloud failure' });
  });
});
