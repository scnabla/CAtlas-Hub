// VS Code 的文本位置和 match.index 都按 UTF-16 计数，包括字符串中的非 ASCII 字符。
const pattern = new RegExp([
  /(?<directive>^[ \t]*#[ \t]*(?:include|define|undef|if|ifdef|ifndef|elif|else|endif|pragma|error|warning|line)\b(?:\\\r?\n|[^\r\n])*)/.source,
  /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|(?<openComment>(?![\s\S])))/.source,
  /"(?:\\[\s\S]|[^"\\])*(?:"|\\?(?<openString>(?![\s\S])))/.source,
  /'(?:\\[\s\S]|[^'\\])*(?:'|\\?(?<openChar>(?![\s\S])))/.source,
  /&\{\/[^{}\r\n]*\}|&[A-Za-z_]\w*/.source,
  /\/[a-z][\w-]*\/|[A-Za-z0-9_,.+?#@-]+|[^\s]/.source,
].join('|'), 'gm');

export function devicetreeTokens(source: string) {
  return source.matchAll(pattern);
}
