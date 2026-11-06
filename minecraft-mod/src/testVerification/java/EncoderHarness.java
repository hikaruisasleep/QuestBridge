import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import xyz.jxcb.ftbquestoverlay.adapter.QuestSnapshot;
import xyz.jxcb.ftbquestoverlay.protocol.JsonObjectBuilder;
import xyz.jxcb.ftbquestoverlay.protocol.ProtocolMessages;

/**
 * Development harness: builds synthetic snapshots with the real encoders and
 * writes protocol envelopes to disk, so they can be checked against the
 * TypeScript schemas by scripts/validate-snapshot.mjs.
 *
 * The data is synthetic on purpose. This verifies the ENCODER's wire shape, not
 * FTB compatibility; real data comes from the live client.
 *
 * Run with the mod's compiled classes and Gson on the classpath:
 *   java -cp <classes>:<gson> EncoderHarness <output-dir>
 */
public final class EncoderHarness {
    public static void main(String[] args) throws Exception {
        Path out = Path.of(args[0]);
        Files.createDirectories(out);

        String sessionId = "11111111-2222-4333-8444-555555555555";
        Instant now = Instant.parse("2026-11-07T00:00:00Z");

        // 1. hello
        String hello = ProtocolMessages.envelope("minecraft.hello", sessionId, 1, now)
                .withPayload(ProtocolMessages.helloPayload(
                        "0pre.2", "1.21.1", "21.1.250", "2101.1.30", null));
        write(out.resolve("hello.json"), hello);

        // 2. status
        String status = ProtocolMessages.envelope("minecraft.status", sessionId, 2, now)
                .withPayload(ProtocolMessages.statusPayload("synchronizing", "Waiting for quest data"));
        write(out.resolve("status.json"), status);

        // 3. heartbeat
        String heartbeat = ProtocolMessages.envelope("minecraft.heartbeat", sessionId, 3, now)
                .withPayload(ProtocolMessages.heartbeatPayload(true));
        write(out.resolve("heartbeat.json"), heartbeat);

        // 4. snapshot exercising every optional and nullable rule
        QuestSnapshot.Chapter nullProgressChapter = new QuestSnapshot.Chapter(
                "AAA0000000000001", "Chapter with unknown progress", "line one\nline two",
                0, null, "unknown");
        QuestSnapshot.Chapter completedChapter = new QuestSnapshot.Chapter(
                "AAA0000000000002", "Finished chapter", null, 1, 100, "completed");
        QuestSnapshot.Chapter lockedChapter = new QuestSnapshot.Chapter(
                "AAA0000000000003", "Locked chapter", null, 2, 0, "locked");

        QuestSnapshot.Task numericTask = new QuestSnapshot.Task(
                "BBB0000000000001", "ftbquests:item", "Gather iron",
                false, new QuestSnapshot.TaskProgress("in_progress", 12L, 64L, 18));
        QuestSnapshot.Task booleanTask = new QuestSnapshot.Task(
                "BBB0000000000002", "ftbquests:checkmark", null,
                true, new QuestSnapshot.TaskProgress("incomplete", null, null, 0));

        QuestSnapshot.Quest quest = new QuestSnapshot.Quest(
                "CCC0000000000001", "AAA0000000000001", "Make a machine", "Build it.\nThen power it.",
                false, false, List.of("CCC0000000000009"),
                List.of(numericTask, booleanTask),
                new QuestSnapshot.QuestProgress("in_progress", 0, 1, 50));

        QuestSnapshot snapshot = new QuestSnapshot(
                "ATM10 Skyblock", "minecraft:overworld", false,
                "3b16b5a6-2a1e-4a0b-8d6d-2f4d3a2b1c0e", "Team QuestBridge",
                List.of(nullProgressChapter, completedChapter, lockedChapter),
                List.of("CCC0000000000001", "DDD0000000000003"),
                List.of(quest),
                List.of("DDD0000000000003"),
                "2026-11-07T00:00:00Z");

        String snapshotJson = ProtocolMessages.envelope("minecraft.snapshot", sessionId, 4, now)
                .withPayload(ProtocolMessages.snapshotPayload(snapshot));
        write(out.resolve("snapshot.json"), snapshotJson);

        // 5. snapshot with no world identity available: explicit nulls
        QuestSnapshot bare = new QuestSnapshot(
                null, null, true, null, null, List.of(), List.of(), List.of(), List.of(),
                "2026-11-07T00:00:00Z");
        String bareJson = ProtocolMessages.envelope("minecraft.snapshot", sessionId, 5, now)
                .withPayload(ProtocolMessages.snapshotPayload(bare));
        write(out.resolve("snapshot-bare.json"), bareJson);

        System.out.println("encoder harness OK: wrote 6 messages to " + out);
        System.out.println("snapshot bytes (utf8) = " + snapshotJson.getBytes(StandardCharsets.UTF_8).length);
    }

    private static void write(Path path, String json) throws Exception {
        Files.writeString(path, json, StandardCharsets.UTF_8);
    }

    private EncoderHarness() {
    }
}
