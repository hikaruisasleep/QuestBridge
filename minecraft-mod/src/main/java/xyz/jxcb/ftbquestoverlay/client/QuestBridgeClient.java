package xyz.jxcb.ftbquestoverlay.client;

import java.util.List;

import net.minecraft.client.Minecraft;
import net.minecraft.world.level.Level;

import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.common.NeoForge;

import xyz.jxcb.ftbquestoverlay.QuestBridge;
import xyz.jxcb.ftbquestoverlay.adapter.ProbeReport;
import xyz.jxcb.ftbquestoverlay.adapter.ftb.FtbQuestProbe;

/**
 * Stage 4A client loop: wait for FTB's synchronized data, then emit a
 * structured diagnostic dump whenever the observed state changes.
 *
 * <p>FTB is read only from {@link FtbQuestProbe} on the client tick. Nothing
 * here is sent over the network yet.</p>
 */
public final class QuestBridgeClient {
    private static final int PROBE_INTERVAL_TICKS = 40;
    private static final boolean DEBUG = Boolean.getBoolean("questbridge.debug");

    private int ticksSinceProbe;
    private String lastFingerprint;
    private String lastUnavailableKey;

    public QuestBridgeClient() {
        NeoForge.EVENT_BUS.addListener(ClientTickEvent.Post.class, this::onClientTick);
    }

    private void onClientTick(ClientTickEvent.Post event) {
        if (++ticksSinceProbe < PROBE_INTERVAL_TICKS) {
            return;
        }
        ticksSinceProbe = 0;

        Minecraft minecraft = Minecraft.getInstance();
        Level level = minecraft.level;

        if (level == null) {
            markUnavailable("no world loaded");
            return;
        }

        if (!FtbQuestProbe.isReady()) {
            markUnavailable("waiting for FTB quest file and team data");
            return;
        }

        ProbeReport report;
        try {
            report = FtbQuestProbe.capture();
        } catch (RuntimeException exception) {
            QuestBridge.LOGGER.error("[QuestBridge 4A] FTB probe failed", exception);
            lastFingerprint = null;
            return;
        }

        if (report == null) {
            markUnavailable("FTB probe returned no data");
            return;
        }

        lastUnavailableKey = null;

        if (DEBUG || !report.fingerprint().equals(lastFingerprint)) {
            logReport(report);
            lastFingerprint = report.fingerprint();
        }
    }

    private void markUnavailable(String reason) {
        lastFingerprint = null;

        Minecraft minecraft = Minecraft.getInstance();
        String worldKey = minecraft.level == null
                ? "level=null"
                : Integer.toHexString(System.identityHashCode(minecraft.level))
                        + ":" + minecraft.level.dimension().location();
        String key = worldKey + "|" + reason;

        if (!key.equals(lastUnavailableKey)) {
            QuestBridge.LOGGER.info("[QuestBridge 4A] not ready: {} ({})", reason, worldKey);
            lastUnavailableKey = key;
        }
    }

    private static void logReport(ProbeReport report) {
        QuestBridge.LOGGER.info(
                "[QuestBridge 4A] READY world={} dim={} team={} teamName={} file={} chapters={} manualPins={} unresolved={}",
                report.worldId(),
                report.dimension(),
                report.teamId(),
                quote(report.teamName()),
                report.fileId(),
                report.chapterCount(),
                report.manualPinCount(),
                report.unresolvedPinnedQuestIds().size());

        for (ProbeReport.ChapterProbe chapter : report.expectedChapters()) {
            if (!chapter.present()) {
                QuestBridge.LOGGER.info(
                        "[QuestBridge 4A] chapter id={} MISSING",
                        chapter.id());
                continue;
            }

            QuestBridge.LOGGER.info(
                    "[QuestBridge 4A] chapter id={} title={} progress={} status={}",
                    chapter.id(),
                    quote(chapter.title()),
                    chapter.progress(),
                    chapter.status());
        }

        for (ProbeReport.QuestProbe quest : report.pinnedQuests()) {
            QuestBridge.LOGGER.info(
                    "[QuestBridge 4A] pin quest id={} chapter={} title={} status={} progress={} requiredTasks={}/{}",
                    quest.id(),
                    quest.chapterId(),
                    quote(quest.title()),
                    quest.status(),
                    quest.progress(),
                    quest.completedTasks(),
                    quest.totalRequiredTasks());

            for (ProbeReport.TaskProbe task : quest.tasks()) {
                QuestBridge.LOGGER.info(
                        "[QuestBridge 4A] task quest={} id={} type={} title={} status={} current={} target={} pct={} optional={}",
                        quest.id(),
                        task.id(),
                        task.type(),
                        quote(task.title()),
                        task.status(),
                        task.current(),
                        task.target(),
                        task.percentage(),
                        task.optional());
            }
        }

        List<String> unresolved = report.unresolvedPinnedQuestIds();
        for (String id : unresolved) {
            QuestBridge.LOGGER.info("[QuestBridge 4A] unresolved pin id={}", id);
        }
    }

    private static String quote(String value) {
        if (value == null) {
            return "null";
        }
        return '"' + value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r") + '"';
    }
}
