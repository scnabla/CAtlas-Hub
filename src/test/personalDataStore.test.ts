import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PersonalDataStore, personalDataPath } from '../storage/personalDataStore';

async function fixture(run: (file: string) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'catlas-personal-test-'));
  try { await run(path.join(directory, 'personal-data.dat')); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}
test('个人数据目录跨平台固定且不包含发布者 ID', () => {
  assert.equal(personalDataPath('linux', {}, '/home/person'), '/home/person/.config/CAtlas Hub/personal-data.dat');
  assert.equal(personalDataPath('linux', { XDG_CONFIG_HOME: '/config' }, '/home/person'), '/config/CAtlas Hub/personal-data.dat');
  assert.equal(personalDataPath('linux', { XDG_CONFIG_HOME: 'relative' }, '/home/person'), '/home/person/.config/CAtlas Hub/personal-data.dat');
  assert.equal(personalDataPath('win32', { APPDATA: 'C:\\Users\\person\\AppData\\Roaming' }, 'C:\\Users\\person'), 'C:\\Users\\person\\AppData\\Roaming\\CAtlas Hub\\personal-data.dat');
});
test('新文件从空数据开始，保存和重启保持个人偏好与集合', async () => fixture(async (file) => {
  const first = new PersonalDataStore(file);
  await first.initialize();
  assert.deepEqual(first.snapshot(), { format: 'catlas-hub-personal-data', version: 1, preferences: {}, state: {} });
  await first.update('state', 'library', ['first']);
  await first.update('preferences', 'projectManager.todo.owner', 'after');
  await first.update('preferences', 'reset-setting', true);
  await first.update('preferences', 'reset-setting', undefined);
  first.dispose();
  const second = new PersonalDataStore(file);
  await second.initialize();
  assert.equal(second.get('preferences', 'projectManager.todo.owner'), 'after');
  assert.equal(second.get('preferences', 'reset-setting'), undefined);
  assert.deepEqual(second.get('state', 'library'), ['first']);
  await second.update('preferences', 'projectManager.todo.owner', undefined);
  await second.initialize();
  assert.equal(second.get('preferences', 'projectManager.todo.owner'), undefined);
  second.dispose();
}));
test('多个实例同时保存不同个人偏好不会丢失其他窗口的值', async () => fixture(async (file) => {
  const a = new PersonalDataStore(file); const b = new PersonalDataStore(file);
  await a.initialize(); await b.initialize();
  await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).update('preferences', 'key-' + i, i)));
  await a.reload(); for (let i = 0; i < 12; i++) assert.equal(a.get('preferences', 'key-' + i), i);
  assert.deepEqual((await fs.readdir(path.dirname(file))).sort(), ['personal-data.dat']);
  a.dispose(); b.dispose();
}));
test('过期窗口写入集合时拒绝覆盖，并读取另一窗口的新值', async () => fixture(async (file) => {
  const a = new PersonalDataStore(file); const b = new PersonalDataStore(file);
  await a.initialize(); await a.update('state', 'library', ['original']); await b.initialize();
  await a.update('state', 'library', ['saved']);
  await assert.rejects(b.update('state', 'library', ['stale']), /其他窗口/);
  assert.deepEqual(b.get('state', 'library'), ['saved']);
  a.dispose(); b.dispose();
}));
test('损坏文件和未来格式拒绝读取、拒绝写入且保留原内容', async () => fixture(async (file) => {
  const store = new PersonalDataStore(file); await store.initialize();
  for (const text of ['broken', JSON.stringify({ ...store.snapshot(), version: 99 })]) {
    await fs.writeFile(file, text);
    await assert.rejects(store.update('preferences', 'key', true));
    await assert.rejects(store.initialize());
    assert.equal(await fs.readFile(file, 'utf8'), text);
  }
  store.dispose();
}));

