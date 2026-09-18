import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Character } from "./Character";

describe("Character", () => {
  it("references character.svg with a relative path, not an absolute one", () => {
    // Regression test: src="/character.svg" (absolute) resolves to the
    // filesystem root under file:// (how the packaged app loads its
    // pages), not next to index.html where the file actually is — the
    // same class of bug as the blank-window issue fixed via vite.config.ts's
    // base: "./", except Vite's base rewriting only covers asset paths it
    // generates itself (the built <script>/<link> tags); it can't rewrite
    // a hand-written src string like this one, so this needed its own fix.
    render(<Character />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "./character.svg");
  });
});
