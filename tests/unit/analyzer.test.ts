import { describe, it, expect } from 'vitest';
import { filterSessions, sortSessionsByDate } from '../../src/analyzer.js';
import type { SessionEntry, FilterOptions } from '../../src/types.js';

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
