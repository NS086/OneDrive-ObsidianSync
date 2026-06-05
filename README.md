# Obsidian OneDrive Sync

A personal-use Obsidian plugin that bidirectionally syncs your vault to Microsoft OneDrive via the Microsoft Graph API. Works on desktop and iOS.

> **Note:** I built this for my own use. It is not published to the Obsidian community plugin registry and comes with no warranty or official support. You are welcome to use and adapt the code freely — no conditions, no attribution required.

---

## Features

- Sync to OneDrive personal (Microsoft account) or OneDrive for Business (Entra ID / work account)
- Bidirectional sync — changes on either side are picked up
- Conflict handling — if the same file is edited on both sides, both versions are kept with a timestamp suffix
- Configurable auto-sync interval (5 min → 2 hours, or manual only)
- Works on iOS (tested via iCloud vault transfer)
- No third-party auth libraries — uses OAuth 2.0 PKCE with raw HTTP calls, compatible with Obsidian's mobile runtime

---

## Setup

### 1. Create an Entra App Registration

In the [Azure portal](https://portal.azure.com) → App registrations → New registration:

- **Supported account types:** Accounts in any organizational directory and personal Microsoft accounts
- **Platform:** Mobile and desktop application
- **Redirect URI:** `obsidian://onedrive-sync`

Under **Authentication**, enable **Allow public client flows**.

Under **API permissions**, add these delegated permissions:
- `Files.ReadWrite`
- `offline_access`
- `User.Read`

Copy the **Application (client) ID** — you will need it in the plugin settings.

> No client secret is needed. The plugin uses PKCE so no credentials are ever stored in the code.

### 2. Install the plugin

Copy these three files into your vault at `.obsidian/plugins/onedrive-sync/`:

```
main.js
manifest.json
styles.css
```

In Obsidian: Settings → Community plugins → disable Restricted mode → enable **OneDrive Sync**.

**On iOS:** the easiest path is to place the files via iCloud for Windows (if your vault is in iCloud) or the iOS Files app under On My iPhone → Obsidian.

### 3. Connect

Settings → OneDrive Sync:

1. Enter your **Client ID**
2. Set **Tenant** — use `common` for both personal and work accounts, `consumers` for personal only, or a specific tenant GUID to lock to one organisation
3. Set the **OneDrive folder** path (default: `Obsidian/<vault name>`)
4. Click **Connect to OneDrive** — your browser opens for sign-in and redirects back automatically

---

## Building from source

Requires Node.js 18+.

```sh
git clone https://github.com/NS086/OneDrive-ObsidianSync
cd obsidian-onedrive-sync
npm install
npm run build   # produces main.js
```

For development with live rebuild:

```sh
npm run dev
```

---

## How it works

Authentication uses **OAuth 2.0 Authorization Code flow with PKCE** — no client secret required. The plugin generates a code verifier/challenge via `crypto.subtle`, opens the Microsoft login page in your browser, and intercepts the callback via Obsidian's `obsidian://` URI scheme handler. Tokens are stored in the vault's `data.json`.

Sync uses the **Microsoft Graph delta API** (`/me/drive/root:/{folder}:/delta`) for efficient incremental updates — only changed files are transferred after the first run. The delta token is persisted between sessions.

On iOS, all JSON API calls use Obsidian's `request()` wrapper and binary file transfers use the native `fetch()` API directly — this split is required because Obsidian's `requestUrl` corrupts binary data on mobile.

---

## Licence

This project is released into the public domain under [The Unlicense](LICENSE). Do whatever you want with it.
