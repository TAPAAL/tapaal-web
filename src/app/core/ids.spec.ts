import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocument, createTimedDocument } from './documents';
import { newId } from './ids';

afterEach(() => vi.unstubAllGlobals());

describe('document IDs on insecure HTTP', () => {
  it('uses the native UUID method when available', () => {
    const randomUUID = vi.fn(() => '12345678-1234-4234-8234-123456789abc');
    const getRandomValues = vi.fn();
    vi.stubGlobal('crypto', { randomUUID, getRandomValues });
    expect(newId()).toBe('12345678-1234-4234-8234-123456789abc');
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('sets the UUID version and variant bits without weakening random bytes', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255));
    vi.stubGlobal('crypto', { getRandomValues });
    expect(newId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('creates untimed and timed documents without the secure-context randomUUID API', () => {
    const randomBytes = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal('crypto', { getRandomValues: randomBytes });
    const documents = [
      createDocument({ name: 'A' }),
      createDocument({ name: 'B' }),
      createTimedDocument({ name: 'C' }),
    ];
    const ids = documents.flatMap((doc) => [doc.id, ...doc.network.components.map((c) => c.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
