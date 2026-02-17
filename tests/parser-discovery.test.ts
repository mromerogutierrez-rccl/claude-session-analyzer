import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { discoverProjects } from '../src/parser.js';
import type { SessionsIndex } from '../src/types.js';

// Test fixture helpers
let testDir: string;

beforeEach(async () => {
  // Create a unique temporary directory for each test
  testDir = path.join(os.tmpdir(), `claude-discovery-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  // Clean up test directory
  await rm(testDir, { recursive: true, force: true });
});

/**
 * Create a mock project directory with sessions
 */
async function createMockProject(
  projectName: string,
  options: {
    hasIndex?: boolean;
    jsonlCount?: number;
  } = {}
): Promise<string> {
  const { hasIndex = true, jsonlCount = 2 } = options;
  const projectDir = path.join(testDir, projectName);
  await mkdir(projectDir, { recursive: true });

  // Create .jsonl files
  for (let i = 0; i < jsonlCount; i++) {
    const sessionId = `session-${i}`;
    const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);
    await writeFile(
      jsonlPath,
      JSON.stringify({
        type: 'user',
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: [{ type: 'text', text: 'Test' }] },
      }),
      'utf-8'
    );
  }

  // Create index if requested
  if (hasIndex) {
    const indexPath = path.join(projectDir, 'sessions-index.json');
    const index: SessionsIndex = {
      version: 1,
      entries: Array.from({ length: jsonlCount }, (_, i) => ({
        sessionId: `session-${i}`,
        fullPath: path.join(projectDir, `session-${i}.jsonl`),
        fileMtime: Date.now(),
        firstPrompt: 'Test',
        summary: 'Test',
        messageCount: 1,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        gitBranch: '',
        projectPath: projectDir,
        isSidechain: false,
      })),
    };
    await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  return projectDir;
}

describe('discoverProjects', () => {
  describe('default behavior (no input)', () => {
    it('should scan ~/.claude/projects by default', async () => {
      // This test is tricky because it requires ~/.claude/projects to exist
      // We'll just test that it doesn't throw
      try {
        const projects = await discoverProjects();
        // If ~/.claude/projects exists, we should get some projects
        expect(Array.isArray(projects)).toBe(true);
      } catch (error) {
        // If ~/.claude/projects doesn't exist, we expect a specific error
        expect((error as Error).message).toContain('Claude projects directory not found');
      }
    });
  });

  describe('single directory', () => {
    it('should discover a single project directory with index', async () => {
      const projectDir = await createMockProject('my-project', {
        hasIndex: true,
        jsonlCount: 3,
      });

      const projects = await discoverProjects(projectDir);

      expect(projects).toHaveLength(1);
      expect(projects[0].projectDir).toBe(projectDir);
      expect(projects[0].indexPath).toBe(path.join(projectDir, 'sessions-index.json'));
    });

    it('should discover a single project directory without index', async () => {
      const projectDir = await createMockProject('my-project', {
        hasIndex: false,
        jsonlCount: 2,
      });

      const projects = await discoverProjects(projectDir);

      expect(projects).toHaveLength(1);
      expect(projects[0].projectDir).toBe(projectDir);
      expect(projects[0].indexPath).toBeNull();
    });

    it('should throw error for empty directory', async () => {
      const emptyDir = path.join(testDir, 'empty');
      await mkdir(emptyDir, { recursive: true });

      await expect(discoverProjects(emptyDir)).rejects.toThrow(
        /No session files found/
      );
    });

    it('should throw error for non-existent directory', async () => {
      const nonExistent = path.join(testDir, 'non-existent');

      await expect(discoverProjects(nonExistent)).rejects.toThrow(
        /Directory not found/
      );
    });

    it('should expand tilde paths', async () => {
      // Create a project in home directory for testing
      const homeTestDir = path.join(os.homedir(), `.claude-test-${Date.now()}`);
      await mkdir(homeTestDir, { recursive: true });

      try {
        // Create a test .jsonl file
        await writeFile(
          path.join(homeTestDir, 'test.jsonl'),
          JSON.stringify({ type: 'user', message: {} }),
          'utf-8'
        );

        const tildeDirectPath = `~/.claude-test-${path.basename(homeTestDir).split('-').pop()}`;
        const projects = await discoverProjects(tildeDirectPath);

        expect(projects).toHaveLength(1);
        expect(projects[0].projectDir).toBe(homeTestDir);
      } finally {
        await rm(homeTestDir, { recursive: true, force: true });
      }
    });
  });

  describe('direct file path', () => {
    it('should handle direct sessions-index.json file path', async () => {
      const projectDir = await createMockProject('my-project', {
        hasIndex: true,
        jsonlCount: 2,
      });
      const indexPath = path.join(projectDir, 'sessions-index.json');

      const projects = await discoverProjects(indexPath);

      expect(projects).toHaveLength(1);
      expect(projects[0].projectDir).toBe(projectDir);
      expect(projects[0].indexPath).toBe(indexPath);
    });

    it('should throw error for non-existent file', async () => {
      const nonExistentFile = path.join(testDir, 'non-existent.json');

      await expect(discoverProjects(nonExistentFile)).rejects.toThrow(
        /File not found/
      );
    });

    it('should expand tilde in file paths', async () => {
      // This is a simpler tilde test using just file existence
      const homeTestDir = path.join(os.homedir(), `.claude-test-${Date.now()}`);
      await mkdir(homeTestDir, { recursive: true });

      try {
        const indexPath = path.join(homeTestDir, 'sessions-index.json');
        await writeFile(
          indexPath,
          JSON.stringify({ version: 1, entries: [] }),
          'utf-8'
        );

        // Create tilde path
        const relativePath = path.relative(os.homedir(), indexPath);
        const tildePath = `~/${relativePath}`;

        const projects = await discoverProjects(tildePath);

        expect(projects).toHaveLength(1);
        expect(projects[0].indexPath).toBe(indexPath);
      } finally {
        await rm(homeTestDir, { recursive: true, force: true });
      }
    });
  });

  describe('glob patterns for files', () => {
    it('should handle glob pattern for .json files', async () => {
      await createMockProject('project-1', { hasIndex: true, jsonlCount: 1 });
      await createMockProject('project-2', { hasIndex: true, jsonlCount: 1 });
      await createMockProject('project-3', { hasIndex: true, jsonlCount: 1 });

      const pattern = path.join(testDir, '*/sessions-index.json');
      const projects = await discoverProjects(pattern);

      expect(projects).toHaveLength(3);
      expect(projects.every(p => p.indexPath !== null)).toBe(true);
    });

    it('should handle glob pattern with star in filename', async () => {
      await createMockProject('project-1', { hasIndex: true, jsonlCount: 1 });
      await createMockProject('project-2', { hasIndex: true, jsonlCount: 1 });

      const pattern = path.join(testDir, '*/sessions-*.json');
      const projects = await discoverProjects(pattern);

      expect(projects).toHaveLength(2);
    });

    it('should throw error if no files match pattern', async () => {
      const pattern = path.join(testDir, '*/non-existent-*.json');

      await expect(discoverProjects(pattern)).rejects.toThrow(
        /No files found matching pattern/
      );
    });
  });

  describe('glob patterns for directories', () => {
    it('should handle glob pattern for directories', async () => {
      await createMockProject('work-project-1', { hasIndex: true, jsonlCount: 1 });
      await createMockProject('work-project-2', { hasIndex: true, jsonlCount: 1 });
      await createMockProject('personal-project', { hasIndex: true, jsonlCount: 1 });

      const pattern = path.join(testDir, 'work-*');
      const projects = await discoverProjects(pattern);

      expect(projects).toHaveLength(2);
      expect(projects.every(p => path.basename(p.projectDir).startsWith('work-'))).toBe(true);
    });

    it('should skip directories without sessions', async () => {
      await createMockProject('project-1', { hasIndex: true, jsonlCount: 1 });
      // Create empty directory
      await mkdir(path.join(testDir, 'empty-project'), { recursive: true });

      const pattern = path.join(testDir, '*');
      const projects = await discoverProjects(pattern);

      // Should only find project-1, not empty-project
      expect(projects).toHaveLength(1);
      expect(path.basename(projects[0].projectDir)).toBe('project-1');
    });

    it('should find projects without index but with .jsonl files', async () => {
      await createMockProject('project-with-index', { hasIndex: true, jsonlCount: 1 });
      await createMockProject('project-without-index', { hasIndex: false, jsonlCount: 2 });

      const pattern = path.join(testDir, '*');
      const projects = await discoverProjects(pattern);

      expect(projects).toHaveLength(2);

      const withIndex = projects.find(p => p.projectDir.includes('with-index'));
      const withoutIndex = projects.find(p => p.projectDir.includes('without-index'));

      expect(withIndex?.indexPath).toBeTruthy();
      expect(withoutIndex?.indexPath).toBeNull();
    });

    it('should throw error if no valid directories found', async () => {
      const pattern = path.join(testDir, 'non-existent-*');

      await expect(discoverProjects(pattern)).rejects.toThrow(
        /No directories found matching pattern/
      );
    });
  });

  describe('multiple projects scenario', () => {
    it('should handle glob pattern for multiple projects', async () => {
      // Create multiple projects
      await createMockProject('project-1', {
        hasIndex: true,
        jsonlCount: 2,
      });
      await createMockProject('project-2', {
        hasIndex: false,
        jsonlCount: 3,
      });
      await createMockProject('project-3', {
        hasIndex: true,
        jsonlCount: 1,
      });

      // Use glob pattern to discover all
      const pattern = path.join(testDir, '*');
      const projects = await discoverProjects(pattern);

      expect(projects).toHaveLength(3);
      expect(projects.filter(p => p.indexPath !== null)).toHaveLength(2);
      expect(projects.filter(p => p.indexPath === null)).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should handle projects with many .jsonl files', async () => {
      const projectDir = await createMockProject('large-project', {
        hasIndex: false,
        jsonlCount: 50,
      });

      const projects = await discoverProjects(projectDir);

      expect(projects).toHaveLength(1);
      expect(projects[0].projectDir).toBe(projectDir);
    });

    it('should handle directory names with special characters', async () => {
      const specialName = 'project-with-dashes-and_underscores';
      const projectDir = await createMockProject(specialName, {
        hasIndex: true,
        jsonlCount: 1,
      });

      const projects = await discoverProjects(projectDir);

      expect(projects).toHaveLength(1);
      expect(path.basename(projects[0].projectDir)).toBe(specialName);
    });

    it('should handle nested directory structure in glob', async () => {
      const nested = path.join(testDir, 'level1', 'level2');
      await mkdir(nested, { recursive: true });

      await createMockProject(path.join(nested, 'project'), {
        hasIndex: true,
        jsonlCount: 1,
      });

      const pattern = path.join(testDir, '**/project');
      const projects = await discoverProjects(pattern);

      expect(projects).toHaveLength(1);
    });
  });
});
