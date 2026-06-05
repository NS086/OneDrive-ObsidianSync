import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type OneDriveSyncPlugin from "../main";
import { buildAuthUrl } from "../auth/oauth";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "../auth/pkce";

export class OneDriveSyncSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: OneDriveSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("onedrive-sync-settings");

    containerEl.createEl("h2", { text: "OneDrive Sync" });

    // ── App Registration ──────────────────────────────────────────────
    containerEl.createEl("h3", { text: "App Registration" });

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("Application (client) ID from your Entra App Registration.")
      .addText((text) =>
        text
          .setPlaceholder("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
          .setValue(this.plugin.settings.clientId)
          .onChange(async (value) => {
            this.plugin.settings.clientId = value.trim();
            await this.plugin.saveData(this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName("Tenant")
      .setDesc(
        'Use "common" for both personal and work accounts, "consumers" for personal only, or a specific tenant GUID for a single organisation.'
      )
      .addText((text) =>
        text
          .setPlaceholder("common")
          .setValue(this.plugin.settings.tenant)
          .onChange(async (value) => {
            this.plugin.settings.tenant = value.trim() || "common";
            await this.plugin.saveData(this.plugin.settings);
          })
      );

    // ── Sync Folder ───────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Sync" });

    new Setting(containerEl)
      .setName("OneDrive folder")
      .setDesc("Path in OneDrive where the vault will be synced (e.g. Obsidian/MyVault).")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.syncFolder)
          .onChange(async (value) => {
            this.plugin.settings.syncFolder = value.trim();
            await this.plugin.saveData(this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName("Auto-sync interval")
      .setDesc("How often to automatically sync while Obsidian is open. Set to 0 to disable auto-sync.")
      .addDropdown((drop) =>
        drop
          .addOption("0", "Manual only")
          .addOption("5", "Every 5 minutes")
          .addOption("15", "Every 15 minutes")
          .addOption("30", "Every 30 minutes")
          .addOption("60", "Every hour")
          .addOption("120", "Every 2 hours")
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            this.plugin.settings.syncIntervalMinutes = parseInt(value);
            await this.plugin.saveData(this.plugin.settings);
            this.plugin.restartSyncInterval();
          })
      );

    // ── Account ───────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Account" });

    const connected = this.plugin.tokenStore.isConnected();

    if (connected) {
      new Setting(containerEl)
        .setName("Status")
        .setDesc(
          this.plugin.tokenStore.isExpired()
            ? "⚠ Credentials expired (>80 days). Please reconnect."
            : `Connected. Last sync: ${this.plugin.settings.lastSyncTime ? new Date(this.plugin.settings.lastSyncTime).toLocaleString() : "never"}`
        )
        .addButton((btn) =>
          btn
            .setButtonText("Disconnect")
            .setWarning()
            .onClick(async () => {
              await this.plugin.tokenStore.clearTokens();
              this.plugin.statusBar.setState("auth_required");
              new Notice("Disconnected from OneDrive.");
              this.display();
            })
        );
    } else {
      new Setting(containerEl)
        .setName("Status")
        .setDesc("Not connected.")
        .addButton((btn) =>
          btn.setButtonText("Connect to OneDrive").setCta().onClick(async () => {
            const { clientId } = this.plugin.settings;
            if (!clientId) {
              new Notice("Please enter a Client ID first.");
              return;
            }
            const verifier = generateCodeVerifier();
            const challenge = await generateCodeChallenge(verifier);
            const state = generateState();
            this.plugin.pendingVerifier = verifier;
            this.plugin.pendingState = state;
            const url = buildAuthUrl(this.plugin.settings, challenge, state);
            window.open(url);
            new Notice("Complete sign-in in your browser. You'll be redirected back automatically.");
          })
        );
    }
  }
}