test('整体移动个人偏好与集合，其他窗口和重启读取新位置', async () => fixture(async (file) => {
  const a = new PersonalDataStore(file); const b = new PersonalDataStore(file);
  await a.initialize(); await a.update('preferences', 'owner', 'person'); await a.update('state', 'library', ['project']);
  await b.initialize();
  const watchErrors: unknown[] = [];
  b.watch(error => watchErrors.push(error));
  const target = path.join(path.dirname(file), '新位置 空格');
  const result = await a.relocate(target);
  assert.equal(result.changed, true);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  for (let attempt = 0; b.file !== a.file && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(b.file, a.file); assert.deepEqual(b.get('state', 'library'), ['project']);
  assert.deepEqual(watchErrors, []);
  await b.update('preferences', 'other-window', true);
  const restarted = new PersonalDataStore(file); await restarted.initialize();
  assert.equal(restarted.file, a.file); assert.equal(restarted.get('preferences', 'owner'), 'person');
  assert.equal(restarted.get('preferences', 'other-window'), true);
  assert.equal((await a.relocate(target)).changed, false);
  assert.deepEqual((await fs.readdir(target)).sort(), ['personal-data.dat']);
  a.dispose(); b.dispose(); restarted.dispose();
}));

test('目标已有数据时不覆盖，明确选择后切换整份数据并保留原文件', async () => fixture(async (file) => {
  const a = new PersonalDataStore(file); await a.initialize(); await a.update('preferences', 'owner', 'original');
  const b = new PersonalDataStore(path.join(path.dirname(file), 'existing', 'personal-data.dat'));
  await b.initialize(); await b.update('preferences', 'owner', 'selected'); await b.update('state', 'library', ['selected-project']);
  const original = await fs.readFile(file); const target = await fs.readFile(b.file);
  await assert.rejects(a.relocate(path.dirname(b.file)), /已存在/);
  assert.deepEqual(await fs.readFile(file), original); assert.deepEqual(await fs.readFile(b.file), target);
  const result = await a.relocate(path.dirname(b.file), true);
  assert.equal(result.usedExisting, true); assert.equal(a.get('preferences', 'owner'), 'selected');
  assert.deepEqual(a.get('state', 'library'), ['selected-project']); assert.deepEqual(await fs.readFile(file), original);
  a.dispose(); b.dispose();
}));

test('位置记录写入失败时撤销新文件并保留原数据', async (t) => fixture(async (file) => {
  const a = new PersonalDataStore(file); await a.initialize(); await a.update('state', 'library', ['keep']);
  const original = await fs.readFile(file); const destination = path.join(path.dirname(file), 'target');
  const rename = fs.rename.bind(fs);
  const stub = t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    if (String(args[1]) === a.locationFile) throw Object.assign(new Error('位置记录不可写'), { code: 'EACCES' });
    return rename(...args);
  });
  try { await assert.rejects(a.relocate(destination), /不可写/); }
  finally { stub.mock.restore(); }
  assert.deepEqual(await fs.readFile(file), original); assert.equal(a.file, file);
  await assert.rejects(fs.stat(path.join(destination, 'personal-data.dat')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(a.locationFile), { code: 'ENOENT' });
  a.dispose();
}));

test('目标损坏或自定义目录丢失时不覆盖、不回退创建空数据', async () => fixture(async (file) => {
  const a = new PersonalDataStore(file); await a.initialize(); await a.update('preferences', 'owner', 'keep');
  const target = path.join(path.dirname(file), 'target'); await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'personal-data.dat'), 'broken');
  await assert.rejects(a.relocate(target, true)); assert.equal(a.file, file);
  assert.equal(await fs.readFile(path.join(target, 'personal-data.dat'), 'utf8'), 'broken');
  await fs.unlink(path.join(target, 'personal-data.dat')); await a.relocate(target);
  await fs.unlink(a.file);
  const restarted = new PersonalDataStore(file); await assert.rejects(restarted.initialize());
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  await assert.rejects(fs.stat(a.file), { code: 'ENOENT' });
  a.dispose(); restarted.dispose();
}));

test('另一窗口与移动同时保存时修改完整保留', async () => fixture(async (file) => {
  const a = new PersonalDataStore(file); const b = new PersonalDataStore(file);
  await a.initialize(); await b.initialize();
  await Promise.all([a.relocate(path.join(path.dirname(file), 'target')), b.update('preferences', 'concurrent', true)]);
  await a.reload(); await b.reload();
  assert.equal(a.file, b.file); assert.equal(a.get('preferences', 'concurrent'), true);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  a.dispose(); b.dispose();
}));
