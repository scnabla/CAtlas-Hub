import { getTodoCommentSyntax } from './todoCommentSyntax';

export interface MarkerLocation {
  readonly tag: string;
  readonly tagStart: number;
  readonly tagEnd: number;
  readonly owner?: string;
  readonly ownerRange?: { readonly start: number; readonly end: number };
  readonly ownerSyntaxRange?: { readonly start: number; readonly end: number };
  readonly qualifierEnd: number;
  readonly syntaxEnd: number;
  readonly descriptionEnd: number;
  readonly completedRange?: { readonly start: number; readonly end: number };
  readonly completed: boolean;
}

export function markerPattern(tags: readonly string[]): RegExp {
  const escaped = tags.map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
  return new RegExp(`^\\s*(?:\\*\\s*)?(${escaped.join('|')})(\\s*\\(\\s*([A-Za-z0-9][A-Za-z0-9_.-]{0,31})\\s*\\))?(\\s*\\[([ xX])\\])?(?=\\s|:|$)(?:\\s*:)?\\s*`, 'id');
}

export function* commentMarkers(
  text: string, pattern: RegExp, language: string, lineTokens: readonly string[],
  blocks: readonly { open: string; close: string }[], lastLine = Infinity,
): Generator<{ line: string; lineNumber: number; marker: MarkerLocation }> {
  const tokens = [...blocks, ...lineTokens.map((open) => ({ open, close: '' }))].sort((a, b) => b.open.length - a.open.length);
  const initial = new Set(tokens.map((token) => token.open[0]));
  let block = '', literal = '', quote = '';
  const raw = /R"([^ ()\\\t\r\n]{0,16})\(/y;
  const cpp = ['cpp', 'cuda-cpp', 'c'].includes(language);
  const template = /^(?:javascript|typescript|go)/.test(language);
  for (let start = 0, lineNumber = 0; start <= text.length && lineNumber <= lastLine; lineNumber++) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(start, end > start && text[end - 1] === '\r' ? end - 1 : end);
    start = newline < 0 ? text.length + 1 : newline + 1;
    let continuedQuote = false;
    for (let i = 0; i < line.length;) {
      if (literal) {
        const close = line.indexOf(literal, i);
        if (close < 0) break;
        i = close + literal.length;
        literal = '';
        continue;
      }
      const ch = line[i]!;
      if (quote) {
        if (ch === '\\' && !(language === 'go' && quote === '`')) {
          continuedQuote = i + 1 === line.length;
          i += 2;
        } else {
          if (ch === quote) quote = '';
          i++;
        }
        continue;
      }
      if (!block) {
        if (cpp && ch === 'R') {
          raw.lastIndex = i;
          const delimiter = raw.exec(line);
          if (delimiter) { literal = ')' + delimiter[1] + '"'; i = raw.lastIndex; continue; }
        }
        if (language === 'python' && (ch === '"' || ch === "'") && line.startsWith(ch.repeat(3), i)) {
          literal = ch.repeat(3); i += 3; continue;
        }
        if (ch === '"' || ch === "'" || (template && ch === '`')) { quote = ch; i++; continue; }
        if (!initial.has(ch)) { i++; continue; }
        const token = tokens.find((candidate) => candidate.open[0] === ch && line.startsWith(candidate.open, i));
        if (!token) { i++; continue; }
        i += token.open.length;
        block = token.close;
      }
      const close = block ? line.indexOf(block, i) : -1;
      const body = line.slice(i, close < 0 ? line.length : close);
      const match = pattern.exec(body.trimEnd());
      if (match?.indices?.[1] && match[1]) {
        const range = (group: number) => {
          const indices = match.indices?.[group];
          return indices && { start: i + indices[0], end: i + indices[1] };
        };
        const tag = range(1)!, ownerSyntaxRange = range(2), ownerRange = range(3), completedRange = range(4);
        const marker = {
          tag: match[1].toUpperCase(), tagStart: tag.start, tagEnd: tag.end,
          ...(match[3] && ownerRange && ownerSyntaxRange ? { owner: match[3], ownerRange, ownerSyntaxRange } : {}),
          ...(completedRange ? { completedRange } : {}),
          completed: match[5]?.toLowerCase() === 'x',
          qualifierEnd: ownerSyntaxRange?.end ?? tag.end, syntaxEnd: i + match[0].length,
          descriptionEnd: i + body.trimEnd().length,
        };
        yield { line, lineNumber, marker };
      }
      if (close < 0) break;
      i = close + block.length;
      block = '';
    }
    if (!continuedQuote && quote !== '`') quote = '';
  }
}

export function findMarker(text: string, tags: readonly string[], language = 'cpp', row = 0, column = 0): MarkerLocation | undefined {
  const syntax = getTodoCommentSyntax(language);
  if (!syntax || !tags.length) return undefined;
  const candidates = [];
  for (const { lineNumber, marker } of commentMarkers(text, markerPattern(tags), language, syntax.lineTokens, syntax.blockTokens, row)) {
    if (lineNumber === row) candidates.push(marker);
  }
  return candidates.length === 1 ? candidates[0] : candidates.find((m) => column >= m.tagStart && column <= m.descriptionEnd);
}
