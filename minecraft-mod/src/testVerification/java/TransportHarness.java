import java.time.Instant;
import java.util.List;

import xyz.jxcb.ftbquestoverlay.adapter.QuestSnapshot;
import xyz.jxcb.ftbquestoverlay.transport.SnapshotDiffer;
import xyz.jxcb.ftbquestoverlay.transport.WebSocketConnection;

/**
 * Development harness: drives the real transport classes against a running
 * QuestBridge host.
 *
 * Proves that the Java encoder's output is accepted by the real host over a real
 * WebSocket, including the Authorization header, sequence numbering, and the
 * objective-set invariant. It is not a substitute for the in-game client.
 *
 * Usage:
 *   java TransportHarness <ws-url> <minecraftToken>
 */
public final class TransportHarness {
    public static void main(String[] args) throws Exception {
        String url = args[0];
        String token = args[1];

        StringBuilder received = new StringBuilder();

        WebSocketConnection.Listener listener = new WebSocketConnection.Listener() {
            @Override
            public void onText(String text) {
                received.append(text).append('\n');
                System.out.println("RECV " + abbreviate(text));
            }

            @Override
            public void onClosed(String reason) {
                System.out.println("CLOSED " + reason);
            }
        };

        WebSocketConnection connection = WebSocketConnection.open(url, token, listener);
        System.out.println("CONNECTED " + url);

        SnapshotDiffer differ = new SnapshotDiffer();
        SnapshotDiffer.Versions versions = new SnapshotDiffer.Versions(
                "0pre.2", "1.21.1", "21.1.250", "2101.1.30", "2101.1.10");
        String sessionId = "harness-" + java.util.UUID.randomUUID();

        connection.sendText(differ.hello(sessionId, versions, Instant.now()));
        Thread.sleep(300);

        connection.sendText(differ.status(sessionId, "unavailable", "Harness: no world loaded", Instant.now()));
        Thread.sleep(200);

        connection.sendText(differ.heartbeat(sessionId, false, Instant.now()));
        Thread.sleep(200);

        QuestSnapshot.Identity identity =
                new QuestSnapshot.Identity("file-1", "team-harness", "level-harness:minecraft:overworld");

        // Snapshot 1: one chapter, one pinned quest with numeric and boolean tasks.
        QuestSnapshot.Task numericTask = new QuestSnapshot.Task(
                "T0000000000001", "ftbquests:item", "Iron",
                false, new QuestSnapshot.TaskProgress("in_progress", 5L, 10L, 50));
        QuestSnapshot.Task boolTask = new QuestSnapshot.Task(
                "T0000000000002", "ftbquests:checkmark", null,
                true, new QuestSnapshot.TaskProgress("incomplete", null, null, 0));
        QuestSnapshot.Quest quest = new QuestSnapshot.Quest(
                "Q0000000000001", "C0000000000001", "Harness quest", "Line one\nLine two",
                false, false, List.of("Q9999999999999"),
                List.of(numericTask, boolTask),
                new QuestSnapshot.QuestProgress("in_progress", 0, 1, 50));
        QuestSnapshot.Chapter chapter = new QuestSnapshot.Chapter(
                "C0000000000001", "Harness chapter", "a subtitle", 0, 25, "available");

        QuestSnapshot first = new QuestSnapshot(
                "Harness world", "minecraft:overworld", false,
                "team-harness", "Harness team",
                List.of(chapter), List.of("Q0000000000001"), List.of(quest), List.of(),
                Instant.now().toString());

        for (var message : differ.onSnapshot(sessionId, first, identity, true, Instant.now())) {
            connection.sendText(message.json());
            System.out.println("SENT " + message.type());
        }
        Thread.sleep(400);

        // Snapshot 2: chapter progress changes only -> expect minecraft.progress.
        QuestSnapshot.Chapter chapter2 = new QuestSnapshot.Chapter(
                "C0000000000001", "Harness chapter", "a subtitle", 0, 40, "available");
        QuestSnapshot firstB = new QuestSnapshot(
                first.worldName(), first.dimension(), false, first.teamId(), first.teamName(),
                List.of(chapter2), first.manualPinIds(), first.quests(),
                first.unresolvedPinnedQuestIds(), Instant.now().toString());
        for (var message : differ.onSnapshot(sessionId, firstB, identity, false, Instant.now())) {
            connection.sendText(message.json());
            System.out.println("SENT " + message.type());
        }
        Thread.sleep(400);

        // Snapshot 3: pin set changes -> expect minecraft.pins.
        QuestSnapshot pinsChanged = new QuestSnapshot(
                firstB.worldName(), firstB.dimension(), false, firstB.teamId(), firstB.teamName(),
                List.of(chapter2), List.of("Q0000000000001", "FFFFFFFFFFFFFFFF"),
                List.of(quest), List.of("FFFFFFFFFFFFFFFF"), Instant.now().toString());
        for (var message : differ.onSnapshot(sessionId, pinsChanged, identity, false, Instant.now())) {
            connection.sendText(message.json());
            System.out.println("SENT " + message.type());
        }
        Thread.sleep(500);

        connection.close();
        Thread.sleep(300);

        boolean sawWelcome = received.toString().contains("host.welcome");
        boolean sawError = received.toString().contains("host.error");
        boolean sawRequest = received.toString().contains("host.request_snapshot");
        System.out.println("RESULT welcome=" + sawWelcome + " error=" + sawError
                + " requestSnapshot=" + sawRequest);
        System.out.println(sawWelcome && !sawError ? "TRANSPORT OK" : "TRANSPORT FAILED");
        System.exit(sawWelcome && !sawError ? 0 : 2);
    }

    private static String abbreviate(String text) {
        return text.length() <= 160 ? text : text.substring(0, 160) + "...";
    }

    private TransportHarness() {
    }
}
