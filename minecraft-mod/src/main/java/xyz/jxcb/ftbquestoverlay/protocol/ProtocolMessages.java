package xyz.jxcb.ftbquestoverlay.protocol;

import java.time.Instant;
import java.util.List;

import xyz.jxcb.ftbquestoverlay.adapter.QuestSnapshot;

/**
 * Encodes protocol v1 messages as JSON text.
 *
 * <p>The receiving side uses strict objects, so an extra field, a missing
 * required field, or a {@code null} where the schema expects a string is a hard
 * failure for the whole message. Every payload below is therefore written field
 * by field, and optional fields are omitted rather than emitted as {@code null}
 * wherever v1 requires that distinction:</p>
 *
 * <ul>
 *   <li>{@code chapter.subtitle} — optional; omitted when absent.</li>
 *   <li>{@code quest.description} — optional; omitted when absent.</li>
 *   <li>{@code task.title} — optional; omitted when absent.</li>
 *   <li>{@code task.progress.current}/{@code target} — omitted when FTB does not
 *       expose numeric progress. Never synthesized as {@code 0}/{@code 1}.</li>
 *   <li>{@code snapshot.worldName}/{@code dimension}/{@code teamId}/
 *       {@code teamName} — required but nullable; emitted as explicit JSON
 *       {@code null}, which is how protocol v1 says "unavailable".</li>
 * </ul>
 *
 * <p>{@code docs/protocol.md} section 4: protocol v1 is not extended additively.
 * Nothing here may add a field without a version change.</p>
 */
public final class ProtocolMessages {
    public static final int PROTOCOL_VERSION = 1;

    /** Envelope and payload builder pair, kept together to avoid a half-built message. */
    private ProtocolMessages() {
    }

    /** Starts an envelope with the fields every message carries. */
    public static Envelope envelope(String type, String sessionId, long sequence, Instant timestamp) {
        return new Envelope(type, sessionId, sequence, timestamp);
    }

    public record Envelope(String type, String sessionId, long sequence, Instant timestamp) {
        public String withPayload(JsonObjectBuilder payload) {
            JsonObjectBuilder root = new JsonObjectBuilder();
            root.number("protocolVersion", PROTOCOL_VERSION);
            root.string("type", type);
            root.string("timestamp", timestamp.toString());
            root.number("sequence", sequence);
            root.string("sessionId", sessionId);
            root.object("payload", builder -> builder.merge(payload));
            return root.build();
        }
    }

    // ---- Payloads -----------------------------------------------------

    public static JsonObjectBuilder helloPayload(
            String modVersion,
            String minecraftVersion,
            String neoForgeVersion,
            String ftbQuestsVersion,
            String ftbTeamsVersion) {
        JsonObjectBuilder payload = new JsonObjectBuilder();
        // All five are required non-empty strings. "unknown" is the sanctioned
        // value when detection fails; never omit the field or send an empty one.
        payload.string("modVersion", orUnknown(modVersion));
        payload.string("minecraftVersion", orUnknown(minecraftVersion));
        payload.string("neoForgeVersion", orUnknown(neoForgeVersion));
        payload.string("ftbQuestsVersion", orUnknown(ftbQuestsVersion));
        payload.string("ftbTeamsVersion", orUnknown(ftbTeamsVersion));
        return payload;
    }

    /**
     * @param detail must not contain server addresses, player names, or tokens
     */
    public static JsonObjectBuilder statusPayload(String phase, String detail) {
        JsonObjectBuilder payload = new JsonObjectBuilder();
        payload.string("phase", phase);
        if (detail != null) {
            payload.string("detail", detail);
        }
        return payload;
    }

    public static JsonObjectBuilder heartbeatPayload(boolean ready) {
        JsonObjectBuilder payload = new JsonObjectBuilder();
        payload.bool("ready", ready);
        return payload;
    }

