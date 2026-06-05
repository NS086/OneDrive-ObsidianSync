export class FileIndex {
  private pathToId: Map<string, string>;
  private idToPath: Map<string, string>;

  constructor(persisted: Record<string, string> = {}) {
    this.pathToId = new Map(Object.entries(persisted));
    this.idToPath = new Map(
      Object.entries(persisted).map(([path, id]) => [id, path])
    );
  }

  set(vaultPath: string, driveItemId: string): void {
    // Remove any stale reverse entry
    const oldId = this.pathToId.get(vaultPath);
    if (oldId) this.idToPath.delete(oldId);

    this.pathToId.set(vaultPath, driveItemId);
    this.idToPath.set(driveItemId, vaultPath);
  }

  getId(vaultPath: string): string | undefined {
    return this.pathToId.get(vaultPath);
  }

  getPath(driveItemId: string): string | undefined {
    return this.idToPath.get(driveItemId);
  }

  remove(vaultPath: string): void {
    const id = this.pathToId.get(vaultPath);
    if (id) this.idToPath.delete(id);
    this.pathToId.delete(vaultPath);
  }

  hasPath(vaultPath: string): boolean {
    return this.pathToId.has(vaultPath);
  }

  allPaths(): string[] {
    return Array.from(this.pathToId.keys());
  }

  toRecord(): Record<string, string> {
    return Object.fromEntries(this.pathToId);
  }
}
