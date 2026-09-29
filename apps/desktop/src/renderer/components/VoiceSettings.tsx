import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DEFAULT_OPENAI_TTS_VOICE, OPENAI_TTS_VOICES } from "@ai-agent/shared";
import {
  getVoicePreferences,
  setVoicePreferences,
  type VoiceEngine,
  type VoiceInputMode,
  type VoicePreferences,
} from "../lib/preferences";
import { createBrowserSpeechOutput, listLocalVoices } from "../lib/speech-output";
import { createSpeaker, type Speaker } from "../lib/speech-player";

/** English + Hinglish, so the preview shows how she handles both. */
export const VOICE_PREVIEW_TEXT = "Hi, I'm Zara. Aaj aapka din kaisa chal raha hai?";

const ENGINE_OPTIONS: { id: VoiceEngine; label: string; hint: string }[] = [
  { id: "openai", label: "OpenAI voice", hint: "Most natural; a fraction of a cent per reply." },
  { id: "windows", label: "Windows voice", hint: "Free and offline; sounds more robotic." },
  { id: "off", label: "Off", hint: "Zara only writes." },
];

const INPUT_OPTIONS: { id: VoiceInputMode; label: string; hint: string }[] = [
  { id: "click", label: "Click to talk", hint: "Click 🎤 (or press the shortcut) to start, again to send." },
  {
    id: "handsfree",
    label: "Hands-free",
    hint: "After you start, just talk — a pause sends it. The mic stays on while the chat is open (stops after a quiet minute).",
  },
];

const KEY_NAMES: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Backspace: "Backspace",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

/** A key press → Electron accelerator ("Ctrl+Shift+Space"), or null while only modifiers are held. */
export function acceleratorFromKeyEvent(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey">): string | null {
  const { code } = event;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else key = KEY_NAMES[code] ?? null;
  if (!key) return null;
  const parts = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean);
  return [...parts, key].join("+");
}

function readHotkeyResult(raw: unknown): { ok: true; accelerator: string } | { ok: false; message: string } {
  if (raw && typeof raw === "object") {
    const result = raw as { ok?: unknown; accelerator?: unknown; message?: unknown };
    if (result.ok === true && typeof result.accelerator === "string") return { ok: true, accelerator: result.accelerator };
    if (typeof result.message === "string") return { ok: false, message: result.message };
  }
  return { ok: false, message: "Couldn't change the shortcut." };
}

/**
 * Settings → Voice (ADR-006 M4): the global shortcut, how Zara speaks
 * (OpenAI / Windows / off) with a voice picker and preview, and how she
 * listens (click-to-talk or hands-free).
 */
