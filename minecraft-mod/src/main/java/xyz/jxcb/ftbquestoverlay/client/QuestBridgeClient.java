package xyz.jxcb.ftbquestoverlay.client;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.List;

import net.minecraft.client.Minecraft;
import net.minecraft.world.level.Level;

import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.level.LevelEvent;

import xyz.jxcb.ftbquestoverlay.QuestBridge;
import xyz.jxcb.ftbquestoverlay.adapter.ProbeReport;
import xyz.jxcb.ftbquestoverlay.adapter.QuestProgressProvider;
import xyz.jxcb.ftbquestoverlay.adapter.QuestSnapshot;
import xyz.jxcb.ftbquestoverlay.adapter.ftb.FtbQuestProbe;
import xyz.jxcb.ftbquestoverlay.adapter.ftb.FtbQuestProgressProvider;
import xyz.jxcb.ftbquestoverlay.protocol.ProtocolMessages;

/**
 * Client loop.
 *
 * <p>Owns the only place where FTB and Minecraft state is read: the client
 * tick, every {@value #PROBE_INTERVAL_TICKS} ticks. Nothing here performs
 * network I/O; a captured, immutable {@link QuestSnapshot} is handed to the
 * transport, which serializes it off the client thread.</p>
 *
 * <p>Stage 4B publishes nothing yet. It logs the Stage 4A diagnostic report and,
 * when {@code -Dquestbridge.dumpSnapshot=<path>} is set, appends the encoded
 * {@code minecraft.snapshot} envelope so the real wire shape can be validated
 * against {@code @questbridge/protocol}.</p>
 */
public final class QuestBridgeClient {
    private static final int PROBE_INTERVAL_TICKS = 40;
    private static final boolean DEBUG = Boolean.getBoolean("questbridge.debug");
    /** Development-only: write each snapshot envelope here for schema checks. */
    private static final String DUMP_PATH = System.getProperty("questbridge.dumpSnapshot");

    private final FtbQuestProgressProvider provider = new FtbQuestProgressProvider();
    private final String sessionId = java.util.UUID.randomUUID().toString();

    private long sequence;
    private int ticksSinceProbe;
    private String lastFingerprint;
    private String lastUnavailableKey;
    /** Set when a world, player, or team change makes the next capture meaningful. */
    private boolean forceCapture;

    public QuestBridgeClient() {
        provider.registerListeners();
        NeoForge.EVENT_BUS.addListener(ClientTickEvent.Post.class, this::onClientTick);
        // World and player transitions invalidate everything previously captured.
        NeoForge.EVENT_BUS.addListener(LevelEvent.Load.class, event -> invalidate("level loaded"));
        NeoForge.EVENT_BUS.addListener(LevelEvent.Unload.class, event -> invalidate("level unloaded"));
        NeoForge.EVENT_BUS.addListener(
                ClientPlayerNetworkEvent.LoggingIn.class, event -> invalidate("login"));
        NeoForge.EVENT_BUS.addListener(
                ClientPlayerNetworkEvent.LoggingOut.class, event -> invalidate("logout"));
    }

    private void invalidate(String reason) {
        forceCapture = true;
        lastFingerprint = null;
        QuestBridge.LOGGER.debug("[QuestBridge] capture invalidated: {}", reason);
    }

    private void onClientTick(ClientTickEvent.Post event) {
        if (++ticksSinceProbe < PROBE_INTERVAL_TICKS) {
            return;
        }
        ticksSinceProbe = 0;

        Minecraft minecraft = Minecraft.getInstance();
        Level level = minecraft.level;

        if (level == null) {
            publishUnavailable(new QuestProgressProvider.Unavailable(
                    QuestProgressProvider.Unavailable.Phase.UNAVAILABLE, "No world loaded"));
            return;
        }

        QuestProgressProvider.Unavailable unavailable = provider.unavailableReason();
        if (unavailable != null) {
            publishUnavailable(unavailable);
            return;
        }

        QuestSnapshot snapshot;
        try {
            snapshot = provider.captureSnapshot();
        } catch (RuntimeException exception) {
            QuestBridge.LOGGER.error("[QuestBridge] snapshot capture failed", exception);
            lastFingerprint = null;
            return;
        }

        if (snapshot == null) {
            publishUnavailable(new QuestProgressProvider.Unavailable(
                    QuestProgressProvider.Unavailable.Phase.SYNCHRONIZING,
                    "Quest data not ready"));
            return;
        }

        lastUnavailableKey = null;
        forceCapture = false;
        provider.resetChangeCounter();

        String fingerprint = fingerprint(snapshot);
        if (DEBUG || forceCapture || !fingerprint.equals(lastFingerprint)) {
            logSnapshot(snapshot);
            dumpEnvelope(snapshot);
            lastFingerprint = fingerprint;
        }

        // Keep the Stage 4A diagnostic channel while 4B is being verified. It
        // reports the five expected chapters with FTB's visibility details,
        // which protocol v1 deliberately does not carry.
        logProbeIfChanged();
    }

    private void publishUnavailable(QuestProgressProvider.Unavailable unavailable) {
        lastFingerprint = null;

        Minecraft minecraft = Minecraft.getInstance();
        String worldKey = minecraft.level == null
                ? "level=null"
                : Integer.toHexString(System.identityHashCode(minecraft.level))
                        + ":" + minecraft.level.dimension().location();
        String key = worldKey + "|" + unavailable.phase() + "|" + unavailable.detail();

        if (!key.equals(lastUnavailableKey)) {
            QuestBridge.LOGGER.info(
                    "[QuestBridge] not ready: {} (phase={}, {})",
                    unavailable.detail(),
                    unavailable.phase(),
                    worldKey);
            lastUnavailableKey = key;
        }
    }

