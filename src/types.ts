export interface OneDriveSyncSettings {
  clientId: string;
  tenant: string;
  syncFolder: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
  credentialsShouldBeDeletedAtTime: number;
  deltaLink: string;
  lastSyncTime: number;
  fileIndex: Record<string, string>;
  syncIntervalMinutes: number;
}

export const DEFAULT_SETTINGS: OneDriveSyncSettings = {
  clientId: "",
  tenant: "common",
  syncFolder: "",
  accessToken: "",
  refreshToken: "",
  tokenExpiry: 0,
  credentialsShouldBeDeletedAtTime: 0,
  deltaLink: "",
  lastSyncTime: 0,
  fileIndex: {},
  syncIntervalMinutes: 60,
};

export interface DriveItem {
  id: string;
  name: string;
  eTag?: string;
  lastModifiedDateTime: string;
  size?: number;
  file?: object;
  folder?: object;
  deleted?: { state: string };
  parentReference?: { id: string; driveId: string; path: string };
  "@microsoft.graph.downloadUrl"?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

export type SyncState = "idle" | "syncing" | "error" | "auth_required";

export class GraphError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message?: string
  ) {
    super(message ?? `Graph error ${code} (HTTP ${status})`);
    this.name = "GraphError";
  }
}
