import { describe, it, expect } from 'vitest';
import {
  parseStartOfDay,
  parseEndOfDay,
  isValidDateRange,
  formatDateRange,
} from '../../src/date-utils.js';

describe('parseStartOfDay', () => {
  it('should parse to 00:00:00.000 UTC', () => {
    const result = parseStartOfDay('2026-02-05');
    expect(result).toEqual(new Date('2026-02-05T00:00:00.000Z'));
  });

  it('should return null for invalid format', () => {
    expect(parseStartOfDay('02/05/2026')).toBeNull();
    expect(parseStartOfDay('2026-2-5')).toBeNull();
    expect(parseStartOfDay('20260205')).toBeNull();
    expect(parseStartOfDay('invalid')).toBeNull();
  });

  it('should return null for invalid date', () => {
    expect(parseStartOfDay('2026-02-31')).toBeNull(); // Feb doesn't have 31 days
    expect(parseStartOfDay('2026-13-01')).toBeNull(); // Month 13 doesn't exist
    expect(parseStartOfDay('2025-02-29')).toBeNull(); // 2025 is not a leap year
  });

  it('should handle leap year correctly', () => {
    const result = parseStartOfDay('2024-02-29'); // 2024 is a leap year
    expect(result).toEqual(new Date('2024-02-29T00:00:00.000Z'));
  });

  it('should parse year boundaries correctly', () => {
    const result = parseStartOfDay('2026-01-01');
    expect(result).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });
});

describe('parseEndOfDay', () => {
  it('should parse to 23:59:59.999 UTC', () => {
    const result = parseEndOfDay('2026-02-05');
    expect(result).toEqual(new Date('2026-02-05T23:59:59.999Z'));
  });

  it('should return null for invalid format', () => {
    expect(parseEndOfDay('02/05/2026')).toBeNull();
    expect(parseEndOfDay('2026-2-5')).toBeNull();
    expect(parseEndOfDay('20260205')).toBeNull();
    expect(parseEndOfDay('invalid')).toBeNull();
  });

  it('should return null for invalid date', () => {
    expect(parseEndOfDay('2026-02-31')).toBeNull(); // Feb doesn't have 31 days
    expect(parseEndOfDay('2026-13-01')).toBeNull(); // Month 13 doesn't exist
    expect(parseEndOfDay('2025-02-29')).toBeNull(); // 2025 is not a leap year
  });

  it('should handle leap year correctly', () => {
    const result = parseEndOfDay('2024-02-29'); // 2024 is a leap year
    expect(result).toEqual(new Date('2024-02-29T23:59:59.999Z'));
  });

  it('should parse year boundaries correctly', () => {
    const result = parseEndOfDay('2026-12-31');
    expect(result).toEqual(new Date('2026-12-31T23:59:59.999Z'));
  });
});

describe('isValidDateRange', () => {
  it('should validate start <= end', () => {
    const dateFrom = new Date('2026-02-01T00:00:00.000Z');
    const dateTo = new Date('2026-02-05T23:59:59.999Z');
    expect(isValidDateRange(dateFrom, dateTo)).toBe(true);
  });

  it('should reject start > end', () => {
    const dateFrom = new Date('2026-02-10T00:00:00.000Z');
    const dateTo = new Date('2026-02-05T23:59:59.999Z');
    expect(isValidDateRange(dateFrom, dateTo)).toBe(false);
  });

  it('should allow same day (start === end)', () => {
    const sameDate = new Date('2026-02-05T00:00:00.000Z');
    expect(isValidDateRange(sameDate, sameDate)).toBe(true);
  });

  it('should allow start of day to end of day for same day', () => {
    const startOfDay = new Date('2026-02-05T00:00:00.000Z');
    const endOfDay = new Date('2026-02-05T23:59:59.999Z');
    expect(isValidDateRange(startOfDay, endOfDay)).toBe(true);
  });

  it('should handle cross-month boundaries', () => {
    const jan31 = new Date('2026-01-31T23:59:59.999Z');
    const feb01 = new Date('2026-02-01T00:00:00.000Z');
    expect(isValidDateRange(jan31, feb01)).toBe(true);
  });

  it('should handle cross-year boundaries', () => {
    const dec31 = new Date('2025-12-31T23:59:59.999Z');
    const jan01 = new Date('2026-01-01T00:00:00.000Z');
    expect(isValidDateRange(dec31, jan01)).toBe(true);
  });
});

describe('formatDateRange', () => {
  it('should format range with both dates', () => {
    const dateFrom = new Date('2026-02-01T00:00:00.000Z');
    const dateTo = new Date('2026-02-05T23:59:59.999Z');
    const result = formatDateRange(dateFrom, dateTo);
    expect(result).toBe('2026-02-01 to 2026-02-05 (inclusive)');
  });

  it('should format open-ended range (only dateFrom)', () => {
    const dateFrom = new Date('2026-02-01T00:00:00.000Z');
    const result = formatDateRange(dateFrom, null);
    expect(result).toBe('From 2026-02-01 onwards');
  });

  it('should format open-ended range (only dateTo)', () => {
    const dateTo = new Date('2026-02-05T23:59:59.999Z');
    const result = formatDateRange(null, dateTo);
    expect(result).toBe('Up to 2026-02-05 (inclusive)');
  });

  it('should format no date range', () => {
    const result = formatDateRange(null, null);
    expect(result).toBe('All dates');
  });

  it('should format single day range', () => {
    const startOfDay = new Date('2026-02-05T00:00:00.000Z');
    const endOfDay = new Date('2026-02-05T23:59:59.999Z');
    const result = formatDateRange(startOfDay, endOfDay);
    expect(result).toBe('2026-02-05 to 2026-02-05 (inclusive)');
  });
});
