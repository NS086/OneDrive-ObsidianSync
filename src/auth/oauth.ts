import { request } from "obsidian";
import type { OneDriveSyncSettings, TokenResponse } from "../types";
import { GraphError } from "../types";

const REDIRECT_URI = "obsidian://onedrive-sync";
const SCOPES = "Files.ReadWrite offline_access User.Read";

export function buildAuthUrl(
  settings: OneDriveSyncSettings,
  challenge: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: settings.clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    response_mode: "query",
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://login.microsoftonline.com/${settings.tenant}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  settings: OneDriveSyncSettings
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: settings.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    scope: SCOPES,
  });

  const raw = await request({
    url: `https://login.microsoftonline.com/${settings.tenant}/oauth2/v2.0/token`,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: body.toString(),
  });

  const resp: TokenResponse = JSON.parse(raw);
  if (resp.error) {
    throw new GraphError("token_exchange_failed", 400, resp.error_description ?? resp.error);
  }
  return resp;
}

export async function refreshAccessToken(
  settings: OneDriveSyncSettings
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: settings.clientId,
    grant_type: "refresh_token",
    refresh_token: settings.refreshToken,
    scope: SCOPES,
  });

  const raw = await request({
    url: `https://login.microsoftonline.com/${settings.tenant}/oauth2/v2.0/token`,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: body.toString(),
  });

  const resp: TokenResponse = JSON.parse(raw);
  if (resp.error) {
    throw new GraphError("refresh_failed", 401, resp.error_description ?? resp.error);
  }
  return resp;
}
