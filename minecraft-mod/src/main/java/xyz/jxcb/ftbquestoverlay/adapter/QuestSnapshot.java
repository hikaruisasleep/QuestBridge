package xyz.jxcb.ftbquestoverlay.adapter;

import java.util.List;

/**
 * Immutable, FTB-independent view of the current quest state.
 *
 * <p>Every value is captured on the Minecraft client thread. Nothing in this
 * record or its nested records refers to an FTB or Minecraft type, so transport
 * code can serialize a snapshot without touching game state.</p>
 *
 * <p>Nullability follows protocol v1 exactly: a value that FTB does not expose
 * is {@code null} or absent, never a fabricated zero. In particular chapter
 * {@code progress} and task {@code current}/{@code target} are nullable because
 * the protocol requires them to be omitted when unavailable.</p>
 *
 * @param worldName display-only world or server name, or {@code null}
 * @param dimension current dimension location string
 * @param integratedServer whether the client owns an integrated server
 * @param teamName display-only team name, or {@code null}
 * @param capturedAt ISO 8601 instant, captured on the client thread
 */
public record QuestSnapshot(
        String worldName,
        String dimension,
        boolean integratedServer,
        String teamId,
        String teamName,
        List<QuestSnapshot.Chapter> chapters,
        List<String> manualPinIds,
        List<QuestSnapshot.Quest> quests,
        List<String> unresolvedPinnedQuestIds,
        String capturedAt) {

    public QuestSnapshot {
        chapters = List.copyOf(chapters);
        manualPinIds = List.copyOf(manualPinIds);
        quests = List.copyOf(quests);
        unresolvedPinnedQuestIds = List.copyOf(unresolvedPinnedQuestIds);
    }

    /**
     * @param subtitle chapter subtitle lines joined, or {@code null} when empty.
     *                 FTB Quests 2101.1.30 has no chapter description accessor;
     *                 this is a subtitle and must not be labelled a description.
     */
    public record Chapter(
            String id,
            String title,
            String subtitle,
            int order,
            Integer progress,
            String status) {
    }

    /**
     * @param percentage FTB relative progress, or {@code null} when unavailable
     */
    public record Quest(
            String id,
            String chapterId,
            String title,
            String description,
            boolean optional,
            boolean hidden,
            List<String> dependencies,
            List<Task> tasks,
            QuestProgress progress) {

        public Quest {
            dependencies = List.copyOf(dependencies);
            tasks = List.copyOf(tasks);
        }
    }

    public record QuestProgress(
            String status,
            int completedTasks,
            int totalRequiredTasks,
            Integer percentage) {
    }

    /**
     * @param current numeric progress when FTB exposes it, else {@code null}
     * @param target  required amount when FTB exposes it, else {@code null}
     */
    public record Task(
            String id,
            String type,
            String title,
            boolean optional,
            TaskProgress progress) {
    }

    public record TaskProgress(
            String status,
            Long current,
            Long target,
            Integer percentage) {
    }

    /**
     * The identity fields that force a full snapshot when any of them change:
     * a quest-file reload, a team change, or a world/server change.
     */
    public record Identity(
            String fileIdentity,
            String teamId,
            String worldIdentity) {
    }
}
