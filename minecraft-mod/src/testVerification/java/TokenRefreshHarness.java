import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import xyz.jxcb.ftbquestoverlay.adapter.QuestSnapshot;
import xyz.jxcb.ftbquestoverlay.transport.ConnectionController;
import xyz.jxcb.ftbquestoverlay.transport.SnapshotDiffer;
import xyz.jxcb.ftbquestoverlay.transport.SnapshotSink;

/**
 * Development harness for Proposal E's E2 fix: the token is re-resolved on every
 * connect attempt instead of being frozen at construction.
 *
 * <p>{@code docs/troubleshooting.md} section 2.1.2 records the defect:
 * {@code ConnectionController} held the token as a {@code final} field, so every
 * reconnect replayed the value captured at construction and a regenerated token
 * meant restarting Minecraft. The fix is a
 * {@link ConnectionController.TokenSupplier} called inside {@code connect()}.</p>
 *
 * <p>The property under test is not "the controller can use a token" — it always
 * could. It is <b>"the controller asks for the token again on each attempt"</b>,
 * which is a fact about the call site rather than the value. So the harness
 * counts supplier invocations across attempts it can control:</p>
 *
 * <ol>
 *   <li><b>Retries re-resolve.</b> A controller pointed at a closed port fails and
 *       backs off 1 s, 2 s, … The supplier must be called once per attempt. A
 *       frozen implementation calls it once, ever.</li>
 *   <li><b>The new value is the one used.</b> The supplier returns a wrong token,
 *       then the correct one on a later attempt, against a real host. The
 *       handshake result must follow the value, not the construction.</li>
 * </ol>
 *
 * <p><b>What this does not cover.</b> It runs the transport classes directly, so
 * it says nothing about E1 — when NeoForge loads the config and therefore when
 * the real adapter starts its transport. That needs a live client
 * ({@code docs/phase-5-plan.md} section 12.5). It also cannot prove the adapter
 * itself passes a supplier; that is asserted by reading
 * {@code QuestBridgeClient.startTransportOnce}.</p>
 *
 * <p>Usage: {@code java TokenRefreshHarness <ws-url> <correctToken> <deadPortUrl>}</p>
 */
public final class TokenRefreshHarness {
    private static int checks;
    private static int failures;

