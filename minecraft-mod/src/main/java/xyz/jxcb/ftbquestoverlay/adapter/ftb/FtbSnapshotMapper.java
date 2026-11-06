package xyz.jxcb.ftbquestoverlay.adapter.ftb;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import dev.ftb.mods.ftbquests.quest.Chapter;
import dev.ftb.mods.ftbquests.quest.Quest;
import dev.ftb.mods.ftbquests.quest.QuestObject;
import dev.ftb.mods.ftbquests.quest.QuestObjectBase;
import dev.ftb.mods.ftbquests.quest.TeamData;
import dev.ftb.mods.ftbquests.quest.task.Task;
import it.unimi.dsi.fastutil.longs.LongSet;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;

import xyz.jxcb.ftbquestoverlay.QuestBridge;
import xyz.jxcb.ftbquestoverlay.adapter.QuestSnapshot;
import xyz.jxcb.ftbquestoverlay.protocol.Sanitizer;

/**
 * Projects live FTB Quests and Minecraft client state into protocol v1 models.
 *
 * <p>Every method here reads FTB or Minecraft state and must therefore run on
 * the Minecraft client thread. The mappings follow
 * {@code docs/phase-4-plan.md} section 5 and
 * {@code docs/ftb-quests-integration.md}; the non-obvious ones are commented
 * with the reason, not just the rule.</p>
 */
public final class FtbSnapshotMapper {
    /** FTB's automatic tracker. It is never a quest and must never be published. */
    public static final String AUTOMATIC_PIN_ID = "1";

    private static final UUID NIL_UUID = new UUID(0L, 0L);

    private FtbSnapshotMapper() {
    }

    public static List<QuestSnapshot.Chapter> mapChapters(
            List<Chapter> catalog, TeamData teamData) {
        List<QuestSnapshot.Chapter> chapters = new ArrayList<>(catalog.size());
        Set<String> seen = new HashSet<>();
        int skipped = 0;

        for (Chapter chapter : catalog) {
            String id = Sanitizer.id(QuestObjectBase.getCodeString(chapter));
            if (id == null || !seen.add(id)) {
                // A missing or duplicated ID cannot be represented in v1, and
                // order is a position, so a dropped chapter must not shift the
                // rest: order stays the catalog index.
                skipped++;
                continue;
            }

            chapters.add(new QuestSnapshot.Chapter(
                    id,
                    Sanitizer.requiredText(chapter.getTitle().getString(), "Untitled chapter"),
                    Sanitizer.optionalMultilineText(joinSubtitle(chapter.getRawSubtitle())),
                    chapters.size(),
                    Sanitizer.percentage(teamData.getRelativeProgress(chapter)),
                    chapterStatus(chapter, teamData)));
        }

        if (skipped > 0) {
            QuestBridge.LOGGER.warn(
                    "[QuestBridge] skipped {} chapter(s) with a missing or duplicate id", skipped);
        }
        return List.copyOf(chapters);
    }

    /**
     * Chapter progression availability, deliberately independent of visibility.
     *
     * <p>FTB has no chapter-level lock API. {@code Chapter.isVisible(teamData)}
     * is false for {@code alwaysInvisible} chapters and for chapters with no
     * visible quests, so using it here would report an intentionally hidden but
     * playable chapter as locked. Availability is derived from start state and
     * from quest-level {@code canStartTasks} instead.</p>
     */
    static String chapterStatus(Chapter chapter, TeamData teamData) {
        if (teamData.isCompleted(chapter)) {
            return "completed";
        }
        if (teamData.isStarted(chapter)) {
            return "available";
        }

        boolean hasRequiredQuest = false;
        for (Quest quest : chapter.getQuests()) {
            if (quest.isOptionalForProgression(teamData)) {
                continue;
            }
            hasRequiredQuest = true;
            if (teamData.canStartTasks(quest)) {
                return "available";
            }
        }

        return hasRequiredQuest ? "locked" : "available";
    }

    /**
     * Position of a quest within its chapter, used as the tie-breaker of the
     * QuestBridge fallback pin order.
     */
    static int questIndex(Quest quest) {
        int index = quest.getChapter().getQuests().indexOf(quest);
        return index >= 0 ? index : Integer.MAX_VALUE;
    }

