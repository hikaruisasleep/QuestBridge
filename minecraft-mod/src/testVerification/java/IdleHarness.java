import java.time.Instant;

import xyz.jxcb.ftbquestoverlay.transport.SnapshotDiffer;
import xyz.jxcb.ftbquestoverlay.transport.WebSocketConnection;

/**
 * Minimal transport probe. Sends hello only, then idles.
 *
 * Used to separate two failure modes that look identical from the host side:
 * a socket the host closes after a payload, versus a socket this side drops.
 *
 * Usage: java IdleHarness <ws-url> <token> <idleMs>
 */
public final class IdleHarness {
    public static void main(String[] args) throws Exception {
        String url = args[0];
        String token = args[1];
        long idleMs = Long.parseLong(args[2]);

        final long[] closedAt = {0};
        final long started = System.currentTimeMillis();

        WebSocketConnection connection = WebSocketConnection.open(url, token,
                new WebSocketConnection.Listener() {
                    @Override
                    public void onText(String text) {
                        System.out.println("RECV " + text.substring(0, Math.min(80, text.length())));
                    }

                    @Override
                    public void onClosed(String reason) {
                        closedAt[0] = System.currentTimeMillis() - started;
                        System.out.println("CLOSED after " + closedAt[0] + "ms reason=" + reason);
                    }
                });

        SnapshotDiffer differ = new SnapshotDiffer();
        String sessionId = "idle-" + java.util.UUID.randomUUID();
        connection.sendText(differ.hello(sessionId,
                new SnapshotDiffer.Versions("0pre.2", "1.21.1", "21.1.250", "2101.1.30", "2101.1.10"),
                Instant.now()));
        System.out.println("HELLO SENT");

        Thread.sleep(idleMs);
        System.out.println("IDLE COMPLETE isOpen=" + connection.isOpen() + " closedAt=" + closedAt[0]);
        System.exit(connection.isOpen() ? 0 : 5);
    }

    private IdleHarness() {
    }
}
