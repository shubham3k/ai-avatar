# Onboarding Redesign, Manual "Check Now", and Real-Google-OAuth Fixes

This session's work grew out of Phase 4.7 clean-install testing into a real
feature pass, once the user's own hands-on testing (the whole point of
Phase 4.7) surfaced that the app was fundamentally unusable end-to-end, not
just "needs a clean machine to validate." Everything below was found and
fixed through **actual use** — a human clicking through the real packaged
app — not through code review or automated tests, which is exactly why
none of it had surfaced in four prior phases of "real, non-mocked"
verification done by the agent alone.

**As of this write-up: the full cycle works, verified by the user with
their own real Google account** — install → enter Groq key → connect
Google → click "Check now" → a real calendar-based intervention appears
with the character, correct priority, and working action buttons. See the
"Real end-to-end verification" section at the bottom.

## Why this became more than a bug-fix pass

Phase 4.7's original scope was "confirm the already-built app installs
cleanly." The first real click-through immediately showed the app was not
actually usable — not because of packaging, but because:
- The window was invisible.
- Once visible, it wasn't clickable.
- Once clickable, it had no way to configure Google OAuth at all.
- Once that was added, the database was silently broken.
- Once that was fixed, the character image didn't load.

Each fix unblocked the next problem — a real, if slow, path to a genuinely
working app. This doc covers all of it together since the fixes are
interdependent and were verified together.

## Bug 5 (continuing Phase 4.7's numbering): the overlay was click-through in every state except one

`overlay-window.ts` makes the window click-through by default
(`setIgnoreMouseEvents(true)`) so it doesn't block clicks to the desktop
behind it while idle. The renderer was supposed to turn that off whenever
there's something to click — but the only place that ever happened was:

```js
window.desktopAPI?.setInteractive(intervention !== null);
```

Every other screen — Settings, the new get-started screen, the "all caught
up" screen — was never covered. This bug technically predates this
session (even the original gear-icon Settings panel had it), but it never
surfaced before because test databases usually had a leftover demo
intervention that made the window incidentally clickable. On a genuinely
fresh database, nothing was clickable at all — not silently broken-looking,
genuinely inert. Only caught because the user reported "button is not
clickable."

**Fix**: `App.tsx` now calls `setInteractive(true)` once on mount,
unconditionally — every screen this component renders now has real
clickable content (at minimum the settings gear icon), so there's no
state where click-through is still the right default. See
`App.tsx`'s comment above the effect.

**Regression tests**: `App.test.tsx`'s new "window interactivity" describe
block asserts `setInteractive(true)` fires on both the get-started and
all-caught-up screens.

## Bug 6: `DATABASE_URL` was never actually set for the packaged app's own process

Once the window was clickable, the very next thing tried (adding
`ensureDemoUser`, see below) threw:

```
Invalid `prisma.user.upsert()` invocation: error: Environment variable not found: DATABASE_URL.
```

Root cause: Phase 4.5's migration step (`migrate.ts`) always set
`DATABASE_URL` explicitly, but only for the **child process** it spawns to
run `prisma migrate deploy` — nothing ever set it on the **main Electron
process itself**, which is what the embedded (in-process) API server
actually uses to build its Prisma Client. This went unnoticed through
every earlier phase because nothing the embedded server did at startup
ever touched Prisma — `GET /health` doesn't query the database. The first
thing that did (see Bug 5.5/demo-user bootstrap below) failed immediately.

**Fix**: `index.ts` now sets `process.env.DATABASE_URL` explicitly before
migrations or the embedded server start, but only when packaged and only
if nothing already set it — dev keeps using whatever `.env` already
provides unchanged (a relative path resolved against `apps/api/prisma/`,
the real dev database with real synced data; this was deliberately never
touched). Packaged gets an **absolute** path into `app.getPath("userData")`
— not inside the install directory, which has its own permission/update/
uninstall problems for a database that needs to grow and persist.

```js
if (app.isPackaged && !process.env.DATABASE_URL) {
  const dbPath = join(userDataDir, "dev.db").replace(/\\/g, "/");
  process.env.DATABASE_URL = `file:${dbPath}`;
}
```

