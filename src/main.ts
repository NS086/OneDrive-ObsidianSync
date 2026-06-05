import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type OneDriveSyncSettings } from "./types";
import { TokenStore, buildDefaultSettings } from "./auth/tokenStore";
import { GraphClient } from "./graph/graphClient";
import { DriveApi } from "./graph/driveApi";
import { SyncEngine } from "./sync/syncEngine";
import { StatusBar } from "./ui/statusBar";
import { OneDriveSyncSettingsTab } from "./ui/settingsTab";
import { exchangeCodeForTokens } from "./auth/oauth";

const PROTOCOL_HANDLER = "onedrive-sync";

export default class OneDriveSyncPlugin extends Plugin {
  settings!: OneDriveSyncSettings;
  tokenStore!: TokenStore;
  statusBar!: StatusBar;

  // Ephemeral OAuth state — not persisted
  pendingVerifier = "";
  pendingState = "";

  private syncEngine!: SyncEngine;
  private syncIntervalId: number | null = null;

  async onload(): Promise<void> {
    const saved = await this.loadData();
    this.settings = Object.assign(
      buildDefaultSettings(this.app.vault.getName()),
      DEFAULT_SETTINGS,
      saved ?? {}
    );

    this.tokenStore = new TokenStore(this);
    const graphClient = new GraphClient(this.tokenStore);
    const driveApi = new DriveApi(graphClient);
    this.statusBar = new StatusBar(this.addStatusBarItem());
    this.syncEngine = new SyncEngine(this.app.vault, driveApi, this.tokenStore, this.statusBar);

    this.addSettingTab(new OneDriveSyncSettingsTab(this.app, this));

    this.registerObsidianProtocolHandler(PROTOCOL_HANDLER, async (params) => {
      const { code, state, error, error_description } = params;

      if (error) {
        new Notice(`OneDrive auth failed: ${error_description ?? error}`);
        return;
      }

      if (!code) {
        new Notice("OneDrive auth failed: no code received.");
        return;
      }

      if (state !== this.pendingState) {
        new Notice("OneDrive auth failed: state mismatch. Please try again.");
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens(code, this.pendingVerifier, this.settings);
        await this.tokenStore.saveTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);
        new Notice("OneDrive connected successfully!");
        this.statusBar.setState("idle");
        this.restartSyncInterval();
        await this.syncEngine.run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`OneDrive auth error: ${msg}`);
      } finally {
        this.pendingVerifier = "";
        this.pendingState = "";
      }
    });

    this.addRibbonIcon("cloud", "Sync with OneDrive", async () => {
      if (!this.tokenStore.isConnected()) {
        new Notice("OneDrive Sync: not connected. Open Settings to sign in.");
        return;
      }
      await this.syncEngine.run();
    });

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: async () => {
        if (!this.tokenStore.isConnected()) {
          new Notice("OneDrive Sync: not connected. Open Settings to sign in.");
          return;
        }
        await this.syncEngine.run();
      },
    });

    if (this.tokenStore.isConnected()) {
      if (this.tokenStore.isExpired()) {
        this.statusBar.setState("auth_required");
        new Notice("OneDrive Sync: credentials expired. Please reconnect in Settings.");
      } else {
        this.statusBar.setState("idle");
        this.syncEngine.run();
        this.restartSyncInterval();
      }
    } else {
      this.statusBar.setState("auth_required");
    }
  }

  restartSyncInterval(): void {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }

    const minutes = this.settings.syncIntervalMinutes;
    if (minutes > 0 && this.tokenStore.isConnected()) {
      this.syncIntervalId = window.setInterval(
        () => this.syncEngine.run(),
        minutes * 60 * 1000
      );
      // Let Obsidian clean it up on unload too
      this.registerInterval(this.syncIntervalId);
    }
  }

  async onunload(): Promise<void> {
    // Intervals registered via registerInterval are cleaned up automatically
  }
}
