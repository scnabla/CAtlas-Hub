const METADATA_DIRECTORIES = ['.git', '.hg', '.svn'];
export const TODO_METADATA_GLOBS = METADATA_DIRECTORIES.map(name => `**/${name}/**`);

export function isTodoMetadataPath(relativePath: string): boolean {
  return relativePath.split('/').slice(0, -1).some(part => METADATA_DIRECTORIES.includes(part.toLowerCase()));
}

export interface TodoSearchQuery {
  readonly mode: 'fixed' | 'regex';
  readonly patterns: readonly string[];
}

export function createTodoSearchQuery(
  tagNames: readonly string[],
  markdownTasks: boolean,
  ownerIdentities: readonly string[] = [],
  includeProjectMarkers = true,
): TodoSearchQuery {
  const tags = [...new Set(tagNames.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
  if (includeProjectMarkers) {
    const patterns = new Set(tags);
    if (markdownTasks) patterns.add('[ ]');
    return { mode: 'fixed', patterns: [...patterns] };
  }
  const owners = [...new Set(ownerIdentities.map((owner) => owner.trim()).filter((owner) => owner.length > 0))];
  if (tags.length === 0 || owners.length === 0) return { mode: 'regex', patterns: [] };
  return {
    mode: 'regex',
    patterns: [`(${tags.map(escapeExtendedRegExp).join('|')})[[:space:]]*\\([[:space:]]*(${owners.map(escapeExtendedRegExp).join('|')})[[:space:]]*\\)`],
  };
}

export function normalizeTodoCandidatePath(path: string): string | undefined {
  const normalized = path.trim().replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (normalized.length === 0 || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return undefined;
  if (normalized.split('/').some((segment) => segment === '..')) return undefined;
  return normalized;
}

export function parseTodoCandidatePathOutput(output: Buffer): string[] {
  const unique = new Set<string>();
  for (const raw of output.toString('utf8').split('\0')) {
    const normalized = normalizeTodoCandidatePath(raw);
    if (normalized !== undefined) unique.add(normalized);
  }
  return [...unique];
}

function escapeExtendedRegExp(value: string): string {
  return value.replace(/[.\\+*?^[\]$(){}|]/g, '\\$&');
}
