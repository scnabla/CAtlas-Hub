import { promises as fs, watchFile, unwatchFile } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';

export interface PersonalData {
  format: 'catlas-hub-personal-data';
  version: 1;
  preferences: Record<string, unknown>;
  state: Record<string, unknown>;
}
const empty = (): PersonalData => ({ format: 'catlas-hub-personal-data', version: 1, preferences: {}, state: {} });
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = <T>(value: T): T => value === undefined ? value : structuredClone(value);
export function personalDataPath(platform = process.platform, env = process.env, home = os.homedir()): string {
  const absolute = (value: string | undefined): string | undefined => value && (platform === 'win32' ? path.win32 : path.posix).isAbsolute(value) ? value : undefined;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const base = platform === 'win32' ? absolute(env.APPDATA) ?? paths.join(home, 'AppData', 'Roaming')
    : platform === 'darwin' ? paths.join(home, 'Library', 'Application Support')
      : absolute(env.XDG_CONFIG_HOME) ?? paths.join(home, '.config');
  return paths.join(base, 'CAtlas Hub', 'personal-data.dat');
}

export class DataLocationExistsError extends Error {
  public constructor() { super('所选目录已存在插件数据。'); }
}

export interface DataLocationChange {
  readonly changed: boolean;
  readonly usedExisting: boolean;
  readonly retainedPreviousFile?: string;
}

