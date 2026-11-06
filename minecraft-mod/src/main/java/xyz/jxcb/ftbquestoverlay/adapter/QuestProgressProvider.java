package xyz.jxcb.ftbquestoverlay.adapter;

/**
 * FTB-independent capture interface.
 *
 * <p>Implementations may read FTB and Minecraft state, so every method must be
 * called on the Minecraft client thread. The interface exists so that nothing
 * outside {@code adapter.ftb} depends on FTB types.</p>
 */
public interface QuestProgressProvider {
    /**
     * Why the provider cannot currently capture, in a form safe to log. Returns
     * {@code null} when {@link #captureSnapshot()} is expected to succeed.
     */
    Unavailable unavailableReason();

    /** True when a snapshot can be captured right now. */
    default boolean isAvailable() {
        return unavailableReason() == null;
    }

    /**
     * Captures a full snapshot, or returns {@code null} if the data became
     * unavailable between {@link #unavailableReason()} and this call.
     */
    QuestSnapshot captureSnapshot();

    /** Identity used to decide when a full snapshot is mandatory. */
    QuestSnapshot.Identity identity();

    /**
     * Monotonic counter of FTB start/completion events observed since the
     * adapter started. Used to invalidate the reconciliation cache cheaply.
     */
    long changeCounter();

    /** Clears the cached change counter after a capture has consumed it. */
    void resetChangeCounter();

    /** Reason the data is unavailable, mapped to a protocol status phase. */
    record Unavailable(Phase phase, String detail) {
        public enum Phase {
            /** No world is loaded. */
            UNAVAILABLE,
            /** A world is loaded but FTB has not synchronized yet. */
            SYNCHRONIZING
        }
    }
}
