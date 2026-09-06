import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "./page";

describe("HomePage", () => {
  it("renders the title", () => {
    render(<HomePage />);
    expect(screen.getByText("AI Executive Agent")).toBeInTheDocument();
  });
});