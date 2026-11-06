# QuestBridge Development

**Status:** Phase 1, Phase 2 (through milestone 2G), and Phase 3 are implemented. `apps/web-app` serves three real routes from a static build: `/overlay`, `/control`, and `/`. Stage 4A (client-side live FTB probe) is implemented, builds, and is verified against the live client in `docs/testing-logs/2026-11-06-1.log`. Stage 4B–4F have not started; `docs/phase-4-plan.md` describes the adapter work against the now-complete host and frontend, and names 4B as the next milestone.

**Date:** 2026-11-06
**Toolchain:** Node `24.22.1`, npm `11.19.1`, JDK 21, NeoForge `21.1.250`

---

## 1. Repository map

```text
packages/protocol/        @questbridge/protocol — v1 types, Zod schemas, messages
packages/mock-publisher/  @questbridge/mock-publisher — fixtures, scenarios, CLI
packages/host/            @questbridge/host — loopback host, state store, chapter pins, transport
apps/web-app/             Svelte 5 + SvelteKit static frontend, three routes (see docs/web-frontend.md)
minecraft-mod/            NeoForge client mod (Stage 4A live probe; network adapter not implemented)
docs/                     Architecture, protocol, pinning, plans, FTB reconnaissance
```

The Java project is independent of the npm workspace. Build it from `minecraft-mod/`.

---

## 2. Install

From the repository root:

```text
npm install
```

The web-app scaffold uses Vitest browser mode. Install Chromium once per machine:

```text
npx playwright install chromium
```

Without that browser, the protocol and mock tests still pass, but `npm test` fails when it reaches the web-app browser project.

---

## 3. Build and test

```text
npm run build
npm test
```

- `npm run build` builds `@questbridge/protocol`, then `@questbridge/mock-publisher`, then `@questbridge/host`, then `web-app`.
- `npm test` runs the same order: 85 protocol tests, 30 mock-publisher tests, 250 host tests, and 169 web-app tests (534 total). The web-app suite includes component tests in real Chromium; the host suite includes a test that serves the built frontend.
- `npm run build -w @questbridge/protocol` and `npm test -w @questbridge/protocol` target one workspace.
- The mock and host packages use a TypeScript project reference to the protocol package, so `tsc -b` builds the dependency first even when npm runs workspaces in another order.
- The host vitest config aliases the protocol and mock-publisher *sources*, so `npm test -w @questbridge/host` needs no prior build.

Java:

```text
cd minecraft-mod
./gradlew compileJava
./gradlew dependencies --configuration compileClasspath
```

---

## 3.1 Versioning

The full policy is in [`docs/versioning.md`](versioning.md). In short:

- Pre-Done versions use `0pre.<minor>`, for example `0pre.1`.
- Each new conversation reads the documented version and increments the minor
  component by exactly one, then stays on that version for the whole thread.
- Do not increment for individual commits, fixes, or rebuilds.
- When the conversation closes, update the documented version.
- Major bumps happen only on explicit user request; `1.0.0` is not automatic.

The current Stage 4 thread is on `0pre.1`. The Gradle `mod_version` value flows
into both the jar filename (`questbridge-0pre.1.jar`) and
`META-INF/neoforge.mods.toml`.

---

## 4. Mock publisher

The mock publisher implements the Minecraft side of the protocol. It needs a collector or the QuestBridge host to connect to.

```text
npm run mock -- --list
npm run mock -- --scenario=ready
npm run mock -- --scenario=progress --speed=2
npm run mock -- --scenario=disconnect --url=ws://127.0.0.1:8765/ws
npm run mock -- --scenario=ready --token=<minecraftToken>
```

Scenarios:

