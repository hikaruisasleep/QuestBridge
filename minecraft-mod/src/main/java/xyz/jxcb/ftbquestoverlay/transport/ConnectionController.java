package xyz.jxcb.ftbquestoverlay.transport;

import java.time.Instant;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import xyz.jxcb.ftbquestoverlay.protocol.ProtocolJson;

/**
 * Owns the connection lifecycle: connect, hello, welcome, snapshot, heartbeat,
 * reconnect with backoff, and coalescing client captures.
 *
 * <p>Threading model: every public method may be called from the client thread
 * and returns immediately. All encoding and I/O happens on the single transport
 * executor. The client thread publishes an immutable {@link SnapshotSink.Handoff}
 * and never waits for the network.</p>
 *
 * <p>Coalescing: at most one handoff is pending. A newer capture replaces an
 * older pending one rather than queueing, so a burst of FTB events cannot build
 * an unbounded backlog of stale snapshots to serialize.</p>
 */
public final class ConnectionController implements SnapshotSink {
    /** Reconnect delays in milliseconds: 1, 2, 4, 8, 16, 30 s, capped. */
    static final long[] BACKOFF_MS = {1_000, 2_000, 4_000, 8_000, 16_000, 30_000};

    /** Times to retry a capture that was pending while disconnected. */
    private static final long SNAPSHOT_RETRY_MS = 1_000;

    /** Protocol frame limit; the host rejects anything larger. */
    static final int MAX_MESSAGE_BYTES = 262_144;

    private final String url;
    private final String bearerToken;
    private final String sessionId;
    private final SnapshotDiffer.Versions versions;
    private final SnapshotDiffer differ = new SnapshotDiffer();

    private final TransportExecutor transportExecutor = TransportExecutor.create();
    private final ScheduledExecutorService executor = transportExecutor.executor();

    /** Latest capture waiting to be processed; newer replaces older. */
    private final AtomicReference<Handoff> pending = new AtomicReference<>();
    /** Set when a request_snapshot arrives; forces a full snapshot. */
    private final java.util.concurrent.atomic.AtomicBoolean forceFull =
            new java.util.concurrent.atomic.AtomicBoolean(true);

    private final AtomicLong backoffIndex = new AtomicLong();

    private volatile WebSocketConnection connection;
    private volatile long heartbeatIntervalMs = 5_000;
    private volatile boolean ready;
    private volatile boolean stopped;
    private volatile boolean snapshotReceived;
    private volatile int lastStatusHash;

    public ConnectionController(
            String url, String bearerToken, String sessionId, SnapshotDiffer.Versions versions) {
        this.url = url;
        this.bearerToken = bearerToken;
        this.sessionId = sessionId;
        this.versions = versions;
    }

    public void start() {
        executor.execute(this::connect);
    }

    /**
     * Called from the client thread. Must not block: it only stores a reference.
     */
    @Override
    public void offer(Handoff handoff) {
        if (stopped) {
            return;
        }
        pending.set(handoff);
        try {
            if (executor.isShutdown()) {
                executeAfterShutdown.incrementAndGet();
                return;
            }
            executor.execute(this::drainSafely);
            executesAccepted.incrementAndGet();
        } catch (RejectedExecutionException exception) {
            // Shutdown in progress; dropping is correct.
            executeRejected.incrementAndGet();
        }
    }

    /**
     * Wraps {@link #drain()} so a transport bug is reported once, loudly, instead
     * of letting a scheduled task die silently and look like a dropped message.
     */
    private void drainSafely() {
        try {
            drain();
        } catch (RuntimeException exception) {
            drainFailures.incrementAndGet();
            TransportLog.error("[QuestBridge] transport drain failed", exception);
        }
    }

    /** Requests a full snapshot on the next capture, e.g. after a host demand. */
    public void requestFullSnapshot() {
        forceFull.set(true);
    }

    public void stop() {
        stopped = true;
        transportExecutor.shutdownNow();
        WebSocketConnection current = connection;
        if (current != null) {
            current.close();
        }
    }

