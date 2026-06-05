import type OneDriveSyncPlugin from "../main";
import { DEFAULT_SETTINGS, type OneDriveSyncSettings } from "../types";

export class TokenStore {
  constructor(private plugin: OneDriveSyncPlugin) {}

  get(): OneDriveSyncSettings {
    return this.plugin.settings;
  }

  async saveTokens(
    accessToken: string,
    refreshToken: string,
    expiresIn: number
  ): Promise<void> {
    const s = this.plugin.settings;
    s.accessToken = accessToken;
    s.refreshToken = refreshToken;
    s.tokenExpiry = Date.now() + expiresIn * 1000;
    if (!s.credentialsShouldBeDeletedAtTime) {
      s.credentialsShouldBeDeletedAtTime = Date.now() + 80 * 24 * 60 * 60 * 1000;
    }
    await this.plugin.saveData(this.plugin.settings);
  }

  async clearTokens(): Promise<void> {
    const s = this.plugin.settings;
    s.accessToken = "";
    s.refreshToken = "";
    s.tokenExpiry = 0;
    s.credentialsShouldBeDeletedAtTime = 0;
    s.deltaLink = "";
    s.lastSyncTime = 0;
    s.fileIndex = {};
    await this.plugin.saveData(this.plugin.settings);
  }

  isConnected(): boolean {
    return !!this.plugin.settings.refreshToken;
  }

  isExpired(): boolean {
    const s = this.plugin.settings;
    if (!s.credentialsShouldBeDeletedAtTime) return false;
    return Date.now() > s.credentialsShouldBeDeletedAtTime;
  }
}

export function buildDefaultSettings(vaultName: string): OneDriveSyncSettings {
  return {
    ...DEFAULT_SETTINGS,
    syncFolder: `Obsidian/${vaultName}`,
  };
}
