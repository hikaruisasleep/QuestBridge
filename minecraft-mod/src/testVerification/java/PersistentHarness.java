import java.time.Instant;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import xyz.jxcb.ftbquestoverlay.adapter.QuestSnapshot;
import xyz.jxcb.ftbquestoverlay.transport.ConnectionController;
import xyz.jxcb.ftbquestoverlay.transport.SnapshotSink;

/**
 * Development harness: holds a real {@link ConnectionController} open for a
 * while, delivering handoffs through the same coalescing path the client uses.
 *
 * Verifies what a one-shot harness cannot: that heartbeats keep the publisher
 * live (the host does not mark it stale or disconnected), and that the controller
 * produces incremental messages rather than resending snapshots.
 *
 * Usage:
 *   java PersistentHarness <ws-url> <minecraftToken> <durationMs>
 */
public final class PersistentHarness {
    private static final AtomicInteger snapshots = new AtomicInteger();
    private static final AtomicInteger handoffs = new AtomicInteger();

    public static void main(String[] args) throws Exception {
        String url = args[0];
        String token = args[1];
        long durationMs = Long.parseLong(args[2]);

        SnapshotDifferVersionsHolder versions = new SnapshotDifferVersionsHolder();

        ConnectionController controller = new ConnectionController(
                url, token, "persistent-" + java.util.UUID.randomUUID(), versions.versions);
        controller.start();

        long deadline = System.currentTimeMillis() + durationMs;
        int tick = 0;
        while (System.currentTimeMillis() < deadline) {
            Thread.sleep(2_000);
            tick++;
            // Mimic the client thread: offer a capture every ~2 s, changing
            // chapter progress each time so increments are exercised.
            QuestSnapshot snapshot = snapshot(tick);
            handoffs.incrementAndGet();
            controller.offer(new SnapshotSink.Handoff(
                    snapshot,
                    new QuestSnapshot.Identity("file-p", "team-persistent", "level-p:minecraft:overworld"),
                    true, "ready", null));
            snapshots.incrementAndGet();
        }

        System.out.println("HANDOFFS " + handoffs.get());
        System.out.println("SCHEDULER_TICKS " + controller.schedulerTicks());
        System.out.println("STATS " + controller.stats());
        controller.stop();
        System.out.println("PERSISTENT DONE");
        System.exit(0);
    }

    private static QuestSnapshot snapshot(int tick) {
        int progress = 10 * (tick % 5);
        QuestSnapshot.Chapter chapter = new QuestSnapshot.Chapter(
                "C0000000000002", "Persistent chapter", null, 0, progress, "available");
        QuestSnapshot.Quest quest = new QuestSnapshot.Quest(
                "Q0000000000002", "C0000000000002", "Persistent quest", null,
                false, false, List.of(),
                List.of(new QuestSnapshot.Task("T0000000000003", "ftbquests:item", "Ingot",
                        false, new QuestSnapshot.TaskProgress("in_progress", (long) progress, 100L, progress))),
                new QuestSnapshot.QuestProgress("in_progress", 0, 1, progress));
        return new QuestSnapshot(
                "Persistent world", "minecraft:overworld", false,
                "team-persistent", "Persistent team",
                List.of(chapter), List.of("Q0000000000002"), List.of(quest), List.of(),
                Instant.now().toString());
    }

    private static final class SnapshotDifferVersionsHolder {
        private final xyz.jxcb.ftbquestoverlay.transport.SnapshotDiffer.Versions versions =
                new xyz.jxcb.ftbquestoverlay.transport.SnapshotDiffer.Versions(
                        "0pre.2", "1.21.1", "21.1.250", "2101.1.30", "2101.1.10");
    }

    private PersistentHarness() {
    }
}