**Verified**: a direct diagnostic script (bypassing Electron/the installer
entirely — the fast-iteration technique established in Phase 4.7) showed
the exact failing operation succeeding afterward, with real Prisma query
logging (`INSERT INTO User...`) visible.

## The single-user bootstrap gap: `ensureDemoUser`

This app is single-user by design — every route's `resolveCallerId` falls
back to one demo user (looked up by a fixed email) when no `x-user-id`
header is sent, which the desktop app never sends. That row used to only
get created by a separate manual seed script
(`pnpm db:demo-tasks`/`create-demo-interventions.ts`) — **never run by
the packaged app**. On a truly fresh database, even clicking "Connect
Google" itself failed with `"No user is available to connect Google
for."`, before the user ever got a chance to see an OAuth screen.

**Fix**: `demo-scenario.ts` gained a new, minimal `ensureDemoUser(prisma)`
(just the user upsert, refactored out of the existing `ensureDemoData`,
which also creates fake demo email/calendar data — deliberately *not*
reused here, since the "real Gmail + Calendar sync" testing path this
phase needed must never mix in fake demo data). `app.ts` runs it on a
Fastify `onReady` hook — idempotent, runs on every server start, resolves
before `listen()` does, so no request can race it.

**Tests**: new `tests/demo-user-bootstrap.api.test.ts` (3 tests) —
confirms the row exists after a cold start with zero prior seeding,
confirms `/connect` gets past caller resolution on a never-seeded
database, confirms idempotency across multiple starts.

## Feature: the onboarding screen the user actually asked for

