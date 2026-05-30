
import { homedir } from 'os';
import { existsSync, realpathSync } from 'fs';
import { basename, join } from 'path';
import { logger } from './logger.js';

function globToRegex(pattern: string): RegExp {
  let expanded = pattern.startsWith('~')
    ? homedir() + pattern.slice(1)
    : pattern;

  // Resolve symlinks for non-glob patterns (e.g., /tmp -> /private/tmp on macOS)
  if (!/[*?]/.test(expanded)) {
    try { expanded = realpathSync(expanded); } catch { /* use original if path doesn't exist */ }
  }

  // Normalize path separators to forward slashes
  expanded = expanded.replace(/\\/g, '/');

  let regex = expanded.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  regex = regex
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')  
    .replace(/\*/g, '[^/]*')              
    .replace(/\?/g, '[^/]')               
    .replace(/<<<GLOBSTAR>>>/g, '.*');    

  return new RegExp(`^${regex}$`);
}

/**
 * Returns true when `folderPath` matches any of the supplied glob patterns.
 * Patterns support `*`, `**`, `?`, and a leading `~`. Matches against both the
 * full normalized path and the basename. Reuses the same glob semantics as
 * project exclusion. Used by the skeleton-CLAUDE.md deny-list (#2400).
 */
export function matchesAnyGlob(folderPath: string, patterns: string[]): boolean {
  if (!patterns.length) return false;
  const normalizedPath = folderPath.replace(/\\/g, '/');
  const pathBasename = basename(normalizedPath);
  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim();
    if (!pattern) continue;
    try {
      const regex = globToRegex(pattern);
      if (regex.test(normalizedPath) || regex.test(pathBasename)) {
        return true;
      }
    } catch (error: unknown) {
      logger.warn('PROJECT_NAME', 'Invalid glob pattern', { pattern, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
  }
  return false;
}

export function isProjectExcluded(projectPath: string, exclusionPatterns: string): boolean {
  if (!exclusionPatterns || !exclusionPatterns.trim()) {
    return false;
  }

  // Resolve symlinks (e.g., /tmp -> /private/tmp on macOS) and normalize separators
  let resolvedPath = projectPath;
  try { resolvedPath = realpathSync(projectPath); } catch { /* use original if path doesn't exist */ }
  const normalizedProjectPath = resolvedPath.replace(/\\/g, '/');
  // Basename match pass: users intuitively expect `observer-sessions` or
  // `*observer-sessions*` to match any cwd whose final segment matches, but
  // globToRegex translates `*` → `[^/]*` which can't cross `/`. Without this,
  // both bare names and basename globs silently fail (#2126 item 1).
  const projectBasename = basename(normalizedProjectPath);

  const patternList = exclusionPatterns
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  for (const pattern of patternList) {
    try {
      const regex = globToRegex(pattern);
      if (regex.test(normalizedProjectPath) || regex.test(projectBasename)) {
        return true;
      }
      // Also match subdirectories: pattern "/tmp/temp" should exclude "/tmp/temp/foo"
      // Only apply prefix matching for patterns without glob characters
      if (!/[*?]/.test(pattern)) {
        let expanded = pattern.startsWith('~')
          ? homedir() + pattern.slice(1)
          : pattern;
        try { expanded = realpathSync(expanded); } catch { /* use original */ }
        const normalizedPattern = expanded.replace(/\\/g, '/').replace(/\/+$/, '');
        if (normalizedProjectPath.startsWith(normalizedPattern + '/')) {
          return true;
        }
      }
    } catch (error: unknown) {
      logger.warn('PROJECT_NAME', 'Invalid exclusion pattern', { pattern, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
  }

  return false;
}

/**
 * Check if a project has been locally disabled via a .claude-mem-disable file.
 * Users can `touch .claude-mem-disable` in any repo to disable claude-mem for that repo.
 */
export function isProjectLocallyDisabled(cwd: string): boolean {
  if (!cwd) return false;
  return existsSync(join(cwd, '.claude-mem-disable'));
}
