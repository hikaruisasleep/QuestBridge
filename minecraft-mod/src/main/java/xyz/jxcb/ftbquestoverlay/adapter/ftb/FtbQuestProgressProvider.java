package xyz.jxcb.ftbquestoverlay.adapter.ftb;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

import dev.architectury.event.EventActor;
import dev.architectury.event.EventResult;
import dev.ftb.mods.ftbquests.client.ClientQuestFile;
import dev.ftb.mods.ftbquests.events.ObjectCompletedEvent;
import dev.ftb.mods.ftbquests.events.ObjectStartedEvent;
import dev.ftb.mods.ftbquests.quest.Chapter;
import dev.ftb.mods.ftbquests.quest.Quest;
import dev.ftb.mods.ftbquests.quest.QuestObjectBase;
import dev.ftb.mods.ftbquests.quest.TeamData;
import it.unimi.dsi.fastutil.longs.LongSet;

import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;

import xyz.jxcb.ftbquestoverlay.QuestBridge;
import xyz.jxcb.ftbquestoverlay.adapter.QuestProgressProvider;
import xyz.jxcb.ftbquestoverlay.adapter.QuestSnapshot;

/**
 * The only class that reads FTB Quests state.
 *
 * <p>All methods must be called on the Minecraft client thread. The class never
 * writes FTB state: it never calls {@code setQuestPinned}, never reconstructs
 * the automatic tracker, and never claims rewards.</p>
 */
public final class FtbQuestProgressProvider implements QuestProgressProvider {
    private static final UUID NIL_UUID = new UUID(0L, 0L);

    /**
     * Incremented by FTB start/completion events. Captures read and clear it so
     * a change that arrives mid-capture is not lost.
     */
    private final AtomicLong changeCounter = new AtomicLong();

    private final EventActor<ObjectStartedEvent<?>> startedListener = event -> {
        changeCounter.incrementAndGet();
        return EventResult.pass();
    };

    private final EventActor<ObjectCompletedEvent<?>> completedListener = event -> {
        changeCounter.incrementAndGet();
        return EventResult.pass();
    };

    private boolean registered;

    /**
     * Registers FTB listeners. Safe to call more than once; registration happens
     * once so a world reload cannot accumulate duplicate listeners.
     *
     * <p>On Minecraft 1.21.1 these Architectury events fire on the client thread.
     * The counter is atomic so that even an unexpected off-thread dispatch can
     * never corrupt state; no FTB state is read in the listener.</p>
     */
    public void registerListeners() {
        if (registered) {
            return;
        }
        ObjectStartedEvent.GENERIC.register(startedListener);
        ObjectCompletedEvent.GENERIC.register(completedListener);
        registered = true;
        QuestBridge.LOGGER.debug("[QuestBridge] FTB progress listeners registered");
    }

    /** Removes FTB listeners; used on client shutdown. */
    public void unregisterListeners() {
        if (!registered) {
            return;
        }
        try {
            ObjectStartedEvent.GENERIC.unregister(startedListener);
            ObjectCompletedEvent.GENERIC.unregister(completedListener);
        } catch (RuntimeException exception) {
            QuestBridge.LOGGER.debug("[QuestBridge] listener unregistration failed", exception);
        }
        registered = false;
    }

    @Override
    public long changeCounter() {
        return changeCounter.get();
    }

    @Override
    public void resetChangeCounter() {
        changeCounter.set(0L);
    }

    /**
     * Mirrors the readiness gate verified in
     * {@code docs/ftb-quests-integration.md}: a synchronized quest file plus
     * non-placeholder team data. {@code ClientQuestFile.exists()} alone is not
     * sufficient, because {@code selfTeamData} starts as a locked placeholder
     * with a nil UUID.
     */
    @Override
    public QuestProgressProvider.Unavailable unavailableReason() {
        if (Minecraft.getInstance().level == null) {
            return new QuestProgressProvider.Unavailable(
                    QuestProgressProvider.Unavailable.Phase.UNAVAILABLE, "No world loaded");
        }

        try {
            if (!ClientQuestFile.exists()) {
                return new QuestProgressProvider.Unavailable(
                        QuestProgressProvider.Unavailable.Phase.SYNCHRONIZING,
                        "Waiting for quest data from server");
            }

            ClientQuestFile file = ClientQuestFile.INSTANCE;
            if (file == null || file.selfTeamData == null) {
                return new QuestProgressProvider.Unavailable(
                        QuestProgressProvider.Unavailable.Phase.SYNCHRONIZING,
                        "Waiting for quest data from server");
            }

            TeamData teamData = file.selfTeamData;
            if (teamData.isLocked() || NIL_UUID.equals(teamData.getTeamId())) {
                return new QuestProgressProvider.Unavailable(
                        QuestProgressProvider.Unavailable.Phase.SYNCHRONIZING,
                        "Waiting for team data from server");
            }
        } catch (RuntimeException exception) {
            QuestBridge.LOGGER.debug("[QuestBridge] FTB readiness check failed", exception);
            return new QuestProgressProvider.Unavailable(
                    QuestProgressProvider.Unavailable.Phase.SYNCHRONIZING,
                    "Quest data not ready");
        }

        return null;
    }