    public static QuestSnapshot.Quest mapQuest(Quest quest, TeamData teamData) {
        int completedRequiredTasks = 0;
        int totalRequiredTasks = 0;
        List<QuestSnapshot.Task> tasks = new ArrayList<>(quest.getTasks().size());

        for (Task task : quest.getTasks()) {
            // Optional tasks must never prevent a quest from being complete, so
            // they are excluded from both counts, not just from the completed one.
            boolean optional = task.isOptionalForProgression(teamData);
            if (!optional) {
                totalRequiredTasks++;
                if (teamData.isCompleted(task)) {
                    completedRequiredTasks++;
                }
            }
            tasks.add(mapTask(task, teamData, optional));
        }

        return new QuestSnapshot.Quest(
                Sanitizer.id(QuestObjectBase.getCodeString(quest)),
                Sanitizer.id(QuestObjectBase.getCodeString(quest.getChapter())),
                Sanitizer.requiredText(quest.getTitle().getString(), "Untitled quest"),
                Sanitizer.optionalMultilineText(joinDescription(quest.getDescription())),
                quest.isOptional(),
                !quest.isVisible(teamData),
                quest.streamDependencies()
                        .map(dependency -> Sanitizer.id(QuestObjectBase.getCodeString(dependency)))
                        .filter(dependency -> dependency != null)
                        .toList(),
                List.copyOf(tasks),
                new QuestSnapshot.QuestProgress(
                        questStatus(quest, teamData),
                        completedRequiredTasks,
                        totalRequiredTasks,
                        Sanitizer.percentage(teamData.getRelativeProgress(quest))));
    }

    static String questStatus(Quest quest, TeamData teamData) {
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

    static QuestSnapshot.Task mapTask(Task task, TeamData teamData, boolean optional) {
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

        return new QuestSnapshot.Task(
                Sanitizer.id(QuestObjectBase.getCodeString(task)),
                Sanitizer.requiredText(task.getType().getTypeId().toString(), "ftbquests:unknown"),
                Sanitizer.optionalMultilineText(questObjectTitle(task)),
                optional,
                new QuestSnapshot.TaskProgress(
                        status,
                        Sanitizer.nonNegative(current),
                        Sanitizer.nonNegative(target),
                        Sanitizer.percentage(teamData.getRelativeProgress(task))));
    }

    private static String questObjectTitle(QuestObject object) {
        Component title = object.getTitle();
        return title == null ? null : title.getString();
    }

    /**
     * Chapter subtitle lines, joined for display. FTB 2101.1.30 exposes only a
     * subtitle, never a description, so this value is a subtitle.
     */
    static String joinSubtitle(List<String> lines) {
        if (lines == null || lines.isEmpty()) {
            return null;
        }
        String joined = String.join("\n", lines);
        return joined.isBlank() ? null : joined;
    }

    static String joinDescription(List<Component> lines) {
        if (lines == null || lines.isEmpty()) {
            return null;
        }
        StringBuilder builder = new StringBuilder();
        for (Component line : lines) {
            if (builder.length() > 0) {
                builder.append('\n');
            }
            builder.append(line.getString());
        }
        String joined = builder.toString();
        return joined.isBlank() ? null : joined;
    }

    // ---- Identity -----------------------------------------------------

    public static QuestSnapshot.Identity mapIdentity(
            Object questFile, TeamData teamData, Level level) {
        return new QuestSnapshot.Identity(
                fileIdentity(questFile),
                teamData.getTeamId().toString(),
                worldIdentity(level));
    }

    /**
     * Identity of the synchronized quest file. FTB exposes no stable file ID, so
     * object identity is used: a quest reload replaces
     * {@code ClientQuestFile.INSTANCE} with a new instance.
     */
    static String fileIdentity(Object questFile) {
        return questFile == null
                ? "none"
                : Integer.toHexString(System.identityHashCode(questFile));
    }

    /**
     * Identity of the loaded world. FTB exposes no world ID either; the level
     * object identity plus dimension catches world changes, and the server
     * address distinguishes servers that share a dimension.
     */
    static String worldIdentity(Level level) {
        if (level == null) {
            return "no-level";
        }
        return Integer.toHexString(System.identityHashCode(level))
                + ":" + level.dimension().location();
    }

    /**
     * Display-only world name: the integrated server's level name for
     * single-player, otherwise the multiplayer server's display name.
     * {@code null} is correct when neither is available; never an empty string.
     */
    public static String mapWorldName(Minecraft minecraft, boolean integratedServer) {
        try {
            if (integratedServer) {
                var server = minecraft.getSingleplayerServer();
                if (server != null && server.getWorldData() != null) {
                    String name = server.getWorldData().getLevelName();
                    return name == null || name.isBlank() ? null : name;
                }
                return null;
            }

            ServerData serverData = minecraft.getCurrentServer();
            if (serverData == null || serverData.name == null || serverData.name.isBlank()) {
                return null;
            }
            return serverData.name;
        } catch (RuntimeException exception) {
            return null;
        }
    }

    public static boolean isIntegratedServer(Minecraft minecraft) {
        return minecraft.isLocalServer();
    }
}
