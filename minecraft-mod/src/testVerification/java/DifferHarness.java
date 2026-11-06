import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

import xyz.jxcb.ftbquestoverlay.adapter.QuestSnapshot;
import xyz.jxcb.ftbquestoverlay.transport.SnapshotDiffer;

/**
 * Development harness: emits the incremental messages the differ produces
 * (minecraft.progress and minecraft.pins) so they can be validated against the
 * TypeScript schemas by scripts/validate-snapshot.mjs.
 *
 * The snapshot payload was covered by EncoderHarness; these two message types
 * were not, and they have their own schema rules (at least one section present,
 * objective-set partition, no empty quests array).
 *
 * Usage: java DifferHarness <output-dir>
 */
public final class DifferHarness {
    public static void main(String[] args) throws Exception {
        Path out = Path.of(args[0]);
        Files.createDirectories(out);

        SnapshotDiffer differ = new SnapshotDiffer();
        String session = "differ-session-0000-4000-8000-000000000000";
        Instant now = Instant.parse("2026-11-07T00:00:00Z");

        QuestSnapshot.Identity identity =
                new QuestSnapshot.Identity("file-d", "team-delta", "level-d:minecraft:overworld");

        QuestSnapshot first = snapshot(10, List.of(), List.of(), List.of());
        for (SnapshotDiffer.Outbound message : differ.onSnapshot(session, first, identity, true, now)) {
            Files.writeString(out.resolve("d-01-first.json"), message.json(), StandardCharsets.UTF_8);
        }

        // Chapter progress only -> minecraft.progress with chapters.
        QuestSnapshot chapterChanged = snapshot(30, List.of("QA"), List.of("QA"), List.of());
        int index = 2;
        for (SnapshotDiffer.Outbound message
                : differ.onSnapshot(session, chapterChanged, identity, false, now)) {
            write(out, index++, message);
        }

        // Pinned quest task progress only -> minecraft.progress with quests.
        QuestSnapshot questProgress = snapshot(30, List.of("QA"), List.of("QA"), List.of(), 5L);
        for (SnapshotDiffer.Outbound message
                : differ.onSnapshot(session, questProgress, identity, false, now)) {
            write(out, index++, message);
        }

        // Pin set change -> minecraft.pins carrying the full objective set.
        QuestSnapshot pinsChanged = snapshot(30, List.of("QA", "QC"), List.of("QA", "QC"), List.of());
        for (SnapshotDiffer.Outbound message
                : differ.onSnapshot(session, pinsChanged, identity, false, now)) {
            write(out, index++, message);
        }

        // Unresolved pin added -> pins including an unresolved id. A real
        // capture puts resolved ids first and unresolved ids after them, which
        // is what the host's ordering rule expects.
        QuestSnapshot withUnresolved = new QuestSnapshot(
                "Delta world", "minecraft:overworld", false, "team-delta", "Delta team",
                pinsChanged.chapters(),
                List.of("QA0000000000001", "QC0000000000001", "EEEEEEEEEEEEEEEE"),
                pinsChanged.quests(),
                List.of("EEEEEEEEEEEEEEEE"),
                Instant.now().toString());
        for (SnapshotDiffer.Outbound message
                : differ.onSnapshot(session, withUnresolved, identity, false, now)) {
            write(out, index++, message);
        }

        System.out.println("differ harness OK: wrote " + (index - 1) + " messages to " + out);
    }

    private static void write(Path out, int index, SnapshotDiffer.Outbound message) throws Exception {
        String name = String.format("d-%02d-%s.json", index, message.type().replace('.', '-'));
        Files.writeString(out.resolve(name), message.json(), StandardCharsets.UTF_8);
        System.out.println("  " + name + "  sequence=" + sequenceOf(message.json()));
    }

    private static String sequenceOf(String json) {
        int at = json.indexOf("\"sequence\":");
        if (at < 0) {
            return "?";
        }
        int start = at + 11;
        int end = start;
        while (end < json.length() && Character.isDigit(json.charAt(end))) {
            end++;
        }
        return json.substring(start, end);
    }

    private static QuestSnapshot snapshot(
            int chapterProgress, List<String> resolvedPrefixes, List<String> pinPrefixes,
            List<String> unresolved) {
        return snapshot(chapterProgress, resolvedPrefixes, pinPrefixes, unresolved, 0L);
    }

    /**
     * @param resolvedPrefixes quests that are resolved and pinned
     * @param pinPrefixes      manual pin ids; must match resolved ids or be listed unresolved
     */
    private static QuestSnapshot snapshot(
            int chapterProgress, List<String> resolvedPrefixes, List<String> pinPrefixes,
            List<String> unresolved, long taskProgress) {
        QuestSnapshot.Chapter chapter = new QuestSnapshot.Chapter(
                "C0000000000001", "Delta chapter", null, 0, chapterProgress, "available");

        List<QuestSnapshot.Quest> quests = resolvedPrefixes.stream()
                .map(prefix -> new QuestSnapshot.Quest(
                        questId(prefix), "C0000000000001", "Quest " + prefix, null,
                        false, false, List.of(),
                        List.of(new QuestSnapshot.Task(
                                "T" + prefix + "00000000001", "ftbquests:item", "Item",
                                false, new QuestSnapshot.TaskProgress(
                                        "in_progress", taskProgress, 10L, (int) taskProgress))),
                        new QuestSnapshot.QuestProgress("in_progress", 0, 1, (int) taskProgress)))
                .toList();

        List<String> manualPinIds = pinPrefixes.stream().map(DifferHarness::questId).toList();

        return new QuestSnapshot(
                "Delta world", "minecraft:overworld", false, "team-delta", "Delta team",
                List.of(chapter), manualPinIds, quests, unresolved, Instant.now().toString());
    }

    private static String questId(String prefix) {
        return prefix + "0000000000001";
    }

    private DifferHarness() {
    }
}
