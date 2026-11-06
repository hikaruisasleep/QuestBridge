import java.time.Instant;
import java.util.List;

import xyz.jxcb.ftbquestoverlay.adapter.QuestSnapshot;
import xyz.jxcb.ftbquestoverlay.protocol.ProtocolMessages;
import xyz.jxcb.ftbquestoverlay.transport.SnapshotDiffer;

/**
 * Documents the exact set of messages a live ATM10 client will emit.
 *
 * Run through the real encoder and differ, so what is printed is what will be
 * published. Used to prepare the 4F live session and to check the values that
 * only real data can confirm: chapters with null progress, completed chapters,
 * subtitles, numeric task progress, and pin ordering.
 *
 * Usage: java CapturePlan
 */
public final class CapturePlan {
    public static void main(String[] args) {
        Instant now = Instant.parse("2026-11-07T00:00:00Z");
        String session = "capture-plan-0000-4000-8000-000000000000";

        QuestSnapshotDifferHolder holder = new QuestSnapshotDifferHolder();

        System.out.println("Stages the client publishes, in order:");
        System.out.println("  1. minecraft.hello     sequences 1, with detected versions");
        System.out.println("  2. minecraft.status    phase unavailable or synchronizing");
        System.out.println("  3. minecraft.heartbeat every host-declared interval, ready=false");
        System.out.println("  4. minecraft.snapshot  once FTB data is ready; forced on world/team/reload");
        System.out.println("  5. minecraft.status    phase ready");
        System.out.println("  6. minecraft.progress  changed chapters and/or pinned quests only");
        System.out.println("  7. minecraft.pins      only when the manual pin set changes");
        System.out.println();

        System.out.println("What the 4F run must show in minecraft.snapshot:");
        System.out.println("  - 55 chapters, all with distinct ids and 0-based order");
        System.out.println(
                "  - the five ATM10 chapters resolve by id: 3B0302DB5E77C3A2, 28BCA5042050B140, "
                        + "67E7552FDA3245F5, 634794CB36D61302, 571D32BADC77CDD0");
        System.out.println("  - at least one chapter with progress null and one with status completed");
        System.out.println("  - at least one chapter carrying a subtitle");
        System.out.println("  - manualPinIds never contains \"1\" (the automatic tracker)");
        System.out.println("  - every pinned quest's chapterId appears in chapters");
        System.out.println("  - at least one task with current/target present");
        System.out.println("  - quests order equals manualPinIds minus unresolved, chapter order first");
        System.out.println();

        // Demonstrate the fallback pin ordering with a synthetic set: pins are
        // presented in chapter-catalog order, not FTB (which has none).
        QuestSnapshot.Chapter early = new QuestSnapshot.Chapter(
                "C0000000000001", "Earlier chapter", null, 0, 10, "available");
        QuestSnapshot.Chapter later = new QuestSnapshot.Chapter(
                "C0000000000002", "Later chapter", null, 1, 20, "available");
        QuestSnapshot.Quest earlyQuest = quest("QA", "C0000000000001", "From earlier chapter");
        QuestSnapshot.Quest laterQuest = quest("QB", "C0000000000002", "From later chapter");

        QuestSnapshot ordered = new QuestSnapshot(
                "ATM10 Skyblock", "minecraft:overworld", false,
                "00000000-0000-4000-8000-000000000001", "Team",
                List.of(early, later),
                List.of("QA0000000000001", "QB0000000000001", "FFFFFFFFFFFFFFFF"),
                List.of(earlyQuest, laterQuest),
                List.of("FFFFFFFFFFFFFFFF"),
                now.toString());

        String json = ProtocolMessages.envelope("minecraft.snapshot", session, 1, now)
                .withPayload(ProtocolMessages.snapshotPayload(ordered));

        System.out.println("Example: two pins from different chapters, plus one unresolved id");
        System.out.println("  " + json);
        System.out.println();
        System.out.println("  -> quests follow chapter order (QA chapter 0 before QB chapter 1),");
        System.out.println("     unresolved id last in manualPinIds and alone in unresolvedPinnedQuestIds.");
        System.out.println();
        System.out.println("Differ sanity: first capture produces exactly one snapshot message: "
                + holder.differ.onSnapshot(session, ordered, identityOf(ordered), true, now).size());
    }

    private static QuestSnapshot.Identity identityOf(QuestSnapshot snapshot) {
        return new QuestSnapshot.Identity("file", "team", "world");
    }

    private static QuestSnapshot.Quest quest(String prefix, String chapterId, String title) {
        return new QuestSnapshot.Quest(
                prefix + "0000000000001", chapterId, title, null, false, false, List.of(),
                List.of(new QuestSnapshot.Task(
                        "T" + prefix + "00000000001", "ftbquests:item", "Item", false,
                        new QuestSnapshot.TaskProgress("in_progress", 3L, 8L, 37))),
                new QuestSnapshot.QuestProgress("in_progress", 0, 1, 37));
    }

    private static final class QuestSnapshotDifferHolder {
        private final SnapshotDiffer differ = new SnapshotDiffer();
    }

    private CapturePlan() {
    }
}
