import { request } from "obsidian";
import { refreshAccessToken } from "../auth/oauth";
import { GraphError, type OneDriveSyncSettings } from "../types";
import type { TokenStore } from "../auth/tokenStore";

const BASE = "https://graph.microsoft.com/v1.0";
const REFRESH_BUFFER_MS = 2 * 60 * 1000;

export class GraphClient {
  constructor(private tokenStore: TokenStore) {}

  private async getToken(): Promise<string> {
    const s = this.tokenStore.get();

    if (this.tokenStore.isExpired()) {
      throw new GraphError("credentials_expired", 401, "Credentials are over 80 days old. Please reconnect.");
    }

    if (s.tokenExpiry - Date.now() < REFRESH_BUFFER_MS) {
      const resp = await refreshAccessToken(s);
      await this.tokenStore.saveTokens(resp.access_token, resp.refresh_token, resp.expires_in);
      return resp.access_token;
    }

    return s.accessToken;
  }

  private buildUrl(pathFrag: string): string {
    if (pathFrag.startsWith("https://")) return pathFrag;
    return BASE + pathFrag;
  }

  async getJson<T>(pathFrag: string): Promise<T> {
    const token = await this.getToken();
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      const raw = await request({
        url: this.buildUrl(pathFrag),
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-cache",
        },
      });
      return JSON.parse(raw) as T;
    }
    throw new GraphError("max_retries", 500, "Max retries exceeded");
  }

  async postJson<T>(pathFrag: string, body: unknown): Promise<T> {
    const token = await this.getToken();
    const raw = await request({
      url: this.buildUrl(pathFrag),
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}` },
    });
    return JSON.parse(raw) as T;
  }

  async putJson<T>(pathFrag: string, body: unknown): Promise<T> {
    const token = await this.getToken();
    const raw = await request({
      url: this.buildUrl(pathFrag),
      method: "PUT",
      contentType: "application/json",
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}` },
    });
    return JSON.parse(raw) as T;
  }

  async deleteItem(pathFrag: string): Promise<void> {
    const token = await this.getToken();
    await fetch(this.buildUrl(pathFrag), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async uploadBinary(pathFrag: string, data: ArrayBuffer, contentType = "application/octet-stream"): Promise<unknown> {
    const token = await this.getToken();
    const resp = await fetch(this.buildUrl(pathFrag), {
      method: "PUT",
      body: data,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
      },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new GraphError("upload_failed", resp.status, text);
    }
    return resp.json();
  }

  async downloadBinary(url: string): Promise<ArrayBuffer> {
    // Use native fetch for binary — Obsidian requestUrl corrupts binary on mobile
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) {
      throw new GraphError("download_failed", resp.status);
    }
    return resp.arrayBuffer();
  }

  async createUploadSession(pathFrag: string): Promise<string> {
    const result = await this.postJson<{ uploadUrl: string }>(pathFrag, {
      item: { "@microsoft.graph.conflictBehavior": "replace" },
    });
    return result.uploadUrl;
  }

  async uploadChunked(uploadUrl: string, data: ArrayBuffer): Promise<unknown> {
    const CHUNK_SIZE = 6 * 1024 * 1024; // 6 MiB (must be multiple of 320 KiB)
    const total = data.byteLength;
    let offset = 0;
    let lastResult: unknown = null;

    while (offset < total) {
      const end = Math.min(offset + CHUNK_SIZE, total);
      const chunk = data.slice(offset, end);

      const resp = await fetch(uploadUrl, {
        method: "PUT",
        body: chunk,
        headers: {
          "Content-Length": String(end - offset),
          "Content-Range": `bytes ${offset}-${end - 1}/${total}`,
        },
      });

      if (!resp.ok && resp.status !== 202) {
        const text = await resp.text();
        throw new GraphError("chunk_upload_failed", resp.status, text);
      }

      if (resp.status === 201 || resp.status === 200) {
        lastResult = await resp.json();
      }

      offset = end;
    }

    return lastResult;
  }
}
