import { describe, it, expect } from 'vitest';
import { filterSessions, sortSessionsByDate, enhanceSession, calculateActiveDuration, DEFAULT_GAP_THRESHOLD_MS } from '../../src/analyzer.js';
import type { SessionEntry, FilterOptions } from '../../src/types.js';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = resolve(__dirname, '../fixtures');

// Helper function to create mock sessions
function createMockSession(overrides: Partial<SessionEntry>): SessionEntry {
  return {
    sessionId: 'mock-session',
    fullPath: '/path/to/session.jsonl',
    fileMtime: Date.now(),
    firstPrompt: 'Test prompt',
    summary: 'Test summary',
    messageCount: 5,
    created: '2024-01-01T00:00:00Z',
    modified: '2024-01-01T01:00:00Z',
    gitBranch: 'main',
    projectPath: '/project',
    isSidechain: false,
    ...overrides,
  };
}

describe('filterSessions - Date Range Filtering', () => {
  describe('inclusive end date filtering', () => {
    it('should INCLUDE sessions on the exact end date', () => {
      // Arrange
      const sessions: SessionEntry[] = [
        createMockSession({
          sessionId: 'session-1',
          created: '2024-01-15T10:30:00.000Z', // ON the end date
        }),
        createMockSession({
          sessionId: 'session-2',
          created: '2024-01-16T10:30:00.000Z', // AFTER end date
        }),
      ];

      const filters: FilterOptions = {
        dateTo: new Date('2024-01-15T23:59:59.999Z'), // End of day
      };

      // Act
      const result = filterSessions(sessions, filters);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('session-1');
    });

    it('should include sessions at start of end date (00:00:00)', () => {
      const sessions: SessionEntry[] = [
        createMockSession({
          sessionId: 'midnight-session',
          created: '2024-01-15T00:00:00.000Z', // Exact midnight
        }),
      ];

      const filters: FilterOptions = {
        dateTo: new Date('2024-01-15T23:59:59.999Z'),
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('midnight-session');
    });

    it('should include sessions at end of end date (23:59:59)', () => {
      const sessions: SessionEntry[] = [
        createMockSession({
          sessionId: 'edge-case',
          created: '2024-01-15T23:59:59.999Z', // Last millisecond of day
        }),
      ];

      const filters: FilterOptions = {
        dateTo: new Date('2024-01-15T23:59:59.999Z'),
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('edge-case');
    });

    it('should exclude sessions on day after end date', () => {
      const sessions: SessionEntry[] = [
        createMockSession({
          sessionId: 'session-after',
          created: '2024-01-16T00:00:00.000Z', // Day after
        }),
      ];

      const filters: FilterOptions = {
        dateTo: new Date('2024-01-15T23:59:59.999Z'),
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(0);
    });

    it('should include sessions at start of start date (00:00:00)', () => {
      const sessions: SessionEntry[] = [
        createMockSession({
          sessionId: 'start-boundary',
          created: '2024-01-01T00:00:00.000Z',
        }),
      ];

      const filters: FilterOptions = {
        dateFrom: new Date('2024-01-01T00:00:00.000Z'),
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('start-boundary');
    });

    it('should exclude sessions before start date', () => {
      const sessions: SessionEntry[] = [
        createMockSession({
          sessionId: 'session-before',
          created: '2023-12-31T23:59:59.999Z', // Day before
        }),
      ];

      const filters: FilterOptions = {
        dateFrom: new Date('2024-01-01T00:00:00.000Z'),
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(0);
    });
  });

  describe('sprint cut scenarios', () => {
    it('should extract all sessions for a 2-week sprint', () => {
      const sessions: SessionEntry[] = [
        createMockSession({ sessionId: 's1', created: '2024-01-01T09:00:00Z' }),
        createMockSession({ sessionId: 's2', created: '2024-01-07T14:30:00Z' }),
        createMockSession({ sessionId: 's3', created: '2024-01-14T23:00:00Z' }), // Last day
        createMockSession({ sessionId: 's4', created: '2024-01-15T01:00:00Z' }), // Next sprint
      ];

      const filters: FilterOptions = {
        dateFrom: new Date('2024-01-01T00:00:00Z'),
        dateTo: new Date('2024-01-14T23:59:59.999Z'),
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(3);
      expect(result.map(s => s.sessionId)).toEqual(['s1', 's2', 's3']);
    });

    it('should handle single-day range (same start and end date)', () => {
      const sessions: SessionEntry[] = [
        createMockSession({ sessionId: 's1', created: '2024-01-05T09:00:00Z' }),
        createMockSession({ sessionId: 's2', created: '2024-01-05T14:00:00Z' }),
        createMockSession({ sessionId: 's3', created: '2024-01-05T23:00:00Z' }),
        createMockSession({ sessionId: 's4', created: '2024-01-06T00:00:00Z' }),
      ];

      const filters: FilterOptions = {
        dateFrom: new Date('2024-01-05T00:00:00Z'),
        dateTo: new Date('2024-01-05T23:59:59.999Z'),
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(3);
      expect(result.map(s => s.sessionId)).toEqual(['s1', 's2', 's3']);
    });

    it('should handle sprint crossing month boundary', () => {
      const sessions: SessionEntry[] = [
        createMockSession({ sessionId: 's1', created: '2024-01-25T10:00:00Z' }),
        createMockSession({ sessionId: 's2', created: '2024-01-31T15:00:00Z' }),
        createMockSession({ sessionId: 's3', created: '2024-02-05T10:00:00Z' }),
        createMockSession({ sessionId: 's4', created: '2024-02-06T10:00:00Z' }),
      ];

      const filters: FilterOptions = {
        dateFrom: new Date('2024-01-25T00:00:00Z'),
        dateTo: new Date('2024-02-05T23:59:59.999Z'),
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(3);
      expect(result.map(s => s.sessionId)).toEqual(['s1', 's2', 's3']);
    });
  });

  describe('edge cases', () => {
    it('should handle only dateFrom (no end date)', () => {
      const sessions: SessionEntry[] = [
        createMockSession({ sessionId: 's1', created: '2024-01-01T10:00:00Z' }),
        createMockSession({ sessionId: 's2', created: '2024-02-01T10:00:00Z' }),
        createMockSession({ sessionId: 's3', created: '2024-03-01T10:00:00Z' }),
      ];

      const filters: FilterOptions = {
        dateFrom: new Date('2024-02-01T00:00:00Z'),
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(2);
      expect(result.map(s => s.sessionId)).toEqual(['s2', 's3']);
    });

    it('should handle only dateTo (no start date)', () => {
      const sessions: SessionEntry[] = [
        createMockSession({ sessionId: 's1', created: '2024-01-01T10:00:00Z' }),
        createMockSession({ sessionId: 's2', created: '2024-02-01T10:00:00Z' }),
        createMockSession({ sessionId: 's3', created: '2024-03-01T10:00:00Z' }),
      ];

      const filters: FilterOptions = {
        dateTo: new Date('2024-02-01T23:59:59.999Z'),
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(2);
      expect(result.map(s => s.sessionId)).toEqual(['s1', 's2']);
    });

    it('should handle empty sessions array', () => {
      const sessions: SessionEntry[] = [];

      const filters: FilterOptions = {
        dateFrom: new Date('2024-01-01T00:00:00Z'),
        dateTo: new Date('2024-01-31T23:59:59.999Z'),
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(0);
    });

    it('should handle no date filters', () => {
      const sessions: SessionEntry[] = [
        createMockSession({ sessionId: 's1', created: '2024-01-01T10:00:00Z' }),
        createMockSession({ sessionId: 's2', created: '2024-02-01T10:00:00Z' }),
      ];

      const filters: FilterOptions = {};

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(2);
    });
  });

  describe('other filter types', () => {
    it('should filter by git branch', () => {
      const sessions: SessionEntry[] = [
        createMockSession({ sessionId: 's1', gitBranch: 'main' }),
        createMockSession({ sessionId: 's2', gitBranch: 'feature/new-api' }),
        createMockSession({ sessionId: 's3', gitBranch: 'main' }),
      ];

      const filters: FilterOptions = {
        gitBranches: ['main'],
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(2);
      expect(result.map(s => s.sessionId)).toEqual(['s1', 's3']);
    });

    it('should filter by minimum message count', () => {
      const sessions: SessionEntry[] = [
        createMockSession({ sessionId: 's1', messageCount: 5 }),
        createMockSession({ sessionId: 's2', messageCount: 10 }),
        createMockSession({ sessionId: 's3', messageCount: 3 }),
      ];

      const filters: FilterOptions = {
        minMessageCount: 5,
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(2);
      expect(result.map(s => s.sessionId)).toEqual(['s1', 's2']);
    });

    it('should filter by search text in summary', () => {
      const sessions: SessionEntry[] = [
        createMockSession({ sessionId: 's1', summary: 'Fix authentication bug' }),
        createMockSession({ sessionId: 's2', summary: 'Add new feature' }),
        createMockSession({ sessionId: 's3', summary: 'Authentication improvements' }),
      ];

      const filters: FilterOptions = {
        searchText: 'authentication',
      };

      const result = filterSessions(sessions, filters);

      expect(result).toHaveLength(2);
      expect(result.map(s => s.sessionId)).toEqual(['s1', 's3']);
    });

    it('should apply combined filters (date + branch + message count)', () => {
      const sessions: SessionEntry[] = [
        createMockSession({
          sessionId: 's1',
          created: '2024-01-05T10:00:00Z',
          gitBranch: 'main',
          messageCount: 10,
        }),
        createMockSession({
          sessionId: 's2',
          created: '2024-01-10T10:00:00Z',
          gitBranch: 'feature/test',
          messageCount: 15,
        }),
        createMockSession({
          sessionId: 's3',
          created: '2024-01-15T10:00:00Z',
          gitBranch: 'main',
          messageCount: 5,
        }),
      ];

      const filters: FilterOptions = {
        dateFrom: new Date('2024-01-01T00:00:00Z'),
        dateTo: new Date('2024-01-14T23:59:59.999Z'),
        gitBranches: ['main'],
        minMessageCount: 8,
      };

      const result = filterSessions(sessions, filters);

      // Only s1 matches all criteria
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('s1');
    });
  });
});

describe('enhanceSession - message count breakdown', () => {
  function createSessionWithPath(filePath: string): SessionEntry {
    return {
      sessionId: 'test-session',
      fullPath: filePath,
      fileMtime: Date.now(),
      firstPrompt: 'Test prompt',
      summary: 'Test summary',
      messageCount: 4,
      created: '2026-04-01T09:00:00.000Z',
      modified: '2026-04-01T09:03:00.000Z',
      gitBranch: 'main',
      projectPath: '/project',
      isSidechain: false,
    };
  }

  it('TA1: breakdown fields are populated when readAllEnhancedData succeeds', async () => {
    const session = createSessionWithPath(resolve(FIXTURES, 'pure-conversation.jsonl'));
    const enhanced = await enhanceSession(session);

    expect(enhanced.userMessageCount).toBe(2);
    expect(enhanced.assistantMessageCount).toBe(2);
    expect(enhanced.toolMessageCount).toBe(0);
  });

  it('TA2: breakdown fields are absent (not null/0) when file is unreadable', async () => {
    const session = createSessionWithPath('/nonexistent/path/session.jsonl');
    const enhanced = await enhanceSession(session);

    // Fields must be completely absent — not null, not 0
    expect('userMessageCount' in enhanced).toBe(false);
    expect('assistantMessageCount' in enhanced).toBe(false);
    expect('toolMessageCount' in enhanced).toBe(false);
  });

  it('TA3: breakdown fields appear before duration in property order (CSV column contract)', async () => {
    const session = createSessionWithPath(resolve(FIXTURES, 'pure-conversation.jsonl'));
    const enhanced = await enhanceSession(session);

    const keys = Object.keys(enhanced);
    const userIdx = keys.indexOf('userMessageCount');
    const durationIdx = keys.indexOf('duration');

    expect(userIdx).toBeGreaterThan(-1); // field must exist
    expect(durationIdx).toBeGreaterThan(-1); // field must exist
    expect(userIdx).toBeLessThan(durationIdx); // breakdown before duration
  });
});

describe('calculateActiveDuration (CA1-CA7)', () => {
  const THRESHOLD_30M = DEFAULT_GAP_THRESHOLD_MS; // 1_800_000ms

  it('CA1: all intervals below threshold → activeMs equals total duration, gapCount is 0', () => {
    const timestamps = [
      '2026-01-01T09:00:00.000Z',
      '2026-01-01T09:05:00.000Z',
      '2026-01-01T09:10:00.000Z',
    ];
    const result = calculateActiveDuration(timestamps, THRESHOLD_30M);

    // 5min + 5min = 600,000ms
    expect(result.activeMs).toBe(600_000);
    expect(result.gapCount).toBe(0);
  });

  it('CA2: one overnight gap (gapped fixture timestamps) → only active intervals summed', () => {
    const timestamps = [
      '2026-04-01T09:00:00.000Z',
      '2026-04-01T09:05:00.000Z',
      '2026-04-02T09:00:00.000Z',
      '2026-04-02T09:10:00.000Z',
    ];
    const result = calculateActiveDuration(timestamps, THRESHOLD_30M);

    // 5min (300,000ms) + 10min (600,000ms) = 900,000ms; overnight gap excluded
    expect(result.activeMs).toBe(900_000);
    expect(result.gapCount).toBe(1);
  });

  it('CA3: multiple gaps → gapCount matches, only non-gap intervals summed', () => {
    const timestamps = [
      '2026-01-01T09:00:00.000Z',
      '2026-01-01T09:02:00.000Z', // 2min gap → included
      '2026-01-01T12:00:00.000Z', // ~3h58min → excluded
      '2026-01-01T12:01:00.000Z', // 1min → included
      '2026-01-02T08:00:00.000Z', // ~19h59min → excluded
      '2026-01-02T08:02:00.000Z', // 2min → included
      '2026-01-03T10:00:00.000Z', // ~1d2h → excluded
      '2026-01-03T10:01:00.000Z', // 1min → included
    ];
    const result = calculateActiveDuration(timestamps, THRESHOLD_30M);

    // 2+1+2+1 = 6min = 360,000ms; 3 gaps excluded
    expect(result.gapCount).toBe(3);
    expect(result.activeMs).toBe(360_000);
  });

  it('CA4: single-message array (length 1) → activeMs is 0, gapCount is 0, longestGapMs is 0', () => {
    const result = calculateActiveDuration(['2026-01-01T09:00:00.000Z'], THRESHOLD_30M);

    expect(result.activeMs).toBe(0);
    expect(result.gapCount).toBe(0);
    expect(result.longestGapMs).toBe(0);
  });

  it('CA5: empty array (length 0) → activeMs is 0, gapCount is 0, longestGapMs is 0', () => {
    const result = calculateActiveDuration([], THRESHOLD_30M);

    expect(result.activeMs).toBe(0);
    expect(result.gapCount).toBe(0);
    expect(result.longestGapMs).toBe(0);
  });

  it('CA6: custom 24h threshold → overnight gap (23h55m) is included → gapCount is 0', () => {
    const timestamps = [
      '2026-04-01T09:00:00.000Z',
      '2026-04-01T09:05:00.000Z',
      '2026-04-02T09:00:00.000Z',
      '2026-04-02T09:10:00.000Z',
    ];
    const threshold24h = 24 * 60 * 60 * 1_000;
    const result = calculateActiveDuration(timestamps, threshold24h);

    // All intervals below 24h threshold → all included
    expect(result.gapCount).toBe(0);
    // 5min + 23h55min + 10min = 300,000 + 86,100,000 + 600,000 = 87,000,000ms
    expect(result.activeMs).toBe(87_000_000);
  });

  it('CA7: interval exactly equal to threshold → excluded (gapCount is 1)', () => {
    const timestamps = [
      '2026-01-01T09:00:00.000Z',
      '2026-01-01T09:30:00.000Z', // exactly 30min = threshold → excluded
      '2026-01-01T09:31:00.000Z', // 1min → included
    ];
    const result = calculateActiveDuration(timestamps, THRESHOLD_30M);

    expect(result.gapCount).toBe(1);
    expect(result.activeMs).toBe(60_000); // only 1min interval included
  });
});

describe('enhanceSession - active duration (TA4-TA8)', () => {
  function createSessionWithPath(filePath: string): SessionEntry {
    return {
      sessionId: 'test-session',
      fullPath: filePath,
      fileMtime: Date.now(),
      firstPrompt: 'Test prompt',
      summary: 'Test summary',
      messageCount: 4,
      created: '2026-04-01T09:00:00.000Z',
      modified: '2026-04-02T09:10:00.000Z',
      gitBranch: 'main',
      projectPath: '/project',
      isSidechain: false,
    };
  }

  it('TA4: readable file → activeDuration present and is a number', async () => {
    const session = createSessionWithPath(resolve(FIXTURES, 'pure-conversation.jsonl'));
    const enhanced = await enhanceSession(session);

    expect('activeDuration' in enhanced).toBe(true);
    expect(typeof enhanced.activeDuration).toBe('number');
    expect('activeDurationFormatted' in enhanced).toBe(true);
    expect(typeof enhanced.activeDurationFormatted).toBe('string');
  });

  it('TA5: unreadable file → activeDuration absent from returned object', async () => {
    const session = createSessionWithPath('/nonexistent/path/session.jsonl');
    const enhanced = await enhanceSession(session);

    expect('activeDuration' in enhanced).toBe(false);
    expect('activeDurationFormatted' in enhanced).toBe(false);
  });

  it('TA6: empty file (0 timestamps) → activeDuration is 0 and activeDurationFormatted is "0 seconds"', async () => {
    const session = createSessionWithPath(resolve(FIXTURES, 'empty.jsonl'));
    const enhanced = await enhanceSession(session);

    expect(enhanced.activeDuration).toBe(0);
    expect(enhanced.activeDurationFormatted).toBe('0 seconds');
  });

  it('TA7: activeDuration appears after durationFormatted and before accurateFirstTimestamp in CSV column order', async () => {
    const session = createSessionWithPath(resolve(FIXTURES, 'pure-conversation.jsonl'));
    const enhanced = await enhanceSession(session);

    const keys = Object.keys(enhanced);
    const durationFormattedIdx = keys.indexOf('durationFormatted');
    const activeDurationIdx = keys.indexOf('activeDuration');
    const accurateFirstTimestampIdx = keys.indexOf('accurateFirstTimestamp');

    expect(activeDurationIdx).toBeGreaterThan(durationFormattedIdx);
    expect(activeDurationIdx).toBeLessThan(accurateFirstTimestampIdx);
  });

  it('TA8: custom gapThresholdMs changes activeDuration calculation', async () => {
    const session = createSessionWithPath(resolve(FIXTURES, 'gapped-session.jsonl'));

    // With 30-min threshold: overnight gap excluded → activeMs = 900,000ms
    const enhanced30m = await enhanceSession(session, DEFAULT_GAP_THRESHOLD_MS);
    expect(enhanced30m.activeDuration).toBe(900_000);

    // With huge threshold: no gaps excluded → activeMs = full span
    const enhancedHuge = await enhanceSession(session, 999_999_999);
    // 5min + 23h55min + 10min = 87,000,000ms
    expect(enhancedHuge.activeDuration).toBe(87_000_000);
  });
});

describe('sortSessionsByDate', () => {
  it('should sort sessions by created date (newest first)', () => {
    const sessions: SessionEntry[] = [
      createMockSession({ sessionId: 's1', created: '2024-01-01T10:00:00Z' }),
      createMockSession({ sessionId: 's2', created: '2024-01-15T10:00:00Z' }),
      createMockSession({ sessionId: 's3', created: '2024-01-10T10:00:00Z' }),
    ];

    const result = sortSessionsByDate(sessions);

    expect(result.map(s => s.sessionId)).toEqual(['s2', 's3', 's1']);
  });

  it('should not mutate original array', () => {
    const sessions: SessionEntry[] = [
      createMockSession({ sessionId: 's1', created: '2024-01-01T10:00:00Z' }),
      createMockSession({ sessionId: 's2', created: '2024-01-15T10:00:00Z' }),
    ];

    const originalOrder = sessions.map(s => s.sessionId);
    sortSessionsByDate(sessions);

    expect(sessions.map(s => s.sessionId)).toEqual(originalOrder);
  });
});
