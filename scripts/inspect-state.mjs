/**
 * Browser-side observer for an unattended end-to-end check.
 *
 * Connects as the `control` role, prints the host state snapshot it receives,
 * and optionally exits non-zero when an expectation is not met. Written because
 * the host's own log does not print browser-visible state.
 *
 * Usage:
 *   node scripts/inspect-state.mjs <browserToken> [--port=8799]
 *        [--expect-ready] [--max-wait-ms=15000]
 */
import { WebSocket } from "ws";

const token = process.argv[2];
if (!token) {
  console.error("usage: node scripts/inspect-state.mjs <browserToken> [--port=8799] [--expect-ready]");
  process.exit(1);
}

const args = process.argv.slice(3);
const portArg = args.find((arg) => arg.startsWith("--port="));
const port = portArg ? portArg.split("=")[1] : "8799";
const expectReady = args.includes("--expect-ready");
const maxWaitArg = args.find((arg) => arg.startsWith("--max-wait-ms="));
const maxWaitMs = maxWaitArg ? Number(maxWaitArg.split("=")[1]) : 15_000;

const url =
  `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`;

const socket = new WebSocket(url, { headers: { origin: `http://127.0.0.1:${port}` } });

function describe(snapshot) {
  const value = snapshot.payload;
  const lines = [
    `revision=${value.revision}`,
    `connection=${value.connection.status} stale=${value.connection.stale}`,
    `lastSnapshotAt=${value.connection.lastSnapshotAt}`,
    `world=${value.minecraft.worldName} dimension=${value.minecraft.dimension} team=${value.minecraft.teamId}`,
    `chapters=${value.chapters.length} quests=${value.quests.length} unresolvedPins=${value.unresolvedPinnedQuestIds.length}`,
    `chapterPins=${value.chapterPins.pinnedChapters.length}`,
  ];
  if (value.chapters.length > 0) {
    lines.push(
      "chapterSample=" +
        value.chapters
          .slice(0, 3)
          .map((chapter) => `${chapter.id}:${chapter.title}:${chapter.progress}:${chapter.status}`)
          .join(" | "),
    );
  }
  if (value.quests.length > 0) {
    lines.push(
      "questSample=" +
        value.quests
          .map(
            (quest) =>
              `${quest.id}:${quest.title}:${quest.progress.status}:${quest.progress.completedTasks}/${quest.progress.totalRequiredTasks}`,
          )
          .join(" | "),
    );
  }
  return lines.join("\n");
}

const timer = setTimeout(() => {
  console.error("TIMEOUT waiting for state.snapshot");
  process.exit(3);
}, maxWaitMs);

socket.on("open", () => {
  socket.send(
    JSON.stringify({
      protocolVersion: 1,
      type: "browser.hello",
      timestamp: new Date().toISOString(),
      payload: { role: "control", clientName: "inspect-state" },
    }),
  );
});

socket.on("message", (data) => {
  const message = JSON.parse(data.toString());
  if (message.type !== "state.snapshot") {
    console.log(`message ${message.type}`);
    return;
  }
  clearTimeout(timer);
  console.log(describe(message));

  const ready = message.payload.connection.status === "ready";
  socket.close();
  if (expectReady && !ready) {
    console.error(`EXPECTED ready, got ${message.payload.connection.status}`);
    process.exit(2);
  }
  process.exit(0);
});

socket.on("error", (error) => {
  clearTimeout(timer);
  console.error(`websocket error: ${error.message}`);
  process.exit(4);
});