    // ---- Transport thread --------------------------------------------

    private void connect() {
        if (stopped) {
            return;
        }

        WebSocketConnection.Listener listener = new WebSocketConnection.Listener() {
            @Override
            public void onText(String text) {
                handleHostMessage(text);
            }

            @Override
            public void onClosed(String reason) {
                handleClosed(reason);
            }
        };

        WebSocketConnection opened;
        try {
            opened = WebSocketConnection.open(url, bearerToken, listener);
        } catch (RuntimeException exception) {
            handshakeFailures.incrementAndGet();
            String reason = exception instanceof WebSocketConnection.ConnectionException
                    ? exception.getMessage()
                    : exception.getClass().getSimpleName();
            scheduleReconnect(reason);
            return;
        }

        connects.incrementAndGet();
        connection = opened;
        differ.resetSequence();
        differ.forget();
        forceFull.set(true);
        snapshotReceived = false;
        lastStatusHash = 0;

        try {
            opened.sendText(differ.hello(sessionId, versions, Instant.now()));
            ready = false;
            sendStatus("unavailable", "Connected to QuestBridge host");
            TransportLog.info(
                    "[QuestBridge] connected to host ({}); hello sent", describeEndpoint());
        } catch (WebSocketConnection.ConnectionException exception) {
            sendFailures.incrementAndGet();
            scheduleReconnect(exception.getMessage());
            return;
        }

        backoffIndex.set(0);
        lastLoggedStage = -1;
        scheduleHeartbeat();

        // Send a fresh full snapshot for this connection, as the protocol
        // requires after every (re)connect.
        Handoff latest = pending.get();
        if (latest != null) {
            drain();
        }
    }

    private void scheduleHeartbeat() {
        if (stopped) {
            return;
        }
        try {
            executor.schedule(this::heartbeatTick, heartbeatIntervalMs, TimeUnit.MILLISECONDS);
        } catch (RejectedExecutionException exception) {
            // Shutting down.
        }
    }

    private void heartbeatTick() {
        if (stopped) {
            return;
        }
        WebSocketConnection current = connection;
        if (current == null || !current.isOpen()) {
            return;
        }
        try {
            current.sendText(differ.heartbeat(sessionId, ready, Instant.now()));
            heartbeatsSent.incrementAndGet();
        } catch (WebSocketConnection.ConnectionException exception) {
            handleClosed(exception.getMessage());
            return;
        }
        scheduleHeartbeat();
    }

    /** Handles a socket closure and schedules the reconnect. */
    private void handleClosed(String reason) {
        WebSocketConnection current = connection;
        connection = null;
        closeEvents.incrementAndGet();
        if (current != null) {
            current.close();
        }
        if (stopped) {
            return;
        }
        TransportLog.info("host connection closed (%s)", reason);
        // A closed socket starts the backoff over, so a host restart is picked
        // up within a second rather than waiting out the previous delay.
        backoffIndex.set(0);
        lastLoggedStage = -1;
        scheduleReconnect(reason);
    }

    private void scheduleReconnect(String reason) {
        if (stopped) {
            return;
        }
        long stage = backoffIndex.get();
        // Log once per backoff stage: a host that is simply not running must not
        // fill the log with one line per retry.
        if (lastLoggedStage != stage) {
            lastLoggedStage = stage;
            long delay = BACKOFF_MS[(int) Math.min(stage, BACKOFF_MS.length - 1)];
            TransportLog.info("host unavailable (%s); retrying in %d ms", reason, delay);
        }
        long delay = BACKOFF_MS[(int) Math.min(stage, BACKOFF_MS.length - 1)];
        backoffIndex.set(Math.min(stage + 1, BACKOFF_MS.length - 1));

        try {
            executor.schedule(this::connect, delay, TimeUnit.MILLISECONDS);
        } catch (RejectedExecutionException exception) {
            // Shutting down.
        }
    }

    private long lastLoggedStage = -1;

