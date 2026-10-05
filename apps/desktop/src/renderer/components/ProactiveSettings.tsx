import { useEffect, useState, type ReactNode } from "react";
import type { ProactiveSettingsDto } from "@ai-agent/shared";
import { isMacDesktop } from "../lib/platform";

type Settings = ProactiveSettingsDto;

function readResult(raw: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  if (raw && typeof raw === "object" && "ok" in raw) {
    const result = raw as { ok: unknown; value?: unknown; message?: unknown };
    if (result.ok === true) return { ok: true, value: result.value };
    if (typeof result.message === "string") return { ok: false, message: result.message };
  }
  return { ok: false, message: "Something went wrong. Please try again." };
}

function Toggle(props: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="settings-radio">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>
        {props.label}
        {props.hint && <span className="settings-hint"> — {props.hint}</span>}
      </span>
    </label>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="proactive-field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

/**
 * Settings → Proactive (ADR-006 M5): morning briefing, pre-meeting brief,
 * follow-ups, promise reminders, end-of-day wrap-up, holding pop-ups, quiet
 * hours. Each change saves straight away (stored in the local database).
 */
export function ProactiveSettings({ onShowBriefing }: { onShowBriefing?: ((briefing: unknown) => void) | undefined }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<"morning" | "wrap_up" | null>(null);

  useEffect(() => {
    let active = true;
    void (window.desktopAPI?.proactiveGetSettings?.() ?? Promise.resolve(null))
      .catch(() => null)
      .then((raw) => {
        if (!active) return;
        const result = readResult(raw);
        if (result.ok) setSettings(result.value as Settings);
        else setError(result.message);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async (patch: Partial<Settings>) => {
    setError(null);
    const previous = settings;
    // Functional update: quick successive changes mustn't overwrite each other.
    setSettings((current) => (current ? { ...current, ...patch } : current));
    const result = readResult(await (window.desktopAPI?.proactiveUpdateSettings?.(patch) ?? Promise.resolve(null)).catch(() => null));
    if (!result.ok) {
      setError(result.message);
      // Undo just this change.
      setSettings((current) =>
        current && previous
          ? { ...current, ...Object.fromEntries(Object.keys(patch).map((key) => [key, previous[key as keyof Settings]])) }
          : current,
      );
    }
  };

  const showNow = async (kind: "morning" | "wrap_up") => {
    setPreparing(kind);
    setError(null);
    const result = readResult(await (window.desktopAPI?.proactiveBriefingNow?.(kind) ?? Promise.resolve(null)).catch(() => null));
    setPreparing(null);
    if (result.ok) onShowBriefing?.(result.value);
    else setError(result.message);
  };

  if (!settings) {
    return (
      <div data-testid="proactive-settings">
        {error ? <div className="card-error" role="alert">{error}</div> : <div className="settings-hint">Loading…</div>}
      </div>
    );
  }

  const timeInput = (key: "wrapUpTime" | "promiseRemindTime" | "quietHoursStart" | "quietHoursEnd", label: string) => (
    <input
      type="time"
      aria-label={label}
      className="settings-input proactive-time"
      value={settings[key]}
      onChange={(e) => e.target.value && void save({ [key]: e.target.value })}
    />
  );

  return (
    <div data-testid="proactive-settings">
      {error && (
        <div className="card-error" role="alert">
          {error}
        </div>
      )}

      <div className="settings-section">
        <div className="settings-label">Morning briefing</div>
        <Toggle
          label="Brief me when I first sit down each day"
          hint="after 5 am, when you unlock or start using the PC"
          checked={settings.briefingEnabled}
          onChange={(value) => void save({ briefingEnabled: value })}
        />
        <Toggle
          label="Weekdays only"
          checked={settings.briefingWeekdaysOnly}
          onChange={(value) => void save({ briefingWeekdaysOnly: value })}
        />
        <Field label="Briefings are">
          <select
            aria-label="Briefing style"
            className="settings-input"
            value={settings.briefingMode}
            onChange={(e) => void save({ briefingMode: e.target.value as Settings["briefingMode"] })}
          >
            <option value="written">Written</option>
            <option value="spoken">Spoken</option>
            <option value="both">Written and spoken</option>
          </select>
        </Field>
        <button
          type="button"
          className="button button-snooze"
          disabled={preparing !== null}
          onClick={() => void showNow("morning")}
        >
          {preparing === "morning" ? "Preparing…" : "Show today's briefing now"}
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-label">End-of-day wrap-up</div>
        <Toggle label="Wrap up my day" checked={settings.wrapUpEnabled} onChange={(value) => void save({ wrapUpEnabled: value })} />
        <Field label="At">{timeInput("wrapUpTime", "Wrap-up time")}</Field>
        <button
          type="button"
          className="button button-snooze"
          disabled={preparing !== null}
          onClick={() => void showNow("wrap_up")}
        >
          {preparing === "wrap_up" ? "Preparing…" : "Show wrap-up now"}
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-label">Meetings</div>
        <Toggle
          label="Add a brief to the 10-minute meeting alert"
          hint="who's coming, recent emails with them, open items"
          checked={settings.preMeetingBriefEnabled}
          onChange={(value) => void save({ preMeetingBriefEnabled: value })}
        />
      </div>

      <div className="settings-section">
        <div className="settings-label">Sent email</div>
        <div className="settings-hint">
          Zara reads your last 14 days of sent mail (your own text, trimmed). Each new email is checked once by OpenAI, with
          passwords, card and ID numbers masked.
        </div>
        <Toggle
          label="Nudge me when nobody replied"
          checked={settings.followUpEnabled}
          onChange={(value) => void save({ followUpEnabled: value })}
        />
        <Field label="After (days)">
          <input
            type="number"
            aria-label="Follow-up after days"
            className="settings-input proactive-number"
            min={1}
            max={14}
            value={settings.followUpDays}
            onChange={(e) => {
              const value = Math.round(Number(e.target.value));
              if (value >= 1 && value <= 14) void save({ followUpDays: value });
            }}
          />
        </Field>
        <Toggle
          label="Remind me of promises I made"
          hint={`"I'll send it by Friday"`}
          checked={settings.promiseRemindersEnabled}
          onChange={(value) => void save({ promiseRemindersEnabled: value })}
        />
        <Field label="The day before at">{timeInput("promiseRemindTime", "Promise reminder time")}</Field>
        <Field label="If due today, hours before">
          <input
            type="number"
            aria-label="Hours before when due today"
            className="settings-input proactive-number"
            min={1}
            max={12}
            value={settings.promiseSameDayLeadHours}
            onChange={(e) => {
              const value = Math.round(Number(e.target.value));
              if (value >= 1 && value <= 12) void save({ promiseSameDayLeadHours: value });
            }}
          />
        </Field>
      </div>

      <div className="settings-section">
        <div className="settings-label">Don't disturb</div>
        <Toggle
          label="Hold pop-ups while I present, am full-screen, or on a call"
          hint="the dock shows how many are waiting; meetings about to start still get a quiet line"
          checked={settings.holdDuringFocus}
          onChange={(value) => void save({ holdDuringFocus: value })}
        />
        {isMacDesktop() && (
          <div className="settings-hint" data-testid="mac-focus-note">
            On a Mac, Zara can't tell yet when you're presenting or on a call, so pop-ups always show. Quiet hours still work.
          </div>
        )}
        <Toggle
          label="Quiet hours"
          checked={settings.quietHoursEnabled}
          onChange={(value) => void save({ quietHoursEnabled: value })}
        />
        {settings.quietHoursEnabled && (
          <div className="proactive-range">
            <Field label="From">{timeInput("quietHoursStart", "Quiet hours start")}</Field>
            <Field label="to">{timeInput("quietHoursEnd", "Quiet hours end")}</Field>
          </div>
        )}
      </div>
    </div>
  );
}
