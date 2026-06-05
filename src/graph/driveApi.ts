import type { GraphClient } from "./graphClient";
import type { DriveItem } from "../types";

const SMALL_FILE_LIMIT = 4 * 1024 * 1024; // 4 MiB

interface DeltaResult {
  items: DriveItem[];
  deltaLink: string;
}

interface DriveInfo {
  id: string;
}

export class DriveApi {
  private driveId: string | null = null;

  constructor(private client: GraphClient) {}

  async getDriveId(): Promise<string> {
    if (this.driveId) return this.driveId;
    const resp = await this.client.getJson<DriveInfo>("/me/drive");
    this.driveId = resp.id;
    return resp.id;
  }

  async ensureSyncFolder(syncFolder: string): Promise<void> {
    // PUT with conflictBehavior=fail creates folder only if absent; 409 = already exists
    const parts = syncFolder.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      try {
        await this.client.putJson(`/me/drive/root:/${current}:`, {
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail",
        });
      } catch {
        // folder already exists — ignore
      }
    }
  }

  async delta(syncFolder: string, deltaLink?: string): Promise<DeltaResult> {
    const initialUrl = deltaLink && deltaLink.startsWith("https://")
      ? deltaLink
      : `/me/drive/root:/${syncFolder}:/delta`;

    const items: DriveItem[] = [];
    let url: string = initialUrl;

    while (true) {
      const resp = await this.client.getJson<{
        value: DriveItem[];
        "@odata.nextLink"?: string;
        "@odata.deltaLink"?: string;
      }>(url);

      items.push(...(resp.value ?? []));

      if (resp["@odata.nextLink"]) {
        url = resp["@odata.nextLink"];
      } else if (resp["@odata.deltaLink"]) {
        return { items, deltaLink: resp["@odata.deltaLink"] };
      } else {
        break;
      }
    }

    return { items, deltaLink: "" };
  }

  async uploadFile(syncFolder: string, relativePath: string, data: ArrayBuffer): Promise<DriveItem> {
    const remotePath = `${syncFolder}/${relativePath}`;
    const encodedPath = remotePath.split("/").map(encodeURIComponent).join("/");

    if (data.byteLength <= SMALL_FILE_LIMIT) {
      return this.client.uploadBinary(
        `/me/drive/root:/${encodedPath}:/content`,
        data
      ) as Promise<DriveItem>;
    }

    // Large file: use upload session
    const uploadUrl = await this.client.createUploadSession(
      `/me/drive/root:/${encodedPath}:/createUploadSession`
    );
    return this.client.uploadChunked(uploadUrl, data) as Promise<DriveItem>;
  }

  async downloadFile(item: DriveItem): Promise<ArrayBuffer> {
    const downloadUrl = item["@microsoft.graph.downloadUrl"];
    if (downloadUrl) {
      return this.client.downloadBinary(downloadUrl);
    }
    // Fallback: get a fresh download URL via content endpoint
    const refreshed = await this.client.getJson<DriveItem>(`/me/drive/items/${item.id}?$select=@microsoft.graph.downloadUrl`);
    if (refreshed["@microsoft.graph.downloadUrl"]) {
      return this.client.downloadBinary(refreshed["@microsoft.graph.downloadUrl"]);
    }
    // Last resort: direct content endpoint (will follow redirect)
    return this.client.downloadBinary(`https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/content`);
  }

  async deleteFile(itemId: string): Promise<void> {
    await this.client.deleteItem(`/me/drive/items/${itemId}`);
  }
}