export function VoiceSettings() {
  const [prefs, setPrefs] = useState<VoicePreferences>(() => getVoicePreferences());
  const [localVoices, setLocalVoices] = useState<{ name: string; lang: string }[]>([]);
  const [hotkey, setHotkey] = useState<string | null>(null);
  const [hotkeyMessage, setHotkeyMessage] = useState<string | null>(null);
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const speakerRef = useRef<Speaker | null>(null);

  useEffect(() => {
    let active = true;
    void listLocalVoices().then((voices) => {
      if (active) setLocalVoices(voices.map((voice) => ({ name: voice.name, lang: voice.lang })));
    });
    void window.desktopAPI
      ?.getSettings()
      .then((raw) => {
        const value = raw && typeof raw === "object" ? (raw as { chatHotkey?: unknown }).chatHotkey : null;
        if (active) setHotkey(typeof value === "string" ? value : null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      speakerRef.current?.stop();
    };
  }, []);

  const update = (patch: Partial<VoicePreferences>) => setPrefs(setVoicePreferences(patch));

  const preview = () => {
    speakerRef.current?.stop();
    setPreviewNotice(null);
    const speaker = createSpeaker({
      output: createBrowserSpeechOutput(async (text, voice) => {
        const raw = await window.desktopAPI?.chatSpeak?.(text, voice);
        const result = raw as { ok?: unknown; value?: unknown; message?: unknown } | undefined;
        if (result?.ok === true && typeof result.value === "string") return result.value;
        throw new Error(typeof result?.message === "string" ? result.message : "Zara's OpenAI voice isn't available.");
      }),
      getSettings: () => prefs,
      onSpeakingChange: setPreviewing,
      onNotice: setPreviewNotice,
    });
    speakerRef.current = speaker;
    speaker.say(VOICE_PREVIEW_TEXT);
  };

  const captureHotkey = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    const accelerator = acceleratorFromKeyEvent(event);
    if (!accelerator) return;
    const save = window.desktopAPI?.saveChatHotkey;
    if (!save) return;
    const result = readHotkeyResult(await save(accelerator).catch(() => null));
    if (result.ok) {
      setHotkey(result.accelerator);
      setHotkeyMessage(`Saved — press ${result.accelerator} anywhere to open Zara.`);
    } else {
      setHotkeyMessage(result.message);
    }
  };

  return (
    <div data-testid="voice-settings">
      <div className="settings-section">
        <label className="settings-label" htmlFor="zara-hotkey">
          Shortcut to open Zara
        </label>
        <div className="settings-hint">
          Works from any app. Press it once to open the chat, again to start talking. Click the box and press a new
          combination to change it (needs Ctrl or Alt).
        </div>
        <input
          id="zara-hotkey"
          className="settings-input"
          readOnly
          value={hotkey ?? "Not set — another app may be using it"}
          onKeyDown={(e) => void captureHotkey(e)}
        />
        {hotkeyMessage && <div className="settings-hint" role="status">{hotkeyMessage}</div>}
      </div>

      <div className="settings-section" role="radiogroup" aria-label="Zara's voice">
        <div className="settings-label">Zara's voice</div>
        <div className="settings-hint">She speaks when you speak to her; typed messages get written replies.</div>
        {ENGINE_OPTIONS.map((option) => (
          <label key={option.id} className="settings-radio">
            <input
              type="radio"
              name="voice-engine"
              checked={prefs.engine === option.id}
              onChange={() => update({ engine: option.id })}
            />
            <span>
              {option.label} <span className="settings-hint">— {option.hint}</span>
            </span>
          </label>
        ))}

        {prefs.engine === "openai" && (
          <>
            <label className="settings-sublabel" htmlFor="openai-voice">
              OpenAI voice
            </label>
            <select
              id="openai-voice"
              className="settings-input"
              value={prefs.openaiVoice}
              onChange={(e) => update({ openaiVoice: e.target.value })}
            >
              {OPENAI_TTS_VOICES.map((voice) => (
                <option key={voice} value={voice}>
                  {voice}
                  {voice === DEFAULT_OPENAI_TTS_VOICE ? " (default)" : ""}
                </option>
              ))}
            </select>
          </>
        )}

        {prefs.engine !== "off" && (
          <>
            <label className="settings-sublabel" htmlFor="windows-voice">
              {prefs.engine === "windows" ? "Windows voice" : "Windows voice (used if OpenAI's isn't available)"}
            </label>
            <select
              id="windows-voice"
              className="settings-input"
              value={prefs.windowsVoice ?? ""}
              onChange={(e) => update({ windowsVoice: e.target.value || null })}
            >
              <option value="">System default</option>
              {localVoices.map((voice) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button button-snooze"
              onClick={previewing ? () => speakerRef.current?.stop() : preview}
            >
              {previewing ? "■ Stop" : "▶ Preview"}
            </button>
            {previewNotice && <div className="settings-hint" role="status">{previewNotice}</div>}
          </>
        )}
      </div>

      <div className="settings-section" role="radiogroup" aria-label="Talking to Zara">
        <div className="settings-label">Talking to Zara</div>
        {INPUT_OPTIONS.map((option) => (
          <label key={option.id} className="settings-radio">
            <input
              type="radio"
              name="voice-input"
              checked={prefs.inputMode === option.id}
              onChange={() => update({ inputMode: option.id })}
            />
            <span>
              {option.label} <span className="settings-hint">— {option.hint}</span>
            </span>
          </label>
        ))}
        <div className="settings-hint">
          Speak English, Hindi, or Hinglish — Zara answers the same way. Typing, clicking 🎤, or talking over her stops
          her speaking. With speakers instead of headphones, hands-free may sometimes hear Zara herself.
        </div>
      </div>
    </div>
  );
}
