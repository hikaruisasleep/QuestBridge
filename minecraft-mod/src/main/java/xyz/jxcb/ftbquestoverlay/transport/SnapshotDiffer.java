package xyz.jxcb.ftbquestoverlay.transport;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.locks.ReentrantLock;

import xyz.jxcb.ftbquestoverlay.adapter.QuestSnapshot;
import xyz.jxcb.ftbquestoverlay.protocol.JsonObjectBuilder;
import xyz.jxcb.ftbquestoverlay.protocol.ProtocolMessages;

/**
 * Computes the smallest message that conveys a change between two snapshots.
 *
 * <p>This class does no network I/O and no FTB access, so it is safe to run on
 * the transport thread and testable without Minecraft. The message-selection
 * table is {@code docs/phase-4-plan.md} section 7:</p>
 *
 * <pre>
 * identity change / reconnect            -> full snapshot
 * chapter progress or status change      -> minecraft.progress (changed chapters)
 * pinned quest or task change            -> minecraft.progress (changed quests)
 * pin set added/removed/unresolved       -> minecraft.pins (full objective set)
 * nothing changed                        -> nothing
 * </pre>
 *
 * <p>A progress update and a pin change in the same window are both sent, in
 * that order, because a pins message replaces the objective set atomically and
 * a progress message that referenced a removed quest would be ignored.</p>
 */
public final class SnapshotDiffer {
    private final ReentrantLock lock = new ReentrantLock();

    private QuestSnapshot lastSnapshot;
    private QuestSnapshot.Identity lastIdentity;
    private long sequence;

    /**
     * An encoded message ready to send.
     *
     * @param type the protocol message type, for logging and tests
     */
    public record Outbound(String type, String json) {
    }

    /** Resets the per-connection sequence; identity history is retained. */
    public void resetSequence() {
        lock.lock();
        try {
            sequence = 0;
        } finally {
            lock.unlock();
        }
    }

    /** Forgets the last snapshot, forcing the next one to be a full snapshot. */
    public void forget() {
        lock.lock();
        try {
            lastSnapshot = null;
            lastIdentity = null;
        } finally {
            lock.unlock();
        }
    }

    /**
     * Decides what to send for a new snapshot.
     *
     * @param forceFull when true, a full snapshot is always produced
     * @return zero or more encoded messages, in send order
     */
    public List<Outbound> onSnapshot(
            String sessionId,
            QuestSnapshot snapshot,
            QuestSnapshot.Identity identity,
            boolean forceFull,
            Instant now) {
        lock.lock();
        try {
            List<Outbound> outbound = new ArrayList<>(2);

            boolean identityChanged = lastIdentity == null
                    || lastSnapshot == null
                    || !lastIdentity.equals(identity)
                    // A different world or team makes old progress meaningless.
                    || !sameObjectiveIdentity(lastSnapshot, snapshot);

            if (forceFull || identityChanged) {
                outbound.add(new Outbound(
                        "minecraft.snapshot",
                        envelope("minecraft.snapshot", sessionId,
                                ProtocolMessages.snapshotPayload(snapshot), now)));

                lastSnapshot = snapshot;
                lastIdentity = identity;
                return outbound;
            }

            QuestSnapshot previous = lastSnapshot;

            List<QuestSnapshot.Chapter> changedChapters = changedChapters(previous, snapshot);
            List<QuestSnapshot.Quest> changedQuests = changedQuests(previous, snapshot);
            boolean pinsChanged = !previous.manualPinIds().equals(snapshot.manualPinIds())
                    || !previous.unresolvedPinnedQuestIds().equals(snapshot.unresolvedPinnedQuestIds());

            // A pins message carries the full objective set, so changed quests
            // that are part of the new set are already included there.
            if (changedQuests.size() > 0 && !pinsChanged) {
                outbound.add(new Outbound(
                        "minecraft.progress",
                        envelope("minecraft.progress", sessionId,
                                progressPayload(snapshot.capturedAt(), null, changedQuests), now)));
            }

            if (changedChapters.size() > 0 && !pinsChanged) {
                // Chapters are sent after quests so a quest update never refers
                // to progress that has not arrived yet.
                outbound.add(new Outbound(
                        "minecraft.progress",
                        envelope("minecraft.progress", sessionId,
                                progressPayload(snapshot.capturedAt(), changedChapters, null), now)));
            }

            if (pinsChanged) {
                outbound.add(new Outbound(
                        "minecraft.pins",
                        envelope("minecraft.pins", sessionId,
                                pinsPayload(snapshot), now)));
            }

            lastSnapshot = snapshot;
            return outbound;
        } finally {
            lock.unlock();
        }
    }

    /** Encodes a status message directly; it does not affect diff state. */
    public String status(String sessionId, String phase, String detail, Instant now) {
        lock.lock();
        try {
            return envelope("minecraft.status", sessionId,
                    ProtocolMessages.statusPayload(phase, detail), now);
        } finally {
            lock.unlock();
        }
    }

    public String heartbeat(String sessionId, boolean ready, Instant now) {
        lock.lock();
        try {
            return envelope("minecraft.heartbeat", sessionId,
                    ProtocolMessages.heartbeatPayload(ready), now);
        } finally {
            lock.unlock();
        }
    }

