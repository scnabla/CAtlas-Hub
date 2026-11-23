import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeShell } from '../shell/shellAnalysis';

test('Shell 只在命令位置识别函数，保留 CRLF 和中文字符的位置', async () => {
  const source = ['# 中文🟢', 'build_app()', '{ :; }', 'function run { build_app; }',
    'echo build_app; command build_app; "$cmd"', 'run | build_app', "cat <<'END'",
    'fake() { run; }', 'END', 'echo "$(run)"', '# run', "echo 'build_app'"].join('\r\n');
  const analysis = await analyzeShell(source);
  assert.deepEqual(analysis.functions.map(f => f.name), ['build_app', 'run']);
  assert.deepEqual(analysis.functionTokens.map(t => source.slice(t.start, t.end)),
    ['build_app', 'run', 'build_app', 'run', 'build_app', 'run']);
  for (const { start, end, target } of analysis.links) {
    assert.equal(source.slice(start, end), source.slice(target.start, target.end));
  }
});

test('Shell 变量定位到首次赋值或当前函数局部声明', async () => {
  const lines = ['out=one', 'out=two', 'f() {', '  echo "$out"', '  local out="$out"',
    '  echo "${out:-fallback}"', '}', 'g() { local out; echo "$out"; }',
    'out=temp printf "%s" "$out"', 'echo "$1" "$?" "$ENV_ONLY"', "echo '$out'",
    'for item in a b; do echo "$item"; done'];
  const source = lines.join('\n');
  const { links } = await analyzeShell(source);
  assert.deepEqual(links.map(l => l.target.start), [0, 0, source.indexOf('out="$out"'),
    source.indexOf('out; echo'), 0, source.indexOf('item in')]);
});

test('Shell 排除不唯一的函数、子 Shell 中的声明和命令临时赋值', async () => {
  const source = ['f() { :; }; f() { :; }; f', '( inner() { :; }; value=x )',
    'inner; echo "$value"', 'tmp=x env; echo "$tmp"', 'echo "${ENV_ONLY}"',
    'function good { :; }', 'good', 'cat <<EOF', 'f() { good; }', 'EOF'].join('\n');
  const { links } = await analyzeShell(source);
  assert.deepEqual(links.map(l => source.slice(l.start, l.end)), ['good']);
});