The original empty state was a single line of gray text ("No pending
interventions") plus a small underlined "Connect Google" link — nothing
about the Groq key at all unless you found the gear icon. The user's ask
was explicit: on first launch, show a real screen with a Groq key input
and a "Connect Google" button, front and center, not hidden behind
anything.

**Implementation**: `Settings.tsx`'s `onClose` prop became optional.
When present (opened via the gear icon after setup is complete), it
renders as a normal, closable "Settings" panel — unchanged behavior. When
absent, it renders as a "Get started" screen instead — same component,
same fields, no Close button (there's nothing to go back to yet). New
`use-setup-status.ts` hook polls `getSettings()` + `googleStatus()` on the
same 15s interval as intervention polling — necessary because completing
Google OAuth happens in the system browser, outside this window, so
there's no push signal when it finishes; polling is what flips the screen
automatically once the user finishes signing in.

`App.tsx` gates on this: `!groqKeyConfigured || !googleConnected` shows
the get-started screen; both true falls through to the normal view.

## Feature: manual "Check now" — the stand-in for the not-yet-built scheduler

There was previously no way to trigger Gmail sync, Calendar sync, signal
detection, or AI evaluation from the UI at all — those are real, working
API endpoints, reachable only via `curl`. The user's explicit plan: get
the manual cycle working first, build automatic polling after.

**Implementation**: `ApiClient.checkNow()` runs the same sequence a
background poll eventually will, sequentially so each step sees the
previous step's results: Gmail sync → Gmail detect-signals → Calendar
sync → Calendar detect-signals → assistant evaluate. Wired through IPC
(`assistant:check-now`) to a "Check now" button/link shown once setup is
complete — prominently on the "all caught up" empty state, and as a small
persistent link in the corner once interventions are showing, so the user
can re-scan without losing their place.

**Tests**: `api-client.test.ts` — asserts the exact call order and that a
failure at any step stops the sequence and propagates (no partial-success
silent swallowing). `App.test.tsx` — asserts the button calls the bridge
and the resulting intervention list refreshes.

## Feature: multiple pending interventions, one at a time with paging

`useInterventionPolling` used to expose only `items[0]` — the single
highest-priority intervention — even though the API always returned the
full list. The user's vision explicitly included seeing several pending
items ("this pending, this pending, that pending"). Chose "one at a time
with next/previous controls" over "all stacked in a scrollable list" (a
deliberate decision, asked of the user directly, given the overlay's small
fixed footprint).

**Implementation**: the hook now exposes the full `interventions: []`
array; `App.tsx` tracks a `currentIndex`, clamped back into range whenever
the list shrinks (an action completing) or grows (a fresh check-now
finding something new). `‹ N of M ›` controls render only when there's
more than one item.

## Feature: Google OAuth actually working from a packaged install — two separate real problems

Getting to a working "Sign in with Google" click surfaced two distinct,
unrelated problems, both real architecture gaps, not superficial bugs.

### Problem A: the embedded API's port was random every launch, but Google's registered redirect URI needs to be fixed

Phase 4.2 deliberately used `port: 0` (OS-assigned) so the app never needs
a hardcoded port. But Google OAuth requires an OAuth client's registered
redirect URI to match **exactly**, port included, for a "Web
application"-type client (which is what this project's existing,
already-real-world-tested Google Cloud OAuth client is, based on its
redirect URI being registered against a literal fixed port rather than
Google's flexible "Desktop app" loopback matching). A random port every
launch could never match a fixed registration.

**Fix**: `api-server.ts`'s `DEFAULT_PORT` is now a fixed `4000`, matching
what the existing, working credentials already expect. Not overridable
per-request — changing it would silently break Google sign-in until the
registered redirect URI was updated to match. `index.ts` derives
`GOOGLE_REDIRECT_URI` from this same fixed port automatically
(`http://localhost:4000/api/v1/integrations/google/callback`) when
nothing else provides one — the user never has to type this in
themselves, only the Client ID/Secret (see below).

**A real, deliberate design note for whoever picks this up**: this only
works because the specific OAuth client already in use happens to be
registered for exactly this port. If a *different* Google Cloud OAuth
client is ever used, its type matters: a "Desktop app"-type client
(Google's own recommendation for installed apps — see the Phase 4.3
addendum in `HANDOFF.md`, which investigated this exact question) supports
a variable loopback port per RFC 8252 and wouldn't need this fixed-port
constraint at all. Registering a Desktop-type client instead is a real,
open option for later, not pursued this session since the existing
Web-application-type client already works and re-registering wasn't
necessary to unblock testing.

### Problem B: no way to provide Google Client ID/Secret at all, and a deliberate choice not to bake them into source

The packaged app has no `.env` file, and there was no UI to enter Google
OAuth credentials anywhere — only the Groq key had a Settings field. The
project's *own* real, working credentials exist (in the developer's local
`.env`, from earlier phases' real OAuth testing), but baking them into
source/the distributed binary was explicitly rejected: unlike a
"Desktop app"-type client's secret (which Google's own model treats as
not really confidential, since it's meant to ship inside distributed
apps), this project's existing client looks like a "Web application"-type
registration, whose secret Google does treat as genuinely confidential.
Committing it to git would leak it permanently (git history) and make it
trivially extractable from the shipped `.exe`.

**Fix**: `app-config.ts`'s `UserConfig` gained `googleClientId` /
`googleClientSecret`, stored exactly like the Groq key — safeStorage-
encrypted, per-machine, never in source. New Settings UI section ("Google
OAuth credentials") above "Google account" — Client ID (plain text, not
secret) and Client Secret (password-masked) inputs, saved via a new
`settings:save-google-credentials` IPC call that (like the Groq key)
restarts the whole app to pick up the new env vars. The existing
"Sign in with Google" button is now `disabled` with an explanatory
`title` until these are configured.

**Verified**: a direct diagnostic script with fake credentials confirmed
the full chain works — `/connect` now returns a real `302` to
`accounts.google.com` with the correct `client_id`/`redirect_uri`
parameters, instead of the previous `"Google OAuth is not configured"`
`400`. The user then verified with their **real** credentials and
completed a real sign-in.

## Bug 7: the character image never loaded, even after the window itself started rendering correctly

After the earlier blank-window fix (Phase 4.7's Bug 4, `vite.config.ts`'s
`base: "./"`), the container page loaded fine, but `Character.tsx`
still referenced its image as `src="/character.svg"` — an **absolute**
path. Vite's `base` config only rewrites asset paths *it* generates for
the built `<script>`/`<link>` tags in `index.html`; it has no way to know
a hand-written JSX string literal is meant to be an asset reference, so
this was never touched by that fix. Under `file://`, `/character.svg`
still resolved to the filesystem root, not next to `index.html` where the
file actually is.