| Name | Purpose |
|---|---|
| `unavailable` | Hello and heartbeats without quest data |
| `ready` | Synchronization and one full snapshot |
| `progress` | Chapter and quest progress, completion, and pin removal |
| `chapter-completion` | Completion status change without a pin change |
| `pins` | Pin additions, an unresolved ID, and completed-pin removal |
| `reload` | Fresh catalog and snapshot after a quest reload |
| `world-change` | New world identity and reset progress |
| `team-change` | New team identity and different progress |
| `disconnect` | Socket close, reconnect, and a fresh snapshot |
| `stale` | Heartbeats stop while the socket stays open |
| `full` | Combined lifecycle |

Constraints:

- The CLI binds to loopback hosts only.
- `--speed` scales the scripted delays; it does not change the message contents.
- Fixtures are synthetic and deterministic. No real ATM10 TTS identifiers are used.
- `--token` sends the token as an `Authorization: Bearer` header, which the host requires. `QUESTBRIDGE_MINECRAFT_TOKEN` is the equivalent environment variable. Without a token the mock connects unauthenticated, which still works against the standalone collector.

The collector tests in `packages/mock-publisher/tests/collector.test.ts` and `packages/mock-publisher/tests/mock-publisher.test.ts` replay scenarios into the standalone collector and into a temporary WebSocket server. Run them directly with:

```text
npm test -w @questbridge/mock-publisher
```

---

## 5. Standalone collector

`npm run collect` starts a loopback-only collector for user testing. It implements the host side of the Minecraft handshake, validates every message with `@questbridge/protocol`, and prints the normalized observation state.

It is **not** the QuestBridge host: it does not own chapter pins or display settings, does not serve a browser UI, and does not implement browser roles.

Run it in one terminal:

```text
npm run collect
```

Then run a scenario in another terminal:

```text
npm run mock -- --scenario=full --speed=5
```

The collector prints connection changes, hello/version data, snapshots, progress updates, pin changes, objectives, unresolved IDs, and heartbeats. Ctrl+C prints the final state summary and stops it.

Options:

```text
npm run collect -- --port 8765
npm run collect -- --stale-after 20000
```

Behavior:

- Binds only to `127.0.0.1`.
- Requires `minecraft.hello` first and sends `host.welcome`.
- Tracks sequence numbers per connection and sends `host.request_snapshot` on a gap.
- Rejects non-loopback WebSocket origins and a second concurrent publisher.
- Retains the last snapshot after disconnect, marked as disconnected and stale.
- Uses wall-clock receipt time for staleness; mock message timestamps stay in the data payload.
- Defaults to port `8765`, matching `npm run mock`'s default URL.
- Has no transport authentication. It binds loopback and checks WebSocket origins, but it is a local testing tool, not a release-ready host.

If you change the port, pass the matching URL to the mock publisher:

```text
npm run collect -- --port 9000
npm run mock -- --scenario=ready --url=ws://127.0.0.1:9000/ws
```

The collector is a development tool. For a real browser session with chapter
pins, use the host in §6 instead.

---

## 6. Host

`packages/host` (`@questbridge/host`) is the production host. It binds
`127.0.0.1` only and owns the chapter pin configuration, display settings,
normalized state, WebSocket transport, and — once Phase 3 provides a build —
the static frontend.

### 6.1 Start it

```text
npm run build -w @questbridge/host
npm run host -- --print-urls
npm run host
```

The first run creates the configuration directory, writes a default
`config.json` with **no** chapter pins, and generates `tokens.json`. The
`--print-urls` output is a credential, so it is written to stdout only and never
to a log.

Options:

```text
--port <number>        Loopback port (default 8765; 0 chooses a free port)
--config-dir <path>    Configuration directory (overrides QUESTBRIDGE_CONFIG_DIR)
--build-dir <path>     Built frontend directory to serve /overlay and /control from
--print-urls           Print the overlay and dashboard access URLs, then exit
--help                 Show help
```

Configuration resolution order is `QUESTBRIDGE_CONFIG_DIR`, then
`%APPDATA%\QuestBridge` on Windows, `~/Library/Application Support/QuestBridge`
on macOS, and `$XDG_CONFIG_HOME/questbridge` or `~/.config/questbridge` on Linux.

