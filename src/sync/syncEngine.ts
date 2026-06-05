import { Notice, type Vault } from "obsidian";
import type { DriveApi } from "../graph/driveApi";
import type { TokenStore } from "../auth/tokenStore";
import type { StatusBar } from "../ui/statusBar";
import { FileIndex } from "./fileIndex";
import type { DriveItem } from "../types";

function vaultPathFromItem(item: DriveItem, syncFolder: string): string {
  // item.parentReference.path is like "/drive/root:/Obsidian/MyVault/subdir"
  // We want the vault-relative path
  const prefix = `/drive/root:/${syncFolder}`;
  const parentPath = item.parentReference?.path ?? "";
  const relParent = parentPath.startsWith(prefix)
    ? parentPath.slice(prefix.length).replace(/^\//, "")
    : "";
  return relParent ? `${relParent}/${item.name}` : item.name;
}

async function ensureParentDir(vault: Vault, vaultPath: string): Promise<void> {
  const parts = vaultPath.split("/");
  parts.pop(); // remove filename
  let dir = "";
  for (const part of parts) {
    dir = dir ? `${dir}/${part}` : part;
    if (!(await vault.adapter.exists(dir))) {
      await vault.adapter.mkdir(dir);
    }
  }
}

function conflictPath(vaultPath: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dot = vaultPath.lastIndexOf(".");
  if (dot > 0) {
    return `${vaultPath.slice(0, dot)}.conflict-${ts}${vaultPath.slice(dot)}`;
  }
  return `${vaultPath}.conflict-${ts}`;
}

export class SyncEngine {
  private running = false;

  constructor(
    private vault: Vault,
    private driveApi: DriveApi,
    private tokenStore: TokenStore,
    private statusBar: StatusBar
  ) {}

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.statusBar.setState("syncing");

    const s = this.tokenStore.get();

    if (!s.clientId || !s.refreshToken) {
      this.statusBar.setState("auth_required");
      this.running = false;
      return;
    }

    try {
      await this._run(s.syncFolder, s.deltaLink, s.lastSyncTime, s.fileIndex);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.statusBar.setState("error", msg);
      new Notice(`OneDrive sync error: ${msg}`);
    } finally {
      this.running = false;
    }
  }

  private async _run(
    syncFolder: string,
    savedDeltaLink: string,
    lastSyncTime: number,
    persistedIndex: Record<string, string>
  ): Promise<void> {
    await this.driveApi.ensureSyncFolder(syncFolder);

    const index = new FileIndex(persistedIndex);

    // ── Phase 1: Remote delta ─────────────────────────────────────────
    let deltaResult;
    try {
      deltaResult = await this.driveApi.delta(syncFolder, savedDeltaLink || undefined);
    } catch (err) {
      // 410 Gone: delta token expired — full re-enumeration
      if (err instanceof Error && err.message.includes("410")) {
        deltaResult = await this.driveApi.delta(syncFolder);
      } else {
        throw err;
      }
    }

    const { items: remoteItems, deltaLink: newDeltaLink } = deltaResult;

    // ── Phase 2: Collect local changes ────────────────────────────────
    const vaultFiles = this.vault.getFiles();
    const vaultPaths = new Set(vaultFiles.map((f) => f.path));

    const localModified: string[] = [];
    const localDeleted: Array<{ path: string; remoteId: string }> = [];

    for (const file of vaultFiles) {
      if (file.stat.mtime > lastSyncTime) {
        localModified.push(file.path);
      }
    }

    for (const path of index.allPaths()) {
      if (!vaultPaths.has(path)) {
        const remoteId = index.getId(path);
        if (remoteId) localDeleted.push({ path, remoteId });
      }
    }

    // ── Phase 3: Classify remote changes ──────────────────────────────
    const toDownload: DriveItem[] = [];
    const toDeleteLocally: string[] = [];
    const conflicts: Array<{ vaultPath: string; item: DriveItem }> = [];
    const remoteModifiedPaths = new Set<string>();

    for (const item of remoteItems) {
      if (item.folder) continue; // skip folder entries

      const vaultPath = vaultPathFromItem(item, syncFolder);

      if (item.deleted) {
        if (vaultPaths.has(vaultPath)) {
          toDeleteLocally.push(vaultPath);
        }
        index.remove(vaultPath);
        continue;
      }

      remoteModifiedPaths.add(vaultPath);
      index.set(vaultPath, item.id);

      const localFile = this.vault.getFileByPath(vaultPath);
      if (!localFile) {
        toDownload.push(item);
        continue;
      }

      const localMtime = localFile.stat.mtime;
      const remoteMtime = new Date(item.lastModifiedDateTime).getTime();

      if (Math.abs(localMtime - remoteMtime) < 2000) continue; // same version

      const localChanged = localMtime > lastSyncTime;
      const remoteChanged = remoteMtime > lastSyncTime;

      if (localChanged && remoteChanged) {
        conflicts.push({ vaultPath, item });
      } else if (remoteChanged) {
        toDownload.push(item);
      }
      // else: local-only change — handled in upload phase
    }

    // ── Phase 4: Conflict resolution ──────────────────────────────────
    const extraUploads: string[] = [];
    for (const { vaultPath, item } of conflicts) {
      const cp = conflictPath(vaultPath);
      const content = await this.vault.adapter.readBinary(vaultPath);
      await ensureParentDir(this.vault, cp);
      await this.vault.adapter.writeBinary(cp, content);
      extraUploads.push(cp);
      toDownload.push(item);
      new Notice(`Sync conflict: kept both versions of "${vaultPath}"`);
    }

    // ── Phase 5: Apply downloads ──────────────────────────────────────
    for (const item of toDownload) {
      const vaultPath = vaultPathFromItem(item, syncFolder);
      const data = await this.driveApi.downloadFile(item);
      await ensureParentDir(this.vault, vaultPath);
      await this.vault.adapter.writeBinary(vaultPath, data);
      index.set(vaultPath, item.id);
    }

    // ── Phase 6: Apply uploads ────────────────────────────────────────
    const uploadPaths = [
      ...localModified.filter((p) => !remoteModifiedPaths.has(p)),
      ...extraUploads,
    ];

    for (const vaultPath of uploadPaths) {
      const data = await this.vault.adapter.readBinary(vaultPath);
      const driveItem = await this.driveApi.uploadFile(syncFolder, vaultPath, data);
      if (driveItem?.id) index.set(vaultPath, driveItem.id);
    }

    // ── Phase 7: Apply local deletes (remote deleted) ─────────────────
    for (const path of toDeleteLocally) {
      try {
        await this.vault.adapter.remove(path);
      } catch {
        // file may have already been deleted
      }
      index.remove(path);
    }

    // ── Phase 8: Apply remote deletes (locally deleted) ───────────────
    for (const { remoteId, path } of localDeleted) {
      await this.driveApi.deleteFile(remoteId);
      index.remove(path);
    }

    // ── Phase 9: Persist state ────────────────────────────────────────
    const s = this.tokenStore.get();
    s.deltaLink = newDeltaLink;
    s.lastSyncTime = Date.now();
    s.fileIndex = index.toRecord();
    await this.tokenStore.get(); // reads current reference
    // save via plugin
    const plugin = (this.tokenStore as any).plugin;
    await plugin.saveData(s);

    this.statusBar.setState("idle");
    new Notice("OneDrive sync complete");
  }
}
