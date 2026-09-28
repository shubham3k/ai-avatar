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
