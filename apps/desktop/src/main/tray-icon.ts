/**
 * A minimal 32x32 solid-color dot icon (app brand blue, #2563eb — the same
 * blue as the renderer's primary button) for the system tray (see
 * index.ts's Tray setup). Embedded as a data URL rather than a separate
 * image file so there's nothing for the build to copy into dist/ — no
 * project icon asset exists yet (see docs/WINDOWS_PACKAGING.md's "no
 * custom app icon" note), and this needs to work identically in dev and
 * packaged without its own asset pipeline.
 */
export const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAcUlEQVR4nO3WQRbAEAxF0WzGyiy/i2BOxA+RanEy9e7EAaXFiw4AQnyEmQLkNMg0AbwuGwygTcuMOzBTZw2yrdeGI2BVLwwU0J4FHVDX8S0XuIDTMR0YBvj+XWRlFMH/vWjDTKvz3rcFZLrbN/g67g5krpny8aKo8ikAAAAASUVORK5CYII=";

/**
 * ADR-007 rev 1: the macOS menu-bar icon — a black "Z" on a transparent
 * background, 16 px and 32 px (Retina). macOS draws template images from
 * the alpha channel only (black or white to match the menu bar); the
 * Windows dot above has no alpha channel, so on a Mac it showed as a blank
 * square.
 */
export const MAC_TRAY_ICON_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAYklEQVR42mNgGEzAAUg0EIkdsBkAkvhPJG6giQEKUKdhw/1Imu8zMDAYEBsuAmia10PFiAIgW85DNb5nYGAoICVGCqCa/kMNIcnJ65Gc3E+qk++jacYVqAqDMx1QnJQHBgAAkU5OwyMzUFoAAAAASUVORK5CYII=";
export const MAC_TRAY_ICON_2X_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAhUlEQVR42mNgGAWjYJCC/zTCow4YdQDRoIFM3I/H8vO0zjkBDAwM73FY3k9ry3H5/D3UYTQDBtCgxWb5fgYGBgFaWp6AJ8gbaGkxyFfrcVh8HxoqNA3y+zgsX0/rIG/Ak9ASaB3k+/HkbYPRvE0LcB5PkdpPQVE9WhuOOmDoOGAUjAK6AQAGqDvA1ihm/AAAAABJRU5ErkJggg==";