    /** Processes the pending capture, if any. */
    private void drain() {
        drains.incrementAndGet();
        if (stopped) {
            return;
        }
        Handoff handoff = pending.getAndSet(null);
        WebSocketConnection current = connection;
        if (current == null || !current.isOpen()) {
            if (handoff != null) {
                // Retain it: the next successful connect publishes a snapshot.
                pending.compareAndSet(null, handoff);
            }
            return;
        }

        if (handoff == null) {
            return;
        }

        if (!handoff.ready() || handoff.snapshot() == null) {
            ready = false;
            sendStatus(handoff.phase(), handoff.detail());
            return;
        }
        ready = true;
        sendStatus("ready", null);

        List<SnapshotDiffer.Outbound> outbound;
        try {
            outbound = differ.onSnapshot(
                    sessionId,
                    handoff.snapshot(),
                    handoff.identity(),
                    forceFull.getAndSet(false),
                    Instant.now());
        } catch (RuntimeException exception) {
            TransportLog.error("[QuestBridge] encoding failed", exception);
            forceFull.set(true);
            return;
        }

        for (SnapshotDiffer.Outbound message : outbound) {
            int bytes = message.json().getBytes(ProtocolJson.UTF8).length;
            if (bytes > MAX_MESSAGE_BYTES) {
                // Never send a frame the host will reject: it closes the
                // connection. Log the size and skip this update.
                oversizeSkips.incrementAndGet();
                TransportLog.error(
                        "[QuestBridge] refusing to send {} of {} bytes (limit {}); skipping",
                        message.type(), bytes, MAX_MESSAGE_BYTES);
                continue;
            }
            try {
                current.sendText(message.json());
                lastSendBytes.set(bytes);
                switch (message.type()) {
                    case "minecraft.snapshot" -> snapshotsSent.incrementAndGet();
                    case "minecraft.progress" -> progressSent.incrementAndGet();
                    case "minecraft.pins" -> pinsSent.incrementAndGet();
                    default -> {
                    }
                }
                if ("minecraft.snapshot".equals(message.type())) {
                    if (!snapshotReceived) {
                        snapshotReceived = true;
                        TransportLog.info(
                                "[QuestBridge] published full snapshot ({} bytes, {} chapters, {} quests)",
                                bytes,
                                handoff.snapshot().chapters().size(),
                                handoff.snapshot().quests().size());
                    }
                } else {
                    TransportLog.debug(
                            "[QuestBridge] published {} ({} bytes)", message.type(), bytes);
                }
            } catch (WebSocketConnection.ConnectionException exception) {
                sendFailures.incrementAndGet();
                handleClosed(exception.getMessage());
                return;
            }
        }
    }

    /** Sends a status message only when the phase or detail changed. */
    private void sendStatus(String phase, String detail) {
        WebSocketConnection current = connection;
        if (current == null || !current.isOpen() || phase == null) {
            return;
        }
        int hash = (phase + "|" + (detail == null ? "" : detail)).hashCode();
        if (hash == lastStatusHash) {
            return;
        }
        lastStatusHash = hash;
        try {
            current.sendText(differ.status(sessionId, phase, detail, Instant.now()));
            statusSent.incrementAndGet();
            TransportLog.debug("[QuestBridge] status {}{}",
                    phase, detail == null ? "" : ": " + detail);
        } catch (WebSocketConnection.ConnectionException exception) {
            sendFailures.incrementAndGet();
            handleClosed(exception.getMessage());
        }
    }