    @Override
    public QuestSnapshot captureSnapshot() {
        if (!isAvailable()) {
            return null;
        }

        Minecraft minecraft = Minecraft.getInstance();
        Level level = minecraft.level;
        ClientQuestFile file = ClientQuestFile.INSTANCE;
        TeamData teamData = file.selfTeamData;

        // Titles may be placeholders until the translation table arrives; the
        // reconciliation loop refreshes them, so nothing here blocks on that.
        List<Chapter> catalog = file.getAllChapters();
        List<QuestSnapshot.Chapter> chapters = FtbSnapshotMapper.mapChapters(catalog, teamData);

        Pins pins = capturePins(file, teamData, minecraft.player, catalog,
                chapters.stream().map(QuestSnapshot.Chapter::id).collect(Collectors.toSet()));

        List<String> manualPinIds = new ArrayList<>(pins.resolvedOrder());
        manualPinIds.addAll(pins.unresolvedIds());
        boolean integratedServer = FtbSnapshotMapper.isIntegratedServer(minecraft);

        return new QuestSnapshot(
                FtbSnapshotMapper.mapWorldName(minecraft, integratedServer),
                level.dimension().location().toString(),
                integratedServer,
                teamData.getTeamId().toString(),
                teamData.getName(),
                chapters,
                manualPinIds,
                pins.quests(),
                pins.unresolvedIds(),
                Instant.now().toString());
    }

    @Override
    public QuestSnapshot.Identity identity() {
        Minecraft minecraft = Minecraft.getInstance();
        Object file = ClientQuestFile.exists() ? ClientQuestFile.INSTANCE : null;
        TeamData teamData = file instanceof ClientQuestFile clientFile
                ? clientFile.selfTeamData
                : null;

        return new QuestSnapshot.Identity(
                FtbSnapshotMapper.fileIdentity(file),
                teamData == null ? "none" : teamData.getTeamId().toString(),
                FtbSnapshotMapper.worldIdentity(minecraft.level));
    }

    /**
     * Reads the current player's manual pins from team data.
     *
     * <p>Pins are stored per player inside {@code TeamData}, while progression is
     * team-wide. The automatic tracker ID is removed before resolution, because
     * it is a mode flag rather than a quest, and manual pins may coexist with it.</p>
     */
    private static Pins capturePins(
            ClientQuestFile file,
            TeamData teamData,
            Player player,
            List<Chapter> catalog,
            Set<String> chapterIds) {
        if (player == null) {
            return new Pins(List.of(), List.of(), List.of());
        }

        LongSet pinned = teamData.getPinnedQuestIds(player);
        if (pinned == null || pinned.isEmpty()) {
            return new Pins(List.of(), List.of(), List.of());
        }

        // Collect as strings so the fallback ordering can match by code string
        // without re-parsing hex, and sort so output does not depend on the
        // iteration order of an unordered set.
        TreeSet<String> manualIds = new TreeSet<>();
        for (long pinId : pinned) {
            if (pinId == TeamData.AUTO_PIN_ID) {
                continue;
            }
            manualIds.add(QuestObjectBase.getCodeString(pinId));
        }

        List<Quest> resolved = new ArrayList<>();
        List<String> unresolved = new ArrayList<>();
        for (String manualId : manualIds) {
            Quest quest = file.getQuest(QuestObjectBase.parseHexId(manualId).orElse(0L));
            if (quest == null) {
                unresolved.add(manualId);
            } else {
                resolved.add(quest);
            }
        }

        // Fallback order: chapter catalog order, then quest order in the chapter.
        List<Quest> ordered = new ArrayList<>(resolved);
        ordered.sort(Comparator
                .comparingInt((Quest quest) -> indexOfChapter(catalog, quest))
                .thenComparingInt(FtbSnapshotMapper::questIndex));

        // A quest that maps to no usable ID or no known chapter cannot satisfy
        // protocol v1 (strict objects, and quest.chapterId must exist in the
        // catalog). It is withheld from all three arrays at once, because the
        // objective set is validated as a partition; it stays pinned in FTB and
        // is reported rather than silently dropped.
        List<QuestSnapshot.Quest> quests = new ArrayList<>(ordered.size());
        List<String> resolvedOrder = new ArrayList<>(ordered.size());
        int withheld = 0;
        for (Quest quest : ordered) {
            QuestSnapshot.Quest mapped = FtbSnapshotMapper.mapQuest(quest, teamData);
            if (mapped.id() == null
                    || mapped.chapterId() == null
                    || !chapterIds.contains(mapped.chapterId())) {
                withheld++;
                continue;
            }
            quests.add(mapped);
            resolvedOrder.add(mapped.id());
        }

        if (withheld > 0) {
            QuestBridge.LOGGER.warn(
                    "[QuestBridge] withheld {} pinned quest(s) that cannot be represented in protocol v1",
                    withheld);
        }

        unresolved.sort(Comparator.naturalOrder());

        return new Pins(List.copyOf(quests), List.copyOf(resolvedOrder), List.copyOf(unresolved));
    }

    private static int indexOfChapter(List<Chapter> catalog, Quest quest) {
        int index = catalog.indexOf(quest.getChapter());
        return index >= 0 ? index : Integer.MAX_VALUE;
    }

    /**
     * @param quests         resolved pins in fallback order
     * @param resolvedOrder  resolved pin IDs in fallback order
     * @param unresolvedIds  unresolved pin IDs, sorted ascending
     */
    private record Pins(
            List<QuestSnapshot.Quest> quests,
            List<String> resolvedOrder,
            List<String> unresolvedIds) {
    }
}
