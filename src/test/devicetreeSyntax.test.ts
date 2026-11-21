import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDevicetreeSyntax } from '../devicetree/syntax';

test('设备树诊断定位到当前错误并继续检查下一条属性', () => {
  const source = '&uart {\r\n  title = "中文"\r\n  reg = <0x48;\r\n  data = [01 GG];\r\n};';
  const issues = checkDevicetreeSyntax(source);
  assert.deepEqual(issues.map(i => i.offset), [source.lastIndexOf('"'), source.indexOf(';'), source.indexOf('GG')]);
  assert.deepEqual(issues.map(i => source.slice(i.offset, i.offset + i.length)), ['"', ';', 'GG']);
});

test('未闭合内容标记起始位置，字符串和注释内的标点不会充当结束符', () => {
  for (const [input, marker] of [
    ['&external { reg = <1>;', '{'], ['&external { name = "text', '"'],
    ['&external { /* } > ;', '/*'], ['&external { data = [00;', ';'],
  ]) {
    const issue = checkDevicetreeSyntax(input!)[0]!;
    assert.equal(issue.offset, input!.indexOf(marker!));
  }
});

test('允许路径引用、跨文件引用、字节标签、多行宏和括号表达式', () => {
  const source = [
    '#define BYTE_A 0x0A', '#define MASK(n) \\', '  (1 << (n))',
    '&{/soc/i2c@0} {', '  refs = <&external (1 << 4) (7 > 2)>;',
    '  data = [ start: AABB /* ] */ BYTE_A ];',
    '  text = "/* > */", "中文";', '  speed =', '#if FAST',
    '    <400000>', '#else', '    <100000>', '#endif', '    ;', '};',
  ].join('\n');
  assert.deepEqual(checkDevicetreeSyntax(source), []);
});
