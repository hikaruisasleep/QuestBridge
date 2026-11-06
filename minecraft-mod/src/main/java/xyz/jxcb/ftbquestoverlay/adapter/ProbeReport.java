package xyz.jxcb.ftbquestoverlay.adapter;

import java.util.List;

/**
 * FTB-independent view of the Stage 4A live probe. All values are captured on
 * the Minecraft client thread; this record and its nested records contain no
 * FTB or Minecraft types so transport code can consume them later.
 */
public record ProbeReport(
        String worldId,
        String dimension,
        String teamId,
        String teamName,
        String fileId,
        int chapterCount,
        List<ChapterProbe> expectedChapters,
        int manualPinCount,
        List<QuestProbe> pinnedQuests,
        List<String> unresolvedPinnedQuestIds,
        String fingerprint) {

    public record ChapterProbe(
            String id,
            String title,
            Integer progress,
            String status,
            boolean present) {
    }

    public record QuestProbe(
            String id,
            String chapterId,
            String title,
            String status,
            int progress,
            int completedTasks,
            int totalRequiredTasks,
            List<TaskProbe> tasks) {
    }

    public record TaskProbe(
            String id,
            String type,
            String title,
            boolean optional,
            String status,
            long current,
            long target,
            int percentage) {
    }
}
