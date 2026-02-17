import { readFile, stat, readdir } from 'fs/promises';
import { glob } from 'glob';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import type { SessionsIndex, SessionEntry, ProjectInfo } from './types.js';

/**
 * Parse a single sessions-index.json file
 */
export async function parseSessionsFile(filePath: string): Promise<SessionEntry[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const data: SessionsIndex = JSON.parse(content);
    return data.entries || [];
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${error}`);
  }
}

/**
 * Find and parse all sessions-index.json files matching the pattern
 */
export async function findAndParseSessions(pattern: string): Promise<SessionEntry[]> {
  const files = await glob(pattern, { absolute: true });

  if (files.length === 0) {
    throw new Error(`No files found matching pattern: ${pattern}`);
  }

  const allSessions: SessionEntry[] = [];

  for (const file of files) {
    try {
      const sessions = await parseSessionsFile(file);
      allSessions.push(...sessions);
    } catch (error) {
      console.warn(`Warning: Could not parse ${file}:`, error);
    }
  }

  return allSessions;
}

/**
 * Get unique git branches from sessions
 */
export function getUniqueBranches(sessions: SessionEntry[]): string[] {
  const branches = new Set(sessions.map(s => s.gitBranch).filter(Boolean));
  return Array.from(branches).sort();
}

// ============================================================================
// SMART DIRECTORY DISCOVERY (Task 2)
// ============================================================================

/**
 * Input type for smart discovery
 */
type InputType = 'default' | 'directory' | 'file' | 'glob';

/**
 * Check if a file or directory exists
 */
async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Expand tilde (~) in path to home directory
 */
function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  if (filePath === '~') {
    return os.homedir();
  }
  return filePath;
}

/**
 * Determine the type of input provided by the user
 */
async function detectInputType(input: string): Promise<InputType> {
  if (!input || input === '~/.claude/projects' || input === '*.json') {
    return 'default';
  }

  // Check if it contains glob patterns FIRST (before checking file extension)
  if (input.includes('*') || input.includes('?') || input.includes('[')) {
    return 'glob';
  }

  // Check if it's a direct file path
  if (input.endsWith('.json')) {
    return 'file';
  }

  // Expand tilde and check if it's an existing directory
  const expandedPath = expandTilde(input);

  try {
    const stats = await stat(expandedPath);
    if (stats.isDirectory()) {
      return 'directory';
    }
  } catch {
    // Not an existing path, might be a directory that doesn't exist yet
  }

  // Default to treating as directory path
  return 'directory';
}

/**
 * Scan all project directories under ~/.claude/projects
 */
async function scanAllProjects(basePath: string): Promise<ProjectInfo[]> {
  const expandedPath = expandTilde(basePath);

  // Check if base directory exists
  try {
    const stats = await stat(expandedPath);
    if (!stats.isDirectory()) {
      throw new Error(`Not a directory: ${expandedPath}`);
    }
  } catch (error) {
    throw new Error(`Claude projects directory not found: ${expandedPath}`);
  }

  // Read all subdirectories
  const entries = await readdir(expandedPath, { withFileTypes: true });
  const projectDirs = entries
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(expandedPath, entry.name));

  // Map to ProjectInfo
  const projects: ProjectInfo[] = [];
  for (const projectDir of projectDirs) {
    const indexPath = path.join(projectDir, 'sessions-index.json');
    const indexExists = await exists(indexPath);

    // Check if this directory has any .jsonl files
    const jsonlFiles = await glob('*.jsonl', {
      cwd: projectDir,
      absolute: false,
    });

    // Only include if it has .jsonl files or an index
    if (jsonlFiles.length > 0 || indexExists) {
      projects.push({
        projectDir,
        indexPath: indexExists ? indexPath : null,
      });
    }
  }

  return projects;
}

/**
 * Scan a single directory for sessions-index.json
 */
async function scanSingleDirectory(dirPath: string): Promise<ProjectInfo[]> {
  const expandedPath = expandTilde(dirPath);

  // Check if directory exists
  try {
    const stats = await stat(expandedPath);
    if (!stats.isDirectory()) {
      throw new Error(`Not a directory: ${expandedPath}`);
    }
  } catch (error) {
    throw new Error(`Directory not found: ${expandedPath}`);
  }

  // Check for sessions-index.json
  const indexPath = path.join(expandedPath, 'sessions-index.json');
  const indexExists = await exists(indexPath);

  // Check for .jsonl files (to know if this is actually a session directory)
  const jsonlFiles = await glob('*.jsonl', {
    cwd: expandedPath,
    absolute: false,
  });

  if (jsonlFiles.length === 0 && !indexExists) {
    throw new Error(
      `No session files found in ${expandedPath}\n` +
      `Expected to find .jsonl files or sessions-index.json\n` +
      `Is this a Claude Code project directory?`
    );
  }

  return [{
    projectDir: expandedPath,
    indexPath: indexExists ? indexPath : null,
  }];
}

/**
 * Handle direct file path (legacy behavior)
 */
async function handleDirectFilePath(filePath: string): Promise<ProjectInfo[]> {
  const expandedPath = expandTilde(filePath);

  // Check if file exists
  const fileExists = await exists(expandedPath);

  if (!fileExists) {
    throw new Error(`File not found: ${expandedPath}`);
  }

  const projectDir = path.dirname(expandedPath);

  return [{
    projectDir,
    indexPath: expandedPath,
  }];
}

/**
 * Handle glob patterns (e.g., ~/.claude/projects/project-star/sessions-index.json)
 */
async function handleGlobPattern(pattern: string): Promise<ProjectInfo[]> {
  const expandedPattern = expandTilde(pattern);

  // If glob is for .json files, use existing logic
  if (pattern.includes('*.json') || pattern.endsWith('.json')) {
    const files = await glob(expandedPattern, { absolute: true });

    if (files.length === 0) {
      throw new Error(`No files found matching pattern: ${pattern}`);
    }

    return files.map(filePath => ({
      projectDir: path.dirname(filePath),
      indexPath: filePath,
    }));
  }

  // Otherwise, treat as directory glob
  const dirs = await glob(expandedPattern, { absolute: true });

  if (dirs.length === 0) {
    throw new Error(`No directories found matching pattern: ${pattern}`);
  }

  const projects: ProjectInfo[] = [];
  for (const dir of dirs) {
    try {
      const stats = await stat(dir);
      if (stats.isDirectory()) {
        const indexPath = path.join(dir, 'sessions-index.json');
        const indexExists = await exists(indexPath);

        // Check for .jsonl files
        const jsonlFiles = await glob('*.jsonl', {
          cwd: dir,
          absolute: false,
        });

        // Only include if it has .jsonl files or an index
        if (jsonlFiles.length > 0 || indexExists) {
          projects.push({
            projectDir: dir,
            indexPath: indexExists ? indexPath : null,
          });
        }
      }
    } catch (error) {
      // Skip directories that can't be accessed
      continue;
    }
  }

  if (projects.length === 0) {
    throw new Error(`No valid session directories found matching pattern: ${pattern}`);
  }

  return projects;
}

/**
 * Discover all projects based on user input
 */
export async function discoverProjects(input?: string): Promise<ProjectInfo[]> {
  // Default: scan all projects
  if (!input) {
    input = '~/.claude/projects';
  }

  const inputType = await detectInputType(input);

  switch (inputType) {
    case 'default':
      return await scanAllProjects(input);

    case 'directory':
      return await scanSingleDirectory(input);

    case 'file':
      return await handleDirectFilePath(input);

    case 'glob':
      return await handleGlobPattern(input);

    default:
      throw new Error(`Unknown input type: ${inputType}`);
  }
}

/**
 * Display discovered projects summary
 */
export function displayProjectsSummary(projects: ProjectInfo[]): void {
  console.log(chalk.blue('\n📁 Discovered Projects:\n'));

  for (const project of projects) {
    const projectName = path.basename(project.projectDir);
    const status = project.indexPath
      ? chalk.green('✓')
      : chalk.yellow('⚠');

    const indexStatus = project.indexPath
      ? 'index found'
      : 'no index (will validate)';

    console.log(`  ${status} ${chalk.bold(projectName)} - ${indexStatus}`);
  }

  console.log(); // blank line
}

/**
 * Load sessions from discovered projects
 * This replaces the existing findAndParseSessions when using project discovery
 */
export async function loadSessionsFromProjects(
  projects: ProjectInfo[]
): Promise<SessionEntry[]> {
  const allSessions: SessionEntry[] = [];

  for (const project of projects) {
    // Skip projects without valid index
    if (!project.indexPath) {
      const projectName = path.basename(project.projectDir);
      console.warn(
        chalk.yellow(`Warning: Skipping ${projectName} (no valid index)`)
      );
      continue;
    }

    try {
      const sessions = await parseSessionsFile(project.indexPath);
      allSessions.push(...sessions);
      project.sessionCount = sessions.length;
    } catch (error) {
      const projectName = path.basename(project.projectDir);
      console.warn(
        chalk.yellow(`Warning: Could not parse ${projectName}:`),
        error
      );
    }
  }

  return allSessions;
}