**Fix**: changed to `src="./character.svg"` (relative — resolves
correctly under both the dev server, where the page is served at root
anyway, and `file://`, where it resolves against `index.html`'s own
directory).

**Also fixed while in this exact file**: the `alt` text was `"Character"`;
every phase's test suite had been carrying one permanently-failing,
explicitly-flagged-as-"pre-existing, unrelated" test
(`findByRole("img", { name: "Assistant character" })`) since Phase 2.1,
because the component's actual alt text never matched. Changed to
`"Assistant character"` — the full desktop suite is genuinely green for
the first time this project has had it, not "green except one known
unrelated failure."

**Verified**: Chrome DevTools Protocol against the real packaged,
installed app — `new Image()` loading `./character.svg` from the real
page's actual location resolved with `naturalWidth=1024`, confirmed
loading, not just "no longer an obviously wrong path."

**Regression test**: new `Character.test.tsx` asserts the `src` attribute
is exactly `"./character.svg"`.

## An open question, honestly unresolved: a data-loss episode mid-session

At one point after the user had successfully connected Google and seen a
real intervention, a later check found the database completely empty
(User row only, `Integration`/`CalendarEvent`/`Signal`/`Intervention` all
`[]`, file creation timestamp matching an agent-driven verification
launch, not the user's own session). The user then repeated the connect +
check-now flow and it worked again, this time confirmed with a
screenshot. **The root cause of the apparent data loss was never
identified** — candidate explanations (an uninstall/reinstall cycle for
the character fix touching the wrong directory, the app being killed
mid-flow before the OAuth callback completed and being mistaken for a
completed connection) were considered but not confirmed. Worth watching
for: if data disappears again, check `%APPDATA%\@ai-agent\desktop\dev.db`'s
modification time against actual usage times, not just whether the app
"looks" connected in the UI.

## Real end-to-end verification (the actual point of all of this)

Confirmed by the **user**, using their **real Google account**, on the
**actual packaged installer** (not a dev build, not an agent-simulated
test): fresh install → Settings shows Groq key + Google OAuth credential
fields → both saved → "Sign in with Google" opens a real Google consent
screen → completed → "Check now" clicked → a real calendar event
("Important Meeting & discussion", 18 minutes out) came back as a
`MEDIUM`-priority intervention, correctly styled, with the character
visible and Open/Done/Remind-me-later buttons all present.

## Tests

New this session: `overlay-window.test.ts` (2), `Character.test.tsx` (1),
`use-setup-status.ts` (no dedicated test — thin polling wrapper, covered
indirectly through `App.test.tsx`), `demo-user-bootstrap.api.test.ts` (3,
`apps/api`). `App.test.tsx` grew substantially: new describe blocks for
window interactivity, first-run setup, Check now, and multiple
interventions. Full desktop suite: **65/65** (genuinely all green — see
Bug 7). Full `apps/api` suite: 467/467 (one pre-existing, documented
flake under full-suite load — `assistant-evaluate.api.test.ts`, a hook
timeout — known intermittent since Phase 2.7, passes cleanly every time
run standalone; not introduced this session). Typecheck/lint clean
across both.

## What's still open for the next session

- **The actual point of Phase 4.7 — a genuinely clean machine.** Every
  verification this entire session, including all of the above, was on
  the same machine that's had this repo's dev environment on it the whole
  time.
- **Continuous/scheduled sync.** "Check now" is explicitly a manual stand-in.
  The user's own stated plan: build the automatic version (poll every
  5–10 minutes) once the manual cycle was proven solid — which it now is.
- **The unresolved data-loss episode** above — not reproduced deliberately,
  not root-caused.
- **Done/Snooze/Open buttons against real (non-demo) data** — seen
  rendered correctly, not yet click-tested by the user against a real
  intervention.
- **Disconnect/reconnect Google** — not exercised this session.
- **Whether other hand-written absolute asset paths exist elsewhere in the
  renderer** — Bug 7 was found by testing, not a systematic audit; nothing
  else has surfaced, but nothing was specifically searched for either.
- No code signing certificate, no custom app icon — unchanged from Phase 4.6.
