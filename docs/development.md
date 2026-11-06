# QuestBridge Development

**Status:** Phase 1 implemented (shared protocol and mock publisher). Phase 2 and Phase 3 are deferred; Stage 4A (client-side live FTB probe) is implemented and building in `minecraft-mod/`, with live in-client verification pending. The network adapter has not started.
**Date:** 2026-11-06
**Toolchain:** Node `24.22.1`, npm `11.19.1`, JDK 21, NeoForge `21.1.250`

---

## 1. Repository map

```text
packages/protocol/        @questbridge/protocol — v1 types, Zod schemas, messages
packages/mock-publisher/  @questbridge/mock-publisher — fixtures, scenarios, CLI
apps/web-app/             Svelte 5 + SvelteKit scaffold (routes not implemented)
minecraft-mod/            NeoForge client mod (Stage 4A live probe; network adapter not implemented)
docs/                     Architecture, protocol, pinning, FTB reconnaissance
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

- `npm run build` builds `@questbridge/protocol`, then `@questbridge/mock-publisher`, then `web-app`.
- `npm test` runs the same order: 85 protocol tests, 30 mock-publisher tests, and the existing web-app scaffold tests.
- `npm run build -w @questbridge/protocol` and `npm test -w @questbridge/protocol` target one workspace.
- The mock package uses a TypeScript project reference to the protocol package, so `tsc -b` builds the dependency first even when npm runs workspaces in another order.

Java:

```text
cd minecraft-mod
./gradlew compileJava
./gradlew dependencies --configuration compileClasspath
```

---

## 4. Mock publisher

The mock publisher implements the Minecraft side of the protocol. It needs a collector or host to connect to; the QuestBridge host is Phase 2 work.

```text
npm run mock -- --list
npm run mock -- --scenario=ready
npm run mock -- --scenario=progress --speed=2
npm run mock -- --scenario=disconnect --url=ws://127.0.0.1:8765/ws
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
npm run collect -- --stale-after 10000
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

---

## 6. Protocol changes

`packages/protocol/src/schemas.ts` is the single source of truth. Types in `types.ts` are inferred from it.

- Protocol objects are strict; unknown fields are rejected.
- The v1 contract does not allow additive fields. Any schema change that alters the wire shape requires a new protocol version and coordinated updates to the mock, host, frontend, and Java adapter.
- Cross-field invariants (chapter/quest/task uniqueness, objective-set partitioning, pin limits, progress ranges) live in the same schemas.
- Direction-aware parsing rejects a message sent on the wrong connection direction.
- `SequenceTracker` and `RevisionTracker` implement the ordering rules; do not duplicate them in components.

The Java adapter must implement the same wire format manually. It cannot import the TypeScript package.

---

## 7. Current limitations

- No host, so no live end-to-end browser session yet.
- No `/overlay` or `/control` routes.
- No FTB Quests network adapter. Stage 4A is a client-thread diagnostic probe only; it has not yet been verified against a live client.
- Transport authentication (Proposal B) is still pending; the protocol assumes an authenticated role.
- Mock chapter progress is fixed fixture data, not derived from a live quest book.

See `docs/protocol.md` section 13 for the Phase 1 acceptance results and `docs/architecture.md` for component responsibilities.
