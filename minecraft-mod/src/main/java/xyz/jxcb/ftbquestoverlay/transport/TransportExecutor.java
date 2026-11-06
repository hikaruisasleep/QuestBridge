package xyz.jxcb.ftbquestoverlay.transport;

import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * The single-threaded scheduler all transport work runs on.
 *
 * <p>Threading contract: exactly one daemon thread named {@code questbridge-transport}
 * executes every send, encode, and reconnect decision. That is what keeps FTB
 * and Minecraft state off this thread by construction, and what makes message
 * sequencing trivially correct.</p>
 *
 * <p>Implementation note: a {@link ScheduledThreadPoolExecutor} is used directly
 * and held only by its owner. During Stage 4C the simple
 * {@code Executors.newSingleThreadScheduledExecutor} form was observed to stop
 * running its scheduled work while the owner was still alive, so the executor
 * here is also pinged from its own worker thread ({@link #heartbeatTick()}) to
 * make a stall immediately visible instead of silent.</p>
 */
public final class TransportExecutor {
    private final ScheduledThreadPoolExecutor executor;
    private volatile long ticks;

    private TransportExecutor() {
        this.executor = new ScheduledThreadPoolExecutor(1, runnable -> {
            Thread thread = new Thread(runnable, "questbridge-transport");
            thread.setDaemon(true);
            thread.setUncaughtExceptionHandler((failed, error) ->
                    System.err.println("[QuestBridge] transport thread failed: " + error));
            return thread;
        });
        this.executor.setRemoveOnCancelPolicy(true);
        this.executor.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
    }

    public static TransportExecutor create() {
        TransportExecutor created = new TransportExecutor();
        // Prove the scheduler keeps working: one tick per second, forever.
        created.schedulePing();
        return created;
    }

    private void schedulePing() {
        executor.schedule(() -> {
            ticks++;
            schedulePing();
        }, 1, TimeUnit.SECONDS);
    }

    public ScheduledThreadPoolExecutor executor() {
        return executor;
    }

    /** Number of times the scheduler has proven itself alive. */
    public long ticks() {
        return ticks;
    }

    public void shutdownNow() {
        executor.shutdownNow();
    }
}