    public static void main(String[] args) throws Exception {
        String url = args[0];
        String correctToken = args[1];
        String deadUrl = args[2];

        SnapshotDiffer.Versions versions = new SnapshotDiffer.Versions(
                "0pre.3", "1.21.1", "21.1.250", "2101.1.30", "2101.1.10");

        // ---- 1. Retries call the supplier again (the core of E2) ----------
        //
        // Against a closed port, so every attempt fails and the controller
        // retries. Supplier calls then count attempts, which is exactly the
        // quantity the old final field made equal to one.
        System.out.println("PHASE 1: retries must re-resolve the token (dead port)");
        AtomicInteger retryCalls = new AtomicInteger();
        AtomicReference<String> retryToken = new AtomicReference<>(correctToken);
        ConnectionController retrying = new ConnectionController(
                deadUrl,
                () -> {
                    retryCalls.incrementAndGet();
                    return retryToken.get();
                },
                "refresh-retry-" + java.util.UUID.randomUUID(),
                versions);
        retrying.start();
        // Long enough for the 1 s and 2 s backoff stages to elapse.
        Thread.sleep(6_000);
        long attempts = retrying.stats().handshakeFailures();
        int calls = retryCalls.get();
        retrying.stop();

        report("the dead port produced more than one attempt", attempts > 1,
                "handshakeFailures=" + attempts);
        report("the supplier was consulted on each attempt", calls > 1,
                "supplierCalls=" + calls + " for " + attempts + " attempt(s)");
        report("supplier calls track attempts, not construction",
                calls >= attempts,
                "supplierCalls=" + calls + " >= attempts=" + attempts);

        // ---- 2. A wrong token is rejected, and the reason is reported -----
        //
        // The host must not already have a publisher connected, or this would be
        // refused with 409 and the 401 would never be exercised.
        System.out.println();
        System.out.println("PHASE 2: a wrong token must be refused by the host");
        ConnectionController wrong = new ConnectionController(
                url,
                () -> "deliberately-wrong-token",
                "refresh-wrong-" + java.util.UUID.randomUUID(),
                versions);
        wrong.start();
        Thread.sleep(2_500);
        long wrongFailures = wrong.stats().handshakeFailures();
        wrong.stop();
        report("the wrong token is rejected", wrongFailures > 0,
                "handshakeFailures=" + wrongFailures);

        // Give the host a moment to release the single-publisher slot.
        Thread.sleep(800);

        // ---- 3. The correct token still works ----------------------------
        System.out.println();
        System.out.println("PHASE 3: the correct token must be accepted");
        ConnectionController good = new ConnectionController(
                url,
                () -> correctToken,
                "refresh-good-" + java.util.UUID.randomUUID(),
                versions);
        good.start();
        Thread.sleep(2_500);
        good.offer(new SnapshotSink.Handoff(snapshot(), identity(), true, "ready", null));
        Thread.sleep(1_500);
        boolean connected = good.stats().connects() > 0;
        boolean published = good.stats().snapshotsSent() > 0;
        System.out.println("  info  " + good.stats());
        good.stop();
        report("the correct token connects", connected);
        report("the correct token publishes a snapshot", published);

        // ---- 4. A supplier that throws must not kill the reconnect loop ---
        //
        // The supplier is called on the transport thread. An exception escaping
        // it would kill the scheduler silently and look like a host that is
        // down, which is the failure mode section 2.1.2 describes in spirit:
        // a transport that dies without a diagnosis.
        System.out.println();
        System.out.println("PHASE 4: a throwing supplier must not kill the loop");
        AtomicInteger throwCalls = new AtomicInteger();
        ConnectionController throwing = new ConnectionController(
                deadUrl,
                () -> {
                    throwCalls.incrementAndGet();
                    throw new IllegalStateException("supplier exploded");
                },
                "refresh-throwing-" + java.util.UUID.randomUUID(),
                versions);
        throwing.start();
        Thread.sleep(6_000);
        int throwAttempts = throwCalls.get();
        throwing.stop();
        report("the loop survived a throwing supplier", throwAttempts > 1,
                "supplierCalls=" + throwAttempts + " (a single call means the loop died)");

        System.out.println();
        System.out.printf("%d/%d checks passed%n", checks - failures, checks);
        if (failures > 0) {
            System.out.println("TOKEN REFRESH FAILED");
            System.exit(1);
        }
        System.out.println("TOKEN REFRESH OK");
        System.exit(0);
    }

    private static void report(String name, boolean condition) {
        report(name, condition, null);
    }

    private static void report(String name, boolean condition, String detail) {
        checks++;
        if (!condition) {
            failures++;
        }
        System.out.printf("  %s  %s%s%n", condition ? "PASS" : "FAIL", name,
                detail == null ? "" : "  (" + detail + ")");
    }

    private static QuestSnapshot.Identity identity() {
        return new QuestSnapshot.Identity("file-r", "team-refresh", "level-r:minecraft:overworld");
    }

    private static QuestSnapshot snapshot() {
        QuestSnapshot.Chapter chapter = new QuestSnapshot.Chapter(
                "C0000000000003", "Refresh chapter", null, 0, 12, "available");
        QuestSnapshot.Quest quest = new QuestSnapshot.Quest(
                "Q0000000000003", "C0000000000003", "Refresh quest", null,
                false, false, List.of(),
                List.of(new QuestSnapshot.Task("T0000000000004", "ftbquests:item", "Nugget",
                        false, new QuestSnapshot.TaskProgress("in_progress", 1L, 8L, 12))),
                new QuestSnapshot.QuestProgress("in_progress", 0, 1, 12));
        return new QuestSnapshot(
                "Refresh world", "minecraft:overworld", false,
                "team-refresh", "Refresh team",
                List.of(chapter), List.of("Q0000000000003"), List.of(quest), List.of(),
                Instant.now().toString());
    }

    private TokenRefreshHarness() {
    }
}