    public String hello(String sessionId, Versions versions, Instant now) {
        lock.lock();
        try {
            return envelope("minecraft.hello", sessionId,
                    ProtocolMessages.helloPayload(
                            versions.modVersion(),
                            versions.minecraftVersion(),
                            versions.neoForgeVersion(),
                            versions.ftbQuestsVersion(),
                            versions.ftbTeamsVersion()),
                    now);
        } finally {
            lock.unlock();
        }
    }

    public record Versions(
            String modVersion,
            String minecraftVersion,
            String neoForgeVersion,
            String ftbQuestsVersion,
            String ftbTeamsVersion) {
    }

    private String envelope(
            String type, String sessionId, xyz.jxcb.ftbquestoverlay.protocol.JsonObjectBuilder payload,
            Instant now) {
        sequence++;
        return ProtocolMessages.envelope(type, sessionId, sequence, now).withPayload(payload);
    }

    // ---- Diffing ------------------------------------------------------

    /** True when the world and team are unchanged, so progress is comparable. */
    static boolean sameObjectiveIdentity(QuestSnapshot previous, QuestSnapshot next) {
        return previous.teamId().equals(next.teamId())
                && previous.dimension().equals(next.dimension())
                && java.util.Objects.equals(previous.worldName(), next.worldName());
    }

    static List<QuestSnapshot.Chapter> changedChapters(
            QuestSnapshot previous, QuestSnapshot next) {
        java.util.Map<String, QuestSnapshot.Chapter> before = new java.util.HashMap<>();
        for (QuestSnapshot.Chapter chapter : previous.chapters()) {
            before.put(chapter.id(), chapter);
        }

        List<QuestSnapshot.Chapter> changed = new ArrayList<>();
        for (QuestSnapshot.Chapter chapter : next.chapters()) {
            QuestSnapshot.Chapter old = before.get(chapter.id());
            if (old == null
                    || !java.util.Objects.equals(old.progress(), chapter.progress())
                    || !old.status().equals(chapter.status())) {
                changed.add(chapter);
            }
        }
        return changed;
    }

    /**
     * Quests whose wire representation changed. Titles are included because a
     * translation sync can replace a placeholder after the first snapshot.
     */
    static List<QuestSnapshot.Quest> changedQuests(QuestSnapshot previous, QuestSnapshot next) {
        java.util.Map<String, QuestSnapshot.Quest> before = new java.util.HashMap<>();
        for (QuestSnapshot.Quest quest : previous.quests()) {
            before.put(quest.id(), quest);
        }

        List<QuestSnapshot.Quest> changed = new ArrayList<>();
        for (QuestSnapshot.Quest quest : next.quests()) {
            QuestSnapshot.Quest old = before.get(quest.id());
            if (old == null || !questWireEquals(old, quest)) {
                changed.add(quest);
            }
        }
        return changed;
    }

    /** Structural equality of everything a quest carries on the wire. */
    static boolean questWireEquals(QuestSnapshot.Quest a, QuestSnapshot.Quest b) {
        if (!a.id().equals(b.id())
                || !a.chapterId().equals(b.chapterId())
                || !a.title().equals(b.title())
                || !java.util.Objects.equals(a.description(), b.description())
                || a.optional() != b.optional()
                || a.hidden() != b.hidden()
                || !a.dependencies().equals(b.dependencies())
                || !a.progress().equals(b.progress())
                || a.tasks().size() != b.tasks().size()) {
            return false;
        }
        for (int index = 0; index < a.tasks().size(); index++) {
            QuestSnapshot.Task left = a.tasks().get(index);
            QuestSnapshot.Task right = b.tasks().get(index);
            if (!left.id().equals(right.id())
                    || !left.type().equals(right.type())
                    || !java.util.Objects.equals(left.title(), right.title())
                    || left.optional() != right.optional()
                    || !left.progress().equals(right.progress())) {
                return false;
            }
        }
        return true;
    }

    static JsonObjectBuilder progressPayload(
            String capturedAt,
            List<QuestSnapshot.Chapter> chapters,
            List<QuestSnapshot.Quest> quests) {
        JsonObjectBuilder payload = new JsonObjectBuilder();
        payload.string("capturedAt", capturedAt);

        if (chapters != null) {
            payload.array("chapters", builder -> {
                for (QuestSnapshot.Chapter chapter : chapters) {
                    builder.object(object -> {
                        object.string("chapterId", chapter.id());
                        object.nullableNumber("progress", chapter.progress());
                        object.string("status", chapter.status());
                    });
                }
            });
        }

        if (quests != null) {
            payload.array("quests", builder -> {
                for (QuestSnapshot.Quest quest : quests) {
                    builder.object(object -> ProtocolMessages.writeQuest(object, quest));
                }
            });
        }

        return payload;
    }

    static JsonObjectBuilder pinsPayload(QuestSnapshot snapshot) {
        JsonObjectBuilder payload = new JsonObjectBuilder();
        payload.string("capturedAt", snapshot.capturedAt());
        ProtocolMessages.writeObjectiveSet(payload, snapshot.manualPinIds(),
                snapshot.quests(), snapshot.unresolvedPinnedQuestIds());
        return payload;
    }

    /** Current outbound sequence, for tests and diagnostics. */
    public long sequence() {
        lock.lock();
        try {
            return sequence;
        } finally {
            lock.unlock();
        }
    }
}
