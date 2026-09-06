interface DesktopApiBridge {
  fetchInbox(): Promise<unknown>;
  markDone(interventionId: string): Promise<unknown>;
  snooze(interventionId: string, minutes: number): Promise<unknown>;
  setInteractive(interactive: boolean): void;
}

declare global {
  interface Window {
    desktopAPI?: DesktopApiBridge;
  }
}

export {};
