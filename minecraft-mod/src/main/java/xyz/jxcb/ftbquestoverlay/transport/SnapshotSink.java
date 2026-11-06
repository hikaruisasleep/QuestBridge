package xyz.jxcb.ftbquestoverlay.transport;

import java.time.Instant;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

import xyz.jxcb.ftbquestoverlay.adapter.QuestSnapshot;
import xyz.jxcb.ftbquestoverlay.protocol.JsonObjectBuilder;
import xyz.jxcb.ftbquestoverlay.protocol.ProtocolMessages;

/**
 * Serializes a handoff from the client thread to the transport thread.
 *
 * <p>Producers on the client thread must do the minimum possible work. They do
 * not encode, diff, or allocate large structures here; {@link #offer} just
 * publishes one immutable reference and returns. Encoding happens on the
 * transport executor.</p>
 */
public interface SnapshotSink {
    void offer(Handoff handoff);

    /**
     * @param snapshot  captured on the client thread and immutable thereafter
     * @param identity  file/team/world identity at capture time
     * @param ready     whether FTB data was available
     * @param phase     protocol status phase when not ready
     * @param detail    human-readable reason when not ready, safe to log
     */
    record Handoff(
            QuestSnapshot snapshot,
            QuestSnapshot.Identity identity,
            boolean ready,
            String phase,
            String detail) {
    }
}
