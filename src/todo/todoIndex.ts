/**
 * TODO 的内存数据集合，供扫描器写入、视图和装饰读取；不负责扫描文件或保存用户配置。
 * 修订号用于区分全量扫描开始前后的更改，防止旧扫描把刚添加的标记抹掉或把刚删除的标记恢复。
 * 无匹配的文件也可能需要保留修订记录；修改删除逻辑时，应同时检查 removeAtRevision 与 reconcile。
 */
import { isMyTodoOwner } from './todoOwner';
import { TODO_SCAN_MAX_RESULTS } from './todoScanEngine';
import { TodoMatch, TodoResourceResult } from './todoTypes';

export interface TodoIndexSnapshot {
  readonly entries: readonly TodoResourceResult[];
  readonly revisions: readonly (readonly [string, number])[];
}

const pathOrder = new Intl.Collator(undefined, { numeric: true });

export class TodoIndex {
  private readonly entries = new Map<string, TodoResourceResult>();
  private readonly revisions = new Map<string, number>();

  private generation = 0;
  private matchCount = 0;
  public get version(): number { return this.generation; }
  public get total(): number { return this.matchCount; }

  public limitResults(identities: readonly string[]): boolean {
    if (this.matchCount <= TODO_SCAN_MAX_RESULTS) return false;
    let mine = 0, other = 0, truncated = false;
    for (const entry of this.entries.values()) {
      const accepted = entry.matches.filter((m) => isMyTodoOwner(m.owner, identities)
        ? ++mine <= TODO_SCAN_MAX_RESULTS : ++other <= TODO_SCAN_MAX_RESULTS);
      if (accepted.length !== entry.matches.length) {
        this.replace(entry.uri, accepted, entry.revision, entry.relativePath, entry.workspaceUri);
        truncated = true;
      }
    }
    return truncated;
  }

  public replace(
    uri: string,
    matches: readonly TodoMatch[],
    revision: number,
    relativePath: string,
    workspaceUri?: string,
  ): boolean {
    const previousRevision = this.revisions.get(uri);
    if (previousRevision !== undefined && previousRevision > revision) return false;
    this.matchCount += matches.length - (this.entries.get(uri)?.matches.length ?? 0);
    this.generation++;
    this.revisions.set(uri, revision);
    if (matches.length === 0) {
      return this.entries.delete(uri);
    }
    this.entries.set(uri, {
      uri,
      matches: [...matches],
      revision,
      relativePath,
      ...(workspaceUri === undefined ? {} : { workspaceUri }),
    });
    return true;
  }

  public remove(uri: string): boolean {
    this.generation++;
    this.matchCount -= this.entries.get(uri)?.matches.length ?? 0;
    this.revisions.delete(uri);
    return this.entries.delete(uri);
  }

  public removeAtRevision(uri: string, revision: number): boolean {
    const previousRevision = this.revisions.get(uri);
    if (previousRevision !== undefined && previousRevision > revision) return false;
    this.generation++;
    this.matchCount -= this.entries.get(uri)?.matches.length ?? 0;
    this.revisions.set(uri, revision);
    return this.entries.delete(uri);
  }

  public clear(): void {
    this.generation++;
    this.matchCount = 0;
    this.entries.clear();
    this.revisions.clear();
  }

  public snapshot(): TodoIndexSnapshot {
    return {
      entries: this.values().map((entry) => ({ ...entry, matches: [...entry.matches] })),
      revisions: [...this.revisions.entries()],
    };
  }

  public restore(snapshot: TodoIndexSnapshot): void {
    this.clear();
    this.matchCount = snapshot.entries.reduce((sum, entry) => sum + entry.matches.length, 0);
    for (const entry of snapshot.entries) {
      this.entries.set(entry.uri, { ...entry, matches: [...entry.matches] });
    }
    for (const [uri, revision] of snapshot.revisions) this.revisions.set(uri, revision);
  }

  /**
   * 原子应用一次完整扫描结果，同时保留扫描开始后产生的实时文档修订。
   */
  public reconcile(snapshot: TodoIndexSnapshot, scanRevision: number): void {
    const currentEntries = new Map(this.entries);
    const currentRevisions = new Map(this.revisions);

    this.restore(snapshot);

    for (const [uri, revision] of currentRevisions) {
      if (revision <= scanRevision) continue;
      const currentEntry = currentEntries.get(uri);
      if (currentEntry === undefined) this.removeAtRevision(uri, revision);
      else this.replace(uri, currentEntry.matches, revision, currentEntry.relativePath, currentEntry.workspaceUri);
    }
  }

  public get(uri: string): TodoResourceResult | undefined {
    return this.entries.get(uri);
  }

  public values(): TodoResourceResult[] {
    return [...this.entries.values()].sort((a, b) => pathOrder.compare(a.relativePath, b.relativePath));
  }

  public get size(): number {
    return this.entries.size;
  }
}
