/** ADR-007: true inside the Mac app (the preload passes the OS); Windows wording otherwise. */
export function isMacDesktop(): boolean {
  return typeof window !== "undefined" && window.desktopAPI?.platform === "darwin";
}