    // ---- Stage 4B: protocol encoding ----------------------------------

    private void dumpEnvelope(QuestSnapshot snapshot) {
        if (DUMP_PATH == null) {
            return;
        }

        String envelope = ProtocolMessages.envelope(
                        "minecraft.snapshot", sessionId, ++sequence, Instant.now())
                .withPayload(ProtocolMessages.snapshotPayload(snapshot));

        try {
            Path path = Path.of(DUMP_PATH);
            Path parent = path.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.writeString(
                    path,
                    envelope + System.lineSeparator(),
                    StandardOpenOption.CREATE,
                    StandardOpenOption.APPEND);
        } catch (IOException | RuntimeException exception) {
            QuestBridge.LOGGER.warn("[QuestBridge] could not write snapshot dump", exception);
        }
    }

    /**
     * Change fingerprint. It covers everything the wire carries, so a change in
     * titles after a translation sync also registers.
     */
    static String fingerprint(QuestSnapshot snapshot) {
        StringBuilder builder = new StringBuilder(1024);
        builder.append(snapshot.worldName()).append('|')
                .append(snapshot.teamId()).append('|')
                .append(snapshot.dimension());

        for (QuestSnapshot.Chapter chapter : snapshot.chapters()) {
            builder.append("|c:").append(chapter.id())
                    .append(':').append(chapter.title())
                    .append(':').append(chapter.progress())
                    .append(':').append(chapter.status())
                    .append(':').append(chapter.subtitle());
        }

        builder.append("|p:").append(String.join(",", snapshot.manualPinIds()));
        builder.append("|u:").append(String.join(",", snapshot.unresolvedPinnedQuestIds()));

        for (QuestSnapshot.Quest quest : snapshot.quests()) {
            builder.append("|q:").append(quest.id())
                    .append(':').append(quest.title())
                    .append(':').append(quest.progress().status())
                    .append(':').append(quest.progress().completedTasks())
                    .append('/').append(quest.progress().totalRequiredTasks());

            for (QuestSnapshot.Task task : quest.tasks()) {
                builder.append("|t:").append(task.id())
                        .append(':').append(task.progress().status())
                        .append(':').append(task.progress().current())
                        .append('/').append(task.progress().target());
            }
        }

        return builder.toString();
    }

    private static void logSnapshot(QuestSnapshot snapshot) {
        QuestBridge.LOGGER.info(
                "[QuestBridge 4B] SNAPSHOT world={} dim={} integrated={} team={} teamName={} chapters={} manualPins={} resolved={} unresolved={} capturedAt={}",
                quote(snapshot.worldName()),
                snapshot.dimension(),
                snapshot.integratedServer(),
                snapshot.teamId(),
                quote(snapshot.teamName()),
                snapshot.chapters().size(),
                snapshot.manualPinIds().size(),
                snapshot.quests().size(),
                snapshot.unresolvedPinnedQuestIds().size(),
                snapshot.capturedAt());

        for (QuestSnapshot.Quest quest : snapshot.quests()) {
            QuestBridge.LOGGER.info(
                    "[QuestBridge 4B] pin quest id={} chapter={} title={} status={} pct={} requiredTasks={}/{} optional={} hidden={}",
                    quest.id(),
                    quest.chapterId(),
                    quote(quest.title()),
                    quest.progress().status(),
                    quest.progress().percentage(),
                    quest.progress().completedTasks(),
                    quest.progress().totalRequiredTasks(),
                    quest.optional(),
                    quest.hidden());

            for (QuestSnapshot.Task task : quest.tasks()) {
                QuestBridge.LOGGER.info(
                        "[QuestBridge 4B] task quest={} id={} type={} title={} status={} current={} target={} pct={} optional={}",
                        quest.id(),
                        task.id(),
                        task.type(),
                        quote(task.title()),
                        task.progress().status(),
                        task.progress().current(),
                        task.progress().target(),
                        task.progress().percentage(),
                        task.optional());
            }
        }

        for (String id : snapshot.unresolvedPinnedQuestIds()) {
            QuestBridge.LOGGER.info("[QuestBridge 4B] unresolved pin id={}", id);
        }
    }

    // ---- Stage 4A: diagnostic probe -----------------------------------

    private String lastProbeFingerprint;

    private void logProbeIfChanged() {
        ProbeReport report;
        try {
            report = FtbQuestProbe.capture();
        } catch (RuntimeException exception) {
            QuestBridge.LOGGER.error("[QuestBridge 4A] FTB probe failed", exception);
            return;
        }

        if (report == null) {
            return;
        }

        if (DEBUG || !report.fingerprint().equals(lastProbeFingerprint)) {
            logReport(report);
            lastProbeFingerprint = report.fingerprint();
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
                    "[QuestBridge 4A] chapter id={} title={} progress={} status={} visible={} explicitlyHidden={}",
                    chapter.id(),
                    quote(chapter.title()),
                    chapter.progress(),
                    chapter.status(),
                    chapter.visible(),
                    chapter.explicitlyHidden());
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