    private void handleHostMessage(String text) {
        JsonObject root;
        try {
            root = JsonParser.parseString(text).getAsJsonObject();
        } catch (RuntimeException exception) {
            TransportLog.warn("[QuestBridge] ignored a non-object host message");
            return;
        }

        String type = root.has("type") ? root.get("type").getAsString() : "";
        switch (type) {
            case "host.welcome" -> {
                JsonObject payload = root.getAsJsonObject("payload");
                long heartbeat = payload.has("heartbeatIntervalMs")
                        ? payload.get("heartbeatIntervalMs").getAsLong()
                        : heartbeatIntervalMs;
                heartbeatIntervalMs = Math.max(1_000, heartbeat);
                TransportLog.info(
                        "[QuestBridge] host welcome: version {}; heartbeat {} ms, reconcile {} ms",
                        payload.has("hostVersion") ? payload.get("hostVersion").getAsString() : "?",
                        heartbeatIntervalMs,
                        payload.has("reconcileIntervalMs")
                                ? payload.get("reconcileIntervalMs").getAsLong()
                                : -1);
                scheduleHeartbeat();
            }
            case "host.request_snapshot" -> {
                hostRequests.incrementAndGet();
                String reason = root.getAsJsonObject("payload").has("reason")
                        ? root.getAsJsonObject("payload").get("reason").getAsString()
                        : "unknown";
                TransportLog.info("[QuestBridge] host requested a snapshot ({})", reason);
                forceFull.set(true);
                // The client thread supplies the capture; nothing to send until
                // the next handoff arrives.
            }
            case "host.error" -> {
                hostErrors.incrementAndGet();
                JsonObject payload = root.getAsJsonObject("payload");
                TransportLog.warn(
                        "[QuestBridge] host error {}: {}",
                        payload.has("code") ? payload.get("code").getAsString() : "?",
                        payload.has("message") ? payload.get("message").getAsString() : "");
            }
            default -> TransportLog.debug("[QuestBridge] ignoring host message {}", type);
        }
    }

    /**
     * Health counters, for diagnostics and the development harnesses. These are
     * the only way to tell a silent transport from a working one: a socket that
     * never sends looks identical to a socket that sends correctly.
     */
    public record Stats(
            long connects,
            long handshakeFailures,
            long snapshotsSent,
            long statusSent,
            long heartbeatsSent,
            long progressSent,
            long pinsSent,
            long sendFailures,
            long oversizeSkips,
            long hostRequests,
            long hostErrors,
            long lastSendBytes,
            long closeEvents,
            long drainFailures,
            long drains,
            long executesAccepted,
            long executeRejected,
            long executeAfterShutdown) {
    }

    private final AtomicLong connects = new AtomicLong();
    private final AtomicLong handshakeFailures = new AtomicLong();
    private final AtomicLong snapshotsSent = new AtomicLong();
    private final AtomicLong statusSent = new AtomicLong();
    private final AtomicLong heartbeatsSent = new AtomicLong();
    private final AtomicLong progressSent = new AtomicLong();
    private final AtomicLong pinsSent = new AtomicLong();
    private final AtomicLong sendFailures = new AtomicLong();
    private final AtomicLong oversizeSkips = new AtomicLong();
    private final AtomicLong hostRequests = new AtomicLong();
    private final AtomicLong hostErrors = new AtomicLong();
    private final AtomicLong lastSendBytes = new AtomicLong();
    private final AtomicLong closeEvents = new AtomicLong();
    private final AtomicLong drainFailures = new AtomicLong();
    private final AtomicLong drains = new AtomicLong();
    private final AtomicLong executesAccepted = new AtomicLong();
    private final AtomicLong executeRejected = new AtomicLong();
    private final AtomicLong executeAfterShutdown = new AtomicLong();

    public Stats stats() {
        return new Stats(connects.get(), handshakeFailures.get(), snapshotsSent.get(),
                statusSent.get(), heartbeatsSent.get(), progressSent.get(), pinsSent.get(),
                sendFailures.get(), oversizeSkips.get(), hostRequests.get(), hostErrors.get(),
                lastSendBytes.get(), closeEvents.get(), drainFailures.get(), drains.get(),
                executesAccepted.get(), executeRejected.get(), executeAfterShutdown.get());
    }

    /** Number of times the transport scheduler has proven itself alive. */
    public long schedulerTicks() {
        return transportExecutor.ticks();
    }

    /** Endpoint description safe for logs; never the token. */
    public String describeEndpoint() {
        return url;
    }
}
