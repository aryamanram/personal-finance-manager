import { describe, it, expect } from 'vitest';
import { formatShare } from '@/lib/share';

describe('formatShare', () => {
  it('prints one decimal', () => {
    expect(formatShare(0.579)).toBe('57.9%');
    expect(formatShare(0.0005)).toBe('0.1%');
    expect(formatShare(1)).toBe('100.0%');
  });
  it('never calls a part that is there nothing', () => {
    expect(formatShare(177 / 1080177)).toBe('<0.1%');
    expect(formatShare(0.000_499)).toBe('<0.1%');
  });
  it('prints nothing as nothing', () => {
    expect(formatShare(0)).toBe('0.0%');
  });
});
