export function Character() {
  return (
    // Relative, not "/character.svg": Vite's base:"./" fix (see
    // vite.config.ts) only rewrites asset paths Vite itself generates for
    // the built <script>/<link> tags — it can't rewrite a hand-written
    // string literal like this one, since nothing marks it as an asset
    // reference for Vite's pipeline to see. An absolute path here would
    // still resolve to the filesystem root under file://, exactly the
    // same class of bug as the blank-window issue, just in a spot the
    // earlier fix couldn't reach.
    <img
      className="character"
      src="./character.svg"
      alt="Assistant character"
    />
  );
}