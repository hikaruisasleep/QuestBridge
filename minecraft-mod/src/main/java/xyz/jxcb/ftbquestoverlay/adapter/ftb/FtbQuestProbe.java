package xyz.jxcb.ftbquestoverlay.adapter.ftb;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import dev.ftb.mods.ftbquests.client.ClientQuestFile;
import dev.ftb.mods.ftbquests.quest.BaseQuestFile;
import dev.ftb.mods.ftbquests.quest.Chapter;
import dev.ftb.mods.ftbquests.quest.Quest;
import dev.ftb.mods.ftbquests.quest.QuestObjectBase;
import dev.ftb.mods.ftbquests.quest.TeamData;
import dev.ftb.mods.ftbquests.quest.task.Task;
import it.unimi.dsi.fastutil.longs.LongSet;

import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;

import xyz.jxcb.ftbquestoverlay.adapter.ProbeReport;

/**
 * Stage 4A read-only probe. Every method that touches FTB or Minecraft state
 * must be called on the Minecraft client thread.
 *
 * <p>This class is intentionally diagnostic. It does not normalize the full
 * quest book, publish network messages, or mutate any FTB state.</p>
 */
public final class FtbQuestProbe {
    /**
     * The five chapters suggested for the initial ATM10 TTS overlay. These are
     * probe expectations only; they are not application configuration and do
     * not select chapter pins.
     */
    private static final List<String> EXPECTED_CHAPTER_IDS = List.of(
            "3B0302DB5E77C3A2",
            "28BCA5042050B140",
            "67E7552FDA3245F5",
            "634794CB36D61302",
            "571D32BADC77CDD0");

    private static final UUID NIL_UUID = new UUID(0L, 0L);

    private FtbQuestProbe() {
    }

    /**
     * Mirrors the readiness gate verified in docs/ftb-quests-integration.md:
     * a synchronized quest file plus non-placeholder team data.
     */
    public static boolean isReady() {
        if (!ClientQuestFile.exists()) {
            return false;
        }

        ClientQuestFile file = ClientQuestFile.INSTANCE;
        if (file == null || file.selfTeamData == null) {
            return false;
        }

        TeamData teamData = file.selfTeamData;
        return !teamData.isLocked() && !NIL_UUID.equals(teamData.getTeamId());
    }

    /**
     * Captures a diagnostic report, or {@code null} when the probe is not ready
     * or no client level is loaded.
     */
    public static ProbeReport capture() {
        Minecraft minecraft = Minecraft.getInstance();
        Level level = minecraft.level;
        if (level == null || !isReady()) {
            return null;
        }

        ClientQuestFile file = ClientQuestFile.INSTANCE;
        TeamData teamData = file.selfTeamData;

        String dimension = level.dimension().location().toString();
        String worldId = Integer.toHexString(System.identityHashCode(level)) + ":" + dimension;
        String fileId = Integer.toHexString(System.identityHashCode(file));

        List<ProbeReport.ChapterProbe> chapters = captureExpectedChapters(file, teamData);
        Pins pins = capturePins(file, teamData, minecraft.player);

        String fingerprint = fingerprint(worldId, teamData, fileId, file.getAllChapters().size(), chapters, pins);

        return new ProbeReport(
                worldId,
                dimension,
                teamData.getTeamId().toString(),
                teamData.getName(),
                fileId,
                file.getAllChapters().size(),
                chapters,
                pins.resolved().size() + pins.unresolved().size(),
                pins.resolved(),
                pins.unresolved(),
                fingerprint);
    }

    private static List<ProbeReport.ChapterProbe> captureExpectedChapters(BaseQuestFile file, TeamData teamData) {
        List<ProbeReport.ChapterProbe> chapters = new ArrayList<>(EXPECTED_CHAPTER_IDS.size());

        for (String id : EXPECTED_CHAPTER_IDS) {
            Optional<Long> numericId = QuestObjectBase.parseHexId(id);
            Chapter chapter = numericId.map(file::getChapter).orElse(null);

            if (chapter == null) {
                chapters.add(new ProbeReport.ChapterProbe(id, null, null, "missing", false));
                continue;
            }

            chapters.add(new ProbeReport.ChapterProbe(
                    id,
                    chapter.getTitle().getString(),
                    teamData.getRelativeProgress(chapter),
                    chapterStatus(chapter, teamData),
                    true));
        }

        return List.copyOf(chapters);
    }

    private static String chapterStatus(Chapter chapter, TeamData teamData) {
        if (teamData.isCompleted(chapter)) {
            return "completed";
        }
        if (chapter.isVisible(teamData)) {
            return "available";
        }
        return "locked";
    }

    private static Pins capturePins(BaseQuestFile file, TeamData teamData, Player player) {
        if (player == null) {
            return new Pins(List.of(), List.of());
        }

        LongSet pinnedIds = teamData.getPinnedQuestIds(player);
        List<Quest> resolved = new ArrayList<>();
        List<Long> unresolved = new ArrayList<>();

        for (long pinId : pinnedIds) {
            if (pinId == TeamData.AUTO_PIN_ID) {
                continue;
            }

            Quest quest = file.getQuest(pinId);
            if (quest == null) {
                unresolved.add(pinId);
            } else {
                resolved.add(quest);
            }
        }

        List<Chapter> catalog = file.getAllChapters();
        resolved.sort(Comparator
                .comparingInt((Quest quest) -> chapterIndex(catalog, quest))
                .thenComparingInt(FtbQuestProbe::questIndex));

        unresolved.sort(Long::compare);

        List<ProbeReport.QuestProbe> quests = resolved.stream()
                .map(quest -> captureQuest(quest, teamData))
                .toList();

        List<String> unresolvedIds = unresolved.stream()
                .map(QuestObjectBase::getCodeString)
                .toList();

        return new Pins(quests, unresolvedIds);
    }

    private static int chapterIndex(List<Chapter> catalog, Quest quest) {
        int index = catalog.indexOf(quest.getChapter());
        return index >= 0 ? index : Integer.MAX_VALUE;
    }

    private static int questIndex(Quest quest) {
        int index = quest.getChapter().getQuests().indexOf(quest);
        return index >= 0 ? index : Integer.MAX_VALUE;
    }

    private static ProbeReport.QuestProbe captureQuest(Quest quest, TeamData teamData) {
        int completedRequiredTasks = 0;
        int totalRequiredTasks = 0;
        List<ProbeReport.TaskProbe> tasks = new ArrayList<>(quest.getTasks().size());

        for (Task task : quest.getTasks()) {
            boolean optional = task.isOptionalForProgression(teamData);
            if (!optional) {
                totalRequiredTasks++;
                if (teamData.isCompleted(task)) {
                    completedRequiredTasks++;
                }
            }
            tasks.add(captureTask(quest, task, teamData, optional));
        }

        return new ProbeReport.QuestProbe(
                QuestObjectBase.getCodeString(quest),
                QuestObjectBase.getCodeString(quest.getChapter()),
                quest.getTitle().getString(),
                questStatus(quest, teamData),
                teamData.getRelativeProgress(quest),
                completedRequiredTasks,
                totalRequiredTasks,
                List.copyOf(tasks));
    }

    private static ProbeReport.TaskProbe captureTask(Quest quest, Task task, TeamData teamData, boolean optional) {
        long current = teamData.getProgress(task);
        long target = task.getMaxProgress();
        boolean completed = teamData.isCompleted(task) || (target > 0 && current >= target);

        String status;
        if (completed) {
            status = "completed";
        } else if (current > 0 || teamData.isStarted(task)) {
            status = "in_progress";
        } else {
            status = "incomplete";
        }

        return new ProbeReport.TaskProbe(
                QuestObjectBase.getCodeString(task),
                task.getType().getTypeId().toString(),
                task.getTitle().getString(),
                optional,
                status,
                current,
                target,
                teamData.getRelativeProgress(task));
    }

    private static String questStatus(Quest quest, TeamData teamData) {
        if (teamData.isCompleted(quest)) {
            return "completed";
        }

        boolean hasTaskProgress = false;
        for (Task task : quest.getTasks()) {
            if (teamData.getProgress(task) > 0) {
                hasTaskProgress = true;
                break;
            }
        }

        if (teamData.isStarted(quest) || hasTaskProgress) {
            return "in_progress";
        }
        if (!teamData.canStartTasks(quest)) {
            return "locked";
        }
        return "available";
    }

    private static String fingerprint(
            String worldId,
            TeamData teamData,
            String fileId,
            int chapterCount,
            List<ProbeReport.ChapterProbe> chapters,
            Pins pins) {
        StringBuilder builder = new StringBuilder(512);
        builder.append(worldId)
                .append('|').append(teamData.getTeamId())
                .append('|').append(teamData.getName())
                .append('|').append(fileId)
                .append('|').append(chapterCount);

        for (ProbeReport.ChapterProbe chapter : chapters) {
            builder.append("|c:")
                    .append(chapter.id())
                    .append(':').append(chapter.progress())
                    .append(':').append(chapter.status())
                    .append(':').append(chapter.title());
        }

        for (ProbeReport.QuestProbe quest : pins.resolved()) {
            builder.append("|q:")
                    .append(quest.id())
                    .append(':').append(quest.progress())
                    .append(':').append(quest.status())
                    .append(':').append(quest.completedTasks())
                    .append(':').append(quest.totalRequiredTasks())
                    .append(':').append(quest.title());

            for (ProbeReport.TaskProbe task : quest.tasks()) {
                builder.append("|t:")
                        .append(task.id())
                        .append(':').append(task.current())
                        .append(':').append(task.status())
                        .append(':').append(task.title());
            }
        }

        for (String unresolvedId : pins.unresolved()) {
            builder.append("|u:").append(unresolvedId);
        }

        return builder.toString();
    }

    private record Pins(List<ProbeReport.QuestProbe> resolved, List<String> unresolved) {
    }
}
