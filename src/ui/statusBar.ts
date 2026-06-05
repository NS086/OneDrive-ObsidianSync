import type { SyncState } from "../types";

export class StatusBar {
  constructor(private el: HTMLElement) {}

  setState(state: SyncState, detail?: string): void {
    switch (state) {
      case "idle":
        this.el.setText("OneDrive ✓");
        break;
      case "syncing":
        this.el.setText("OneDrive ↻");
        break;
      case "error":
        this.el.setText(`OneDrive ✗${detail ? `: ${detail.slice(0, 40)}` : ""}`);
        break;
      case "auth_required":
        this.el.setText("OneDrive: sign in required");
        break;
    }
  }
}
