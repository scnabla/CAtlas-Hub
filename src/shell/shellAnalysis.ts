import * as path from 'node:path';
import type { Node, Parser } from 'web-tree-sitter';

interface Span { start: number; end: number }
interface ShellFunction extends Span { name: string; selection: Span }
interface Link extends Span { target: Span }
interface Binding { name: Span; available: number }
interface Variable { assignment?: Binding; local?: Binding }

class Scope {
  readonly functions = new Map<string, Span | null>();
  readonly variables = new Map<string, Variable>();

  constructor(readonly parent?: Scope, readonly functionBody = false) {}
}

export interface ShellAnalysis {
  functions: ShellFunction[];
  functionTokens: Span[];
  links: Link[];
}

let parser: Promise<Parser> | undefined;

async function createParser(): Promise<Parser> {
  const runtime: typeof import('web-tree-sitter') = require('./vendor/tree-sitter.cjs');
  await runtime.Parser.init();
  const language = await runtime.Language.load(path.join(__dirname, 'vendor/tree-sitter-bash.wasm'));
  return new runtime.Parser().setLanguage(language);
}

function span(node: Node): Span {
  return { start: node.startIndex, end: node.endIndex };
}

function resolveVariable(scope: Scope, name: string, offset: number): Span | undefined {
  let target: Span | undefined;
  let limit = offset;
  for (let current: Scope | undefined = scope; current; current = current.parent) {
    const variable = current.variables.get(name);
    if (variable?.local && variable.local.available <= limit) return variable.local.name;
    if (variable?.assignment && variable.assignment.available <= limit) {
      target = variable.assignment.name;
      if (!current.functionBody) return target;
    }
    // 函数体可能在脚本后面的赋值完成后才被调用。
    if (current.functionBody) limit = Infinity;
  }
  return target;
}

function recordVariable(scope: Scope, name: Node, available: number, local: boolean): void {
  const variable = scope.variables.get(name.text) ?? {};
  const field = local ? 'local' : 'assignment';
  variable[field] ??= { name: span(name), available };
  scope.variables.set(name.text, variable);
}

function collectVariables(node: Node, scope: Scope): void {
  if (node.type === 'for_statement') {
    const name = node.childForFieldName('variable');
    const body = node.childForFieldName('body');
    if (name && body) recordVariable(scope, name, body.startIndex, false);
    return;
  }
  const declaration = node.type === 'declaration_command' ? node : undefined;
  if (!declaration && (node.type !== 'variable_assignment'
    || ['command', 'declaration_command'].includes(node.parent?.type ?? ''))) return;

  const args = declaration?.namedChildren.filter((arg): arg is Node => arg !== null) ?? [node];
  const options = args.filter(arg => arg.type === 'word' && /^-[a-zA-Z]+$/.test(arg.text));
  if (options.some(arg => /[pfF]/.test(arg.text))) return;
  const local = ['local', 'declare', 'typeset'].includes(declaration?.firstChild?.type ?? '')
    && !options.some(arg => arg.text.includes('g'));
  for (const arg of args) {
    let name = arg.type === 'variable_name' ? arg : arg.childForFieldName('name');
    if (name?.type === 'subscript') name = name.childForFieldName('name');
    if (name?.type === 'variable_name') recordVariable(scope, name, node.endIndex, local);
  }
}

export async function analyzeShell(source: string): Promise<ShellAnalysis> {
  const result: ShellAnalysis = { functions: [], functionTokens: [], links: [] };
  if (!source) return result;
  parser ??= createParser();
  const tree = (await parser).parse(source);
  if (!tree) return result;
  const references: { name: string; range: Span; scope: Scope; isFunction: boolean }[] = [];
  try {
    const pending = [{ node: tree.rootNode, scope: new Scope() }];
    while (pending.length) {
      const { node, scope } = pending.pop()!;
      if (node.type === 'heredoc_body' || node.type === 'ERROR') continue;
      let childrenScope = scope;
      if (node.type === 'function_definition') {
        const name = node.childForFieldName('name');
        if (name && !name.isMissing) {
          const selection = span(name);
          result.functions.push({ ...span(node), name: name.text, selection });
          result.functionTokens.push(selection);
          scope.functions.set(name.text, scope.functions.has(name.text) ? null : selection);
        }
        childrenScope = new Scope(scope, true);
      } else if (['subshell', 'command_substitution', 'process_substitution'].includes(node.type)) {
        childrenScope = new Scope(scope);
      } else if (node.type === 'command_name' && node.firstNamedChild?.type === 'word') {
        references.push({ name: node.text, range: span(node), scope, isFunction: true });
      } else if (node.type === 'variable_name' && /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(node.text)) {
        const parent = node.parent;
        if (parent && ['simple_expansion', 'expansion', 'subscript'].includes(parent.type)) {
          const range = span(node);
          if (parent.type === 'simple_expansion'
            || (parent.type === 'expansion' && node.startIndex === parent.startIndex + 2)) {
            range.start = parent.startIndex;
          }
          references.push({ name: node.text, range, scope, isFunction: false });
        }
      } else {
        collectVariables(node, scope);
      }
      const children = node.namedChildren;
      for (let i = children.length - 1; i >= 0; i--) {
        pending.push({ node: children[i]!, scope: node.type === 'pipeline' ? new Scope(scope) : childrenScope });
      }
    }
    for (const { name, range, scope, isFunction } of references) {
      let target: Span | undefined | null;
      if (isFunction) {
        for (let current: Scope | undefined = scope; current; current = current.parent) {
          target = current.functions.get(name);
          if (target !== undefined) break;
        }
        if (target) result.functionTokens.push(range);
      } else {
        target = resolveVariable(scope, name, range.start);
      }
      if (target) result.links.push({ ...range, target });
    }
    result.functionTokens.sort((a, b) => a.start - b.start);
    return result;
  } finally {
    tree.delete();
  }
}