    public static JsonObjectBuilder snapshotPayload(QuestSnapshot snapshot) {
        JsonObjectBuilder payload = new JsonObjectBuilder();
        // Required-but-nullable identity fields: explicit null is correct here.
        payload.nullableString("worldName", snapshot.worldName());
        payload.nullableString("dimension", snapshot.dimension());
        payload.bool("integratedServer", snapshot.integratedServer());
        payload.nullableString("teamId", snapshot.teamId());
        payload.nullableString("teamName", snapshot.teamName());

        payload.array("chapters", builder -> {
            for (QuestSnapshot.Chapter chapter : snapshot.chapters()) {
                builder.object(object -> {
                    object.string("id", chapter.id());
                    object.string("title", chapter.title());
                    if (chapter.subtitle() != null) {
                        object.string("subtitle", chapter.subtitle());
                    }
                    object.number("order", chapter.order());
                    object.nullableNumber("progress", chapter.progress());
                    object.string("status", chapter.status());
                });
            }
        });

        writeObjectiveSet(payload, snapshot.manualPinIds(), snapshot.quests(),
                snapshot.unresolvedPinnedQuestIds());

        payload.string("capturedAt", snapshot.capturedAt());
        return payload;
    }

    /**
     * The shared objective-set section of snapshot and pins payloads. The order
     * invariant is enforced by the host: {@code quests} must follow
     * {@code manualPinIds} with unresolved entries removed.
     */
    public static void writeObjectiveSet(
            JsonObjectBuilder payload,
            List<String> manualPinIds,
            List<QuestSnapshot.Quest> quests,
            List<String> unresolvedPinnedQuestIds) {
        payload.array("manualPinIds", builder -> {
            for (String id : manualPinIds) {
                builder.value(id);
            }
        });
        payload.array("quests", builder -> {
            for (QuestSnapshot.Quest quest : quests) {
                builder.object(object -> writeQuest(object, quest));
            }
        });
        payload.array("unresolvedPinnedQuestIds", builder -> {
            for (String id : unresolvedPinnedQuestIds) {
                builder.value(id);
            }
        });
    }

    public static void writeQuest(JsonObjectBuilder object, QuestSnapshot.Quest quest) {
        object.string("id", quest.id());
        object.string("chapterId", quest.chapterId());
        object.string("title", quest.title());
        if (quest.description() != null) {
            object.string("description", quest.description());
        }
        object.bool("optional", quest.optional());
        object.bool("hidden", quest.hidden());
        object.array("dependencies", builder -> {
            for (String dependency : quest.dependencies()) {
                builder.value(dependency);
            }
        });
        object.array("tasks", builder -> {
            for (QuestSnapshot.Task task : quest.tasks()) {
                builder.object(taskObject -> writeTask(taskObject, task));
            }
        });
        object.object("progress", progress -> {
            progress.string("status", quest.progress().status());
            progress.number("completedTasks", quest.progress().completedTasks());
            progress.number("totalRequiredTasks", quest.progress().totalRequiredTasks());
            progress.nullableNumber("percentage", quest.progress().percentage());
        });
    }

    public static void writeTask(JsonObjectBuilder object, QuestSnapshot.Task task) {
        object.string("id", task.id());
        object.string("type", task.type());
        if (task.title() != null) {
            object.string("title", task.title());
        }
        object.bool("optional", task.optional());
        object.object("progress", progress -> {
            progress.string("status", task.progress().status());
            // Omitted, not null: v1 rejects null here and a fabricated 0/1
            // would be indistinguishable from real data on the overlay.
            if (task.progress().current() != null) {
                progress.number("current", task.progress().current());
            }
            if (task.progress().target() != null) {
                progress.number("target", task.progress().target());
            }
            progress.nullableNumber("percentage", task.progress().percentage());
        });
    }

    private static String orUnknown(String value) {
        return value == null || value.isBlank() ? "unknown" : value;
    }
}
