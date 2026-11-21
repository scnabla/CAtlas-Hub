import { devicetreeTokens } from './tokens';

export interface SyntaxIssue {
  offset: number;
  length: number;
  message: string;
}

interface Token {
  text: string;
  offset: number;
}

const invalidByte = '字节应由两位十六进制数字组成，例如 0A 或 FF';
const closing: Record<string, string> = { '{': '}', '[': ']', '<': '>', '(': ')' };

export function checkDevicetreeSyntax(source: string): SyntaxIssue[] {
  const issues: SyntaxIssue[] = [];
  let stack: Token[] = [];
  let inValue = false;
  let previous: Token | undefined;
  let beforePrevious: Token | undefined;
  const branches: { stack: Token[]; inValue: boolean; previous?: Token | undefined;
    beforePrevious?: Token | undefined }[] = [];
  const macros = new Set<string>();
  let unterminated = false;
  let pendingByte: Token | undefined;

  function report(token: Token, message: string, length = token.text.length) {
    issues.push({ offset: token.offset, length, message });
  }

  function missingSemicolon(after: Token, node = false) {
    report({ offset: after.offset + after.text.length - 1, text: after.text.slice(-1) },
      node ? '节点结束后缺少分号 ;' : '属性末尾缺少分号 ;');
  }

  for (const match of devicetreeTokens(source)) {
    const text = match[0];
    const token = { text, offset: match.index! };
    const groups = match.groups!;
    if (groups.openComment !== undefined || groups.openString !== undefined || groups.openChar !== undefined) {
      const comment = groups.openComment !== undefined;
      report(token, comment ? '块注释缺少结束符 */' : '缺少与起始引号配对的结束引号', comment ? 2 : 1);
      unterminated = true;
      break;
    }
    if (text.startsWith('//') || text.startsWith('/*')) continue;
    if (groups.directive !== undefined) {
      const [, directive, name] = /^\s*#\s*(\w+)(?:\s+(\w+))?/.exec(text)!;
      if (directive === 'define' && name) macros.add(name);
      if (directive === 'if' || directive === 'ifdef' || directive === 'ifndef') {
        branches.push({ stack: stack.slice(), inValue, previous, beforePrevious });
      } else if (directive === 'else' || directive === 'elif') {
        const entry = branches.at(-1);
        if (entry) {
          stack = entry.stack.slice();
          ({ inValue, previous, beforePrevious } = entry);
        }
      } else if (directive === 'endif') {
        branches.pop();
      }
      continue;
    }

    // 数组内部也允许标签，跳过空白和注释后看下一项是否为冒号。
    if (pendingByte && text !== ':') report(pendingByte, invalidByte);
    pendingByte = undefined;
    const top = stack.at(-1)?.text;
    if (previous?.text === '}' && text !== ';') missingSemicolon(previous, true);

    if (text === ';' || text === '}') {
      // 在下一条声明开始前恢复，防止一个遗漏的 > 或 ] 影响后面的节点。
      while (stack.length && stack.at(-1)!.text !== '{') {
        const open = stack.pop()!;
        report(token, '缺少与 ' + open.text + ' 配对的 ' + closing[open.text]);
      }
      if (text === '}') {
        if (inValue && previous) missingSemicolon(previous);
        if (!stack.pop()) report(token, '多余的结束符 }');
      } else if (previous?.text === '=') {
        report(token, '等号后缺少属性值');
      } else if (inValue && previous && beforePrevious && /^[\w#.+?-]/.test(previous.text)
          && /^(?:[>\]]|["'])/.test(beforePrevious.text)) {
        missingSemicolon(beforePrevious);
      }
      inValue = false;
    } else if (text === '{' || text === '=' && (!top || top === '{')) {
      if (inValue && beforePrevious) missingSemicolon(beforePrevious);
      inValue = text === '=';
      if (!inValue) stack.push(token);
    } else if (text === '(' || text === '[' || text === '<' && top !== '(') {
      stack.push(token);
    } else if (text === ')' || text === ']' || text === '>' && top !== '(') {
      if (top && closing[top] === text) stack.pop();
      else report(token, '没有与 ' + text + ' 配对的起始符');
    } else if (top === '[' && !macros.has(text) && !/^(?:[0-9a-fA-F]{2})+$/.test(text)
        && text !== ':' && !(/^[A-Z_][A-Z_0-9]*_[A-Z_0-9]*$/.test(text))) {
      pendingByte = token;
    }
    beforePrevious = previous;
    previous = token;
  }

  if (pendingByte) report(pendingByte, invalidByte);
  if (!unterminated) {
    for (const open of stack) report(open, '缺少与 ' + open.text + ' 配对的 ' + closing[open.text]);
    if (previous && (previous.text === '}' || inValue && (!stack.length || stack.at(-1)?.text === '{'))) {
      missingSemicolon(previous, previous.text === '}');
    }
  }
  return issues;
}
