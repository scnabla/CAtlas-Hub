import { TodoMatch, TodoParseOptions } from './todoTypes';
import { isMyTodoOwner } from './todoOwner';
import { commentMarkers, markerPattern } from './todoMarkerModel';
import { TODO_SCAN_MAX_RESULTS } from './todoScanEngine';

// 索引跨扫描保留。复制截取的字符串，避免短描述继续引用整个源文件。
function detached(value: string): string {
  return Buffer.from(value, 'utf16le').toString('utf16le');
}

export function* todoMatches(text: string, options: TodoParseOptions, includeCompleted = false): Generator<TodoMatch> {
  const tags = new Map(options.tags.filter((tag) => tag.enabled).map((tag) => [tag.name.toUpperCase(), tag.name]));
  if (!tags.size) return;
  if (options.markdownTasks && options.includeProjectMarkers !== false && tags.has('TODO')) {
    let line = 0;
    for (const row of text.matchAll(/([^\r\n]*)(?:\r\n|\n|\r|$)/g)) {
      const task = /^\s*[-*+]\s+(\[([ xX])\])\s*(.*)$/.exec(row[1]!);
      if (task && (includeCompleted || task[2] === ' ')) {
        const startCharacter = row[1]!.indexOf('[');
        yield { tag: 'TODO', rawTag: 'TODO', text: detached(task[3]!.trim()), line,
          startCharacter, endCharacter: startCharacter + 3, completed: task[2] !== ' ', source: 'markdownTask' };
      }
      line++;
    }
  }
  if (!options.lineCommentTokens.length && !options.blockCommentTokens.length) return;
  const pattern = markerPattern([...tags.keys()]);
  for (const { line, lineNumber, marker } of commentMarkers(text, pattern, options.languageId ?? 'cpp', options.lineCommentTokens, options.blockCommentTokens)) {
    if (marker.completed && !includeCompleted) continue;
    if (options.includeProjectMarkers === false && !isMyTodoOwner(marker.owner, options.ownerIdentities ?? [])) continue;
    const tag = tags.get(marker.tag)!;
    const raw = line.slice(marker.tagStart, marker.tagEnd);
    yield { tag, rawTag: raw === tag ? tag : detached(raw), text: detached(line.slice(marker.syntaxEnd, marker.descriptionEnd)),
      ...(marker.owner === undefined ? {} : { owner: detached(marker.owner) }), line: lineNumber,
      startCharacter: marker.tagStart, endCharacter: marker.tagEnd, completed: marker.completed, source: 'comment' };
  }
}

export function parseTodoText(text: string, options: TodoParseOptions, onLimit?: () => void): TodoMatch[] {
  const matches: TodoMatch[] = [];
  let mine = 0, other = 0;
  for (const match of todoMatches(text, options)) {
    const personal = isMyTodoOwner(match.owner, options.ownerIdentities ?? []);
    if ((personal ? mine : other) >= TODO_SCAN_MAX_RESULTS) {
      onLimit?.();
      if (options.includeProjectMarkers === false || !options.ownerIdentities?.length || (mine >= TODO_SCAN_MAX_RESULTS && other >= TODO_SCAN_MAX_RESULTS)) break;
      continue;
    }
    if (personal) mine++; else other++;
    matches.push(match);
  }
  return matches;
}
