package xyz.jxcb.ftbquestoverlay.adapter;

/**
 * Enforces the adapter's one hard threading rule: FTB and Minecraft state is
 * read only on the Minecraft client thread.
 *
 * <p>Reading FTB off-thread can corrupt its state or crash, and the adapter is
 * the only place that can prevent it. The check is cheap and always on: a thread
 * name comparison, not a stack walk, because it runs on every capture.</p>
 *
 * <p>Minecraft's client thread is the thread that runs the integrated server in
 * single-player as well as the render thread; {@code Minecraft.getInstance()} has
 * no public accessor for it, so the main thread is identified by name. That is a
 * heuristic, and it is deliberately fail-open: an unrecognised thread on which
 * the check cannot be evaluated must not stop the overlay working. A violation
 * is logged loudly instead.</p>
 */
public final class ClientThreadGuard {
    private static final String CLIENT_THREAD_NAME = "Render thread";
    private static volatile boolean reported;

    private ClientThreadGuard() {
    }

    /** True when the current thread looks like the Minecraft client thread. */
    public static boolean isClientThread() {
        Thread current = Thread.currentThread();
        if (CLIENT_THREAD_NAME.equals(current.getName())) {
            return true;
        }
        // Single-player runs the integrated server on the client thread; some
        // launchers name it "main". Both are accepted rather than guessed at.
        return "main".equals(current.getName()) && Thread.currentThread() == mainThread();
    }

    private static Thread mainThread() {
        return MainThreadHolder.MAIN;
    }

    private static final class MainThreadHolder {
        private static final Thread MAIN = Thread.currentThread();
    }

    /**
     * Records a threading violation once per process. Never throws: a capture
     * that is otherwise valid is still worth publishing.
     */
    public static void noteViolation(String operation) {
        if (reported) {
            return;
        }
        reported = true;
        System.err.println(
                "[QuestBridge] FTB state read off the client thread during '" + operation
                        + "' on thread '" + Thread.currentThread().getName()
                        + "'. This violates the adapter threading contract; data may be inconsistent.");
    }

    /** Asserts the client thread, recording a violation when it is not. */
    public static void requireClientThread(String operation) {
        if (!isClientThread()) {
            noteViolation(operation);
        }
    }
}
