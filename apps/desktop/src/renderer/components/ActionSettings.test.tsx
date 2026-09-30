import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionSettings } from "./ActionSettings";

afterEach(() => {
  delete (window as { desktopAPI?: unknown }).desktopAPI;
});

describe("Settings → Actions (ADR-006 M7)", () => {
  it("asks to reconnect Google when send/calendar permission is missing, and saves the writing style", async () => {
    const bridge = {
      actionsGetSettings: vi.fn().mockResolvedValue({
        ok: true,
        value: { writingStyle: "", permissions: { connected: true, sendEmail: false, editCalendar: false, readDrive: false } },
      }),
      actionsUpdateSettings: vi.fn(async (writingStyle: string) => ({
        ok: true,
        value: { writingStyle, permissions: { connected: true, sendEmail: false, editCalendar: false, readDrive: false } },
      })),
      connectGoogle: vi.fn().mockResolvedValue(undefined),
    };
    window.desktopAPI = bridge as unknown as NonNullable<Window["desktopAPI"]>;
    render(<ActionSettings />);

    expect(await screen.findByRole("status")).toHaveTextContent("send email or change your calendar");
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Google to allow it" }));
    expect(bridge.connectGoogle).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Your writing style"), { target: { value: "Short and warm. Cheers, Shubham" } });
    fireEvent.click(screen.getByRole("button", { name: "Save style" }));
    await waitFor(() => expect(bridge.actionsUpdateSettings).toHaveBeenCalledWith("Short and warm. Cheers, Shubham"));
  });

  it("shows when everything is allowed", async () => {
    window.desktopAPI = {
      actionsGetSettings: vi.fn().mockResolvedValue({
        ok: true,
        value: { writingStyle: "x", permissions: { connected: true, sendEmail: true, editCalendar: true, readDrive: true } },
      }),
    } as unknown as NonNullable<Window["desktopAPI"]>;
    render(<ActionSettings />);
    expect(await screen.findByText(/Allowed ✓/)).toBeInTheDocument();
  });
});
