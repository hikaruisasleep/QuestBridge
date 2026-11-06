import java.time.Instant;
import java.util.List;

import xyz.jxcb.ftbquestoverlay.adapter.QuestSnapshot;
import xyz.jxcb.ftbquestoverlay.protocol.ProtocolMessages;
import xyz.jxcb.ftbquestoverlay.transport.SnapshotDiffer;

/**
 * Builds a protocol snapshot from REAL ATM10 TTS values observed in the live
 * client on 2026-11-06 (docs/testing-logs/2026-11-06-1.log).
 *
 * <p>What this does and does not prove: the ids, titles, progress values, pin
 * and task values below are transcribed from a real run, so the message proves
 * the ENCODER handles real ATM10 shapes (a 16-character hex id, a long chapter
 * title, an item task with target 1). It does NOT prove the FTB→snapshot mapper
 * ran correctly, because the mapper was not the thing that produced these
 * values. That still needs the 4F live session.</p>
 *
 * Usage: java RecordedFixtureHarness <output-dir>
 */
public final class RecordedFixtureHarness {
    public static void main(String[] args) throws Exception {
        java.nio.file.Path out = java.nio.file.Path.of(args[0]);
        java.nio.file.Files.createDirectories(out);

        QuestSnapshot.Chapter startingOut = new QuestSnapshot.Chapter(
                "3B0302DB5E77C3A2", "Chapter 1: Starting out", null, 0, 38, "available");
        QuestSnapshot.Chapter coolParts = new QuestSnapshot.Chapter(
                "28BCA5042050B140", "Chapter 2: The Cool Parts", null, 1, 0, "available");
        QuestSnapshot.Chapter allTheModium = new QuestSnapshot.Chapter(
                "67E7552FDA3245F5", "Chapter 3: AllTheModium", null, 2, 0, "available");
        QuestSnapshot.Chapter atmStar = new QuestSnapshot.Chapter(
                "634794CB36D61302", "Chapter 4: The ATM Star", null, 3, 0, "available");
        QuestSnapshot.Chapter creativeItems = new QuestSnapshot.Chapter(
                "571D32BADC77CDD0", "Chapter 5: Creative Items", null, 4, 0, "available");

        QuestSnapshot.Task squeezer = new QuestSnapshot.Task(
                "37413DB75C605F88", "ftbquests:item", "Squeezer", false,
                new QuestSnapshot.TaskProgress("incomplete", 0L, 1L, 0));
        QuestSnapshot.Task copperHammer = new QuestSnapshot.Task(
                "2F3F55EDC60018DA", "ftbquests:item", "Copper Ore Hammer", false,
                new QuestSnapshot.TaskProgress("incomplete", 0L, 1L, 0));

        QuestSnapshot.Quest easyOreDuping = new QuestSnapshot.Quest(
                "04ACC7E762537FB4", "3B0302DB5E77C3A2", "Easy Ore Duping", null,
                false, false, List.of(),
                List.of(squeezer, copperHammer),
                new QuestSnapshot.QuestProgress("available", 0, 2, 0));

        QuestSnapshot snapshot = new QuestSnapshot(
                null,
                "minecraft:overworld",
                true,
                "5d4e32e9-de11-4780-983e-c68102013a26",
                null,
                List.of(startingOut, coolParts, allTheModium, atmStar, creativeItems),
                List.of("04ACC7E762537FB4"),
                List.of(easyOreDuping),
                List.of(),
                "2026-11-07T00:00:00Z");

        String session = "recorded-0000-4000-8000-000000000000";
        SnapshotDiffer differ = new SnapshotDiffer();
        for (SnapshotDiffer.Outbound message : differ.onSnapshot(
                session, snapshot,
                new QuestSnapshot.Identity("file-recorded", "team-recorded", "level-recorded"),
                true, Instant.parse("2026-11-07T00:00:00Z"))) {
            java.nio.file.Files.writeString(
                    out.resolve("recorded-snapshot.json"), message.json(), java.nio.charset.StandardCharsets.UTF_8);
            System.out.println("wrote " + message.type() + " (" + message.json().length() + " chars)");
        }

        System.out.println(
                "real values used: 5 chapters, 1 pin (Easy Ore Duping), 2 item tasks, "
                        + "Starting out at 38%, team id from the live run");
        System.out.println(
                "NOTE: worldName and teamName are null here. The live run had "
                        + "\"crystxllize_#5d4e32e9\" as a team name, which contains a player name and "
                        + "is deliberately not committed (AGENTS.md 11.1).");
    }

    private RecordedFixtureHarness() {
    }
}