/** 独立于扩展 ID 的个人数据；同目录临时文件原子替换，锁内重读以协调多个窗口。 */
export class PersonalDataStore {
  private data = empty();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(before: PersonalData, after: PersonalData, external: boolean) => void>();
  private disposed = false;
  private watching = false;
  private watchListener?: () => void;
  private currentFile: string;
  private watchError?: (error: unknown) => void;
  public readonly locationFile: string;
  public constructor(public readonly defaultFile: string) {
    this.currentFile = path.resolve(defaultFile);
    this.locationFile = path.resolve(defaultFile) + '.location';
  }
  public get file(): string { return this.currentFile; }
  public snapshot(): PersonalData { return clone(this.data); }
  public get<T>(section: 'preferences' | 'state', key: string, fallback?: T): T | undefined {
    return clone((this.data[section][key] as T | undefined) ?? fallback);
  }
  public onChange(listener: (before: PersonalData, after: PersonalData, external: boolean) => void): { dispose(): void } {
    this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) };
  }
  public async initialize(): Promise<void> {
    await this.transact(() => undefined, true);
  }
  public async update(section: 'preferences' | 'state', key: string, value: unknown): Promise<void> {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('不支持的数据键。');
    const expected = clone(this.data[section][key]);
    await this.transact((data) => {
      if (section === 'state' && !equal(data.state[key], expected) && !equal(data.state[key], value)) {
        this.accept(data, true);
        throw new Error('个人数据已被其他窗口修改，请刷新后重试。');
      }
      if (value === undefined) delete data[section][key]; else data[section][key] = clone(value);
    });
  }
  public async reload(): Promise<void> {
    await this.serial(async () => {
      if (this.disposed) return;
      const unlockLocation = await this.lock(this.locationFile + '.lock');
      try {
        await this.resolveLocation();
        const unlock = await this.lock(this.file + '.lock');
        try { this.accept(await this.read(false), true); } finally { await unlock(); }
      } finally { await unlockLocation(); }
    });
  }

  public async relocate(directory: string, useExisting = false): Promise<DataLocationChange> {
    return this.serial(async () => {
      if (this.disposed) throw new Error('个人数据存储已关闭。');
      if (!path.isAbsolute(directory)) throw new Error('请选择完整的数据保存路径。');
      const unlockLocation = await this.lock(this.locationFile + '.lock');
      try {
        await this.resolveLocation();
        const previousFile = this.file;
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const target = path.join(await fs.realpath(directory), 'personal-data.dat');
        const source = await fs.realpath(previousFile);
        const same = process.platform === 'win32' ? source.toLowerCase() === target.toLowerCase() : source === target;
        if (same) return { changed: false, usedExisting: false };
        const unlockSource = await this.lock(previousFile + '.lock');
        try {
          const current = await this.read(false);
          const unlockTarget = await this.lock(target + '.lock');
          try {
            let created = false;
            let next: PersonalData;
            try {
              if (useExisting) {
                next = await this.read(false, target);
              } else {
                let handle;
                try { handle = await fs.open(target, 'wx', 0o600); }
                catch (error) {
                  if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new DataLocationExistsError();
                  throw error;
                }
                created = true;
                const bytes = Buffer.from(JSON.stringify(current));
                try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
                if (!(await fs.readFile(target)).equals(bytes)) throw new Error('新位置的数据校验失败，原文件已保留。');
                next = current;
              }
              await this.saveLocation(target);
            } catch (error) {
              if (created) await fs.rm(target, { force: true });
              throw error;
            }
            this.setFile(target);
            this.accept(next, true);
            let retainedPreviousFile: string | undefined;
            if (!useExisting) {
              try { await fs.unlink(previousFile); }
              catch { retainedPreviousFile = previousFile; }
            }
            return { changed: true, usedExisting: useExisting, ...(retainedPreviousFile ? { retainedPreviousFile } : {}) };
          } finally { await unlockTarget(); }
        } finally { await unlockSource(); }
      } finally { await unlockLocation(); }
    });
  }

  private async saveLocation(file: string): Promise<void> {
    const temporary = this.locationFile + '.' + randomUUID() + '.tmp';
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ format: 'catlas-hub-data-location', version: 1, file }), 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      await fs.rename(temporary, this.locationFile);
    } finally { await fs.rm(temporary, { force: true }); }
  }

  private async resolveLocation(): Promise<boolean> {
    let text: string;
    try { text = await fs.readFile(this.locationFile, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.setFile(path.resolve(this.defaultFile)); return false;
    }
    const value: unknown = JSON.parse(text);
    if (!record(value) || value.format !== 'catlas-hub-data-location' || value.version !== 1
      || typeof value.file !== 'string' || !path.isAbsolute(value.file) || path.basename(value.file) !== 'personal-data.dat') {
      throw new Error('数据保存位置记录无效，请检查原位置记录。');
    }
    this.setFile(value.file); return true;
  }

  private setFile(file: string): void {
    if (file === this.currentFile) return;
    if (this.watchListener) unwatchFile(this.currentFile, this.watchListener);
    this.currentFile = file;
    if (this.watching && this.watchListener) watchFile(file, { persistent: false, interval: 500 }, this.watchListener);
  }
  public watch(onError: (error: unknown) => void): void {
    if (this.watching) return;
    this.watching = true;
    this.watchError = onError;
    this.watchListener = () => { void this.reload().catch((error) => this.watchError?.(error)); };
    watchFile(this.file, { persistent: false, interval: 500 }, this.watchListener);
    watchFile(this.locationFile, { persistent: false, interval: 500 }, this.watchListener);
  }
  public dispose(): void { this.disposed = true; if (this.watchListener) { unwatchFile(this.file, this.watchListener); unwatchFile(this.locationFile, this.watchListener); } this.listeners.clear(); }
  private accept(next: PersonalData, external = false): void {
    if (equal(this.data, next)) return;
    const before = this.data; this.data = clone(next);
    for (const listener of this.listeners) listener(clone(before), clone(next), external);
  }
  private async read(allowMissing: boolean, filename = this.file): Promise<PersonalData> {
    let bytes: Buffer;
    try {
      const file = await fs.open(filename, 'r');
      try { if ((await file.stat()).size > 16 * 1024 * 1024) throw new Error('个人数据文件超过大小限制。'); bytes = await file.readFile(); }
      finally { await file.close(); }
    } catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return empty(); throw error; }
    const data: unknown = JSON.parse(bytes.toString('utf8'));
    if (!record(data) || data.format !== 'catlas-hub-personal-data' || data.version !== 1
      || !record(data.preferences) || !record(data.state)) throw new Error('个人数据文件格式不受支持，原文件已保留。');
    return data as unknown as PersonalData;
  }
  private async serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action); this.queue = next.catch(() => undefined); return next;
  }
  private async transact(change: (data: PersonalData) => void, allowMissing = false): Promise<void> {
    await this.serial(async () => {
      if (this.disposed) throw new Error('个人数据存储已关闭。');
      await fs.mkdir(path.dirname(this.locationFile), { recursive: true, mode: 0o700 });
      const unlockLocation = await this.lock(this.locationFile + '.lock');
      try {
        const previousFile = this.file;
        const hasLocation = await this.resolveLocation();
        const unlock = await this.lock(this.file + '.lock');
        const temporary = this.file + '.' + randomUUID() + '.tmp';
        try {
          const data = await this.read(allowMissing && !hasLocation); const previous = JSON.stringify(data);
          change(data);
          const text = JSON.stringify(data);
          if (text !== previous || allowMissing) {
            if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('个人数据超过大小限制。');
            const handle = await fs.open(temporary, 'wx', 0o600);
            try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
            await fs.rename(temporary, this.file);
          }
          this.accept(data, previousFile !== this.file);
        } finally { try { await fs.rm(temporary, { force: true }); } finally { await unlock(); } }
      } finally { await unlockLocation(); }
    });
  }
  private async lock(lockPath: string): Promise<() => Promise<void>> {
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const handle = await fs.open(lockPath, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify({ pid: process.pid, host: os.hostname() })); }
        catch (error) { await handle.close(); await fs.rm(lockPath, { force: true }); throw error; }
        return async () => { await handle.close(); await fs.unlink(lockPath); };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const stat = await fs.stat(lockPath);
          if (Date.now() - stat.mtimeMs > 30_000) {
            const owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
            if (owner.host === os.hostname() && Number.isInteger(owner.pid) && owner.pid > 0) {
              try { process.kill(owner.pid, 0); } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ESRCH') await fs.unlink(lockPath);
              }
            }
          }
        } catch { /* 正在创建或释放的锁等待下一轮。 */ }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    throw new Error('个人数据正在由其他窗口保存，请稍后重试。');
  }
}