### 6.2 Feed it with the mock publisher

In one terminal:

```text
npm run host
```

In another, using the `minecraftToken` from the host's `tokens.json`:

```text
npm run mock -- --scenario=full --speed=5 --token=<minecraftToken>
```

### 6.3 Authenticated access

- Browser: open a `--print-urls` URL. The page token is appended to the
  WebSocket URL by the frontend; the upgrade is the single authentication
  checkpoint.
- Minecraft: send the token as an `Authorization: Bearer` header.

Page requests are deliberately ungated. The shell carries no state, and serving
it lets the real UI render an actionable authorization message rather than a
bare `401`.

### 6.4 Behaviour worth knowing

- Without `--build-dir`, `/overlay` and `/control` return a placeholder that
  states the frontend is not built. The host never fabricates progression.
- With `--build-dir apps/web-app/build`, the real prerendered frontend is
  served. `Cache-Control` is set per file class: `_app/immutable/…` is
  immutable for a year, HTML is `no-store`, everything else revalidates.
- An unknown path is a `404`. No Phase 2 route accepts a request body: an
  oversized one is `413`, any other is `405`.
- Mutations are limited to 10 per second per connection. A burst returns
  `rate_limited`, which is the limiter rather than a rule violation.
- A corrupt `tokens.json` is backed up and regenerated so it cannot lock you
  out; an invalid `config.json` is preserved and reported, because chapter pins
  are not regenerable.
- The five-pin cap, duplicates, unknown catalog IDs, and reorder sets are all
  refused with distinct error codes, leaving the stored configuration unchanged.

### 6.5 Frontend build

`apps/web-app` uses `@sveltejs/adapter-static`; the build writes real HTML to
`apps/web-app/build`. See `docs/web-frontend.md` for why a static build is
required rather than optional, and for the frontend's failure-state
requirements.

```text
npm run build -w web-app
npm run host -- --build-dir apps/web-app/build
```

---

## 7. Protocol changes

`packages/protocol/src/schemas.ts` is the single source of truth. Types in `types.ts` are inferred from it.

- Protocol objects are strict; unknown fields are rejected.
- The v1 contract does not allow additive fields. Any schema change that alters the wire shape requires a new protocol version and coordinated updates to the mock, host, frontend, and Java adapter.
- Cross-field invariants (chapter/quest/task uniqueness, objective-set partitioning, pin limits, progress ranges) live in the same schemas.
- Direction-aware parsing rejects a message sent on the wrong connection direction.
- `SequenceTracker` and `RevisionTracker` implement the ordering rules; do not duplicate them in components.

The Java adapter must implement the same wire format manually. It cannot import the TypeScript package.

---

## 8. Current limitations

- No FTB Quests network adapter. Stage 4A is a client-thread diagnostic probe;
  the network adapter is Stage 4B–4F. Every frontend run therefore uses the mock
  publisher, and mock success is not FTB compatibility.
- Mock chapter progress is fixed fixture data, not derived from a live quest
  book.
- The OBS-facing behaviour has been verified in Chromium at the documented
  380 × 650 frame, but not with the OBS application driving the source. See
  `docs/testing-logs/2026-11-07-phase3-overlay.md` §4.
- **OBS keying is operator configuration, not app behaviour.** The overlay paints
  a uniform `#00FF00` or `#0000FF` field; the Chroma Key filter that removes it is
  added to the Browser source in OBS. The key colour is switched under
  **Background** in the dashboard and stored in the browser, not on the host, so
  an OBS source and a dashboard tab can be set to different colours.
- Queueing is not implemented: a mutation is sent once and rejected rather than
  retried, and the dashboard surfaces the host's error code.

See `docs/protocol.md` section 13 for the Phase 1 acceptance results,
`docs/phase-2-plan.md` §15 for the Phase 2 milestone results,
`docs/web-frontend.md` for the frontend contract, and `docs/architecture.md`
for component responsibilities.
