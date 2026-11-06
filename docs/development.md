# QuestBridge Development

**Status:** Phase 1 implemented (shared protocol and mock publisher). The host, Svelte routes, and Minecraft adapter are not implemented yet.
**Date:** 2026-11-06
**Toolchain:** Node `24.22.1`, npm `11.19.1`, JDK 21, NeoForge `21.1.250`

---

## 1. Repository map

```text
packages/protocol/        @questbridge/protocol — v1 types, Zod schemas, messages
packages/mock-publisher/  @questbridge/mock-publisher — fixtures, scenarios, CLI
apps/web-app/             Svelte 5 + SvelteKit scaffold (routes not implemented)
minecraft-mod/            NeoForge client mod skeleton (adapter not implemented)
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
- `npm test` runs the same order: 85 protocol tests, 22 mock-publisher tests, and the existing web-app scaffold tests.
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

The mock publisher implements the Minecraft side of the protocol. It needs a host to connect to; the host is Phase 2 work.

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

The collector test in `packages/mock-publisher/tests/mock-publisher.test.ts` replays the `full` scenario into a temporary WebSocket server. Run it directly with:

```text
npm test -w @questbridge/mock-publisher
```

---

## 5. Protocol changes

`packages/protocol/src/schemas.ts` is the single source of truth. Types in `types.ts` are inferred from it.

- Protocol objects are strict; unknown fields are rejected.
- The v1 contract does not allow additive fields. Any schema change that alters the wire shape requires a new protocol version and coordinated updates to the mock, host, frontend, and Java adapter.
- Cross-field invariants (chapter/quest/task uniqueness, objective-set partitioning, pin limits, progress ranges) live in the same schemas.
- Direction-aware parsing rejects a message sent on the wrong connection direction.
- `SequenceTracker` and `RevisionTracker` implement the ordering rules; do not duplicate them in components.

The Java adapter must implement the same wire format manually. It cannot import the TypeScript package.

---

## 6. Current limitations

- No host, so no live end-to-end browser session yet.
- No `/overlay` or `/control` routes.
- No FTB Quests adapter. Passing mock tests does not prove FTB compatibility.
- Transport authentication (Proposal B) is still pending; the protocol assumes an authenticated role.
- Mock chapter progress is fixed fixture data, not derived from a live quest book.

See `docs/protocol.md` section 13 for the Phase 1 acceptance results and `docs/architecture.md` for component responsibilities.
