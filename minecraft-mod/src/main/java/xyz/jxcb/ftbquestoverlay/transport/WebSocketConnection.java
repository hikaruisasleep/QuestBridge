package xyz.jxcb.ftbquestoverlay.transport;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;


/**
 * A single authenticated WebSocket connection to the QuestBridge host.
 *
 * <p>This class knows only bytes and callback events. It never imports FTB or
 * Minecraft, which is what keeps all network work off the client thread by
 * construction rather than by discipline.</p>
 *
 * <p>Messages are sent text frames. Sends are asynchronous and the caller blocks
 * on each one: messages must arrive in sequence order, and the host treats a gap
 * as a reason to request a full snapshot. Sends run on the transport executor,
 * never on the client thread.</p>
 */
public final class WebSocketConnection implements WebSocket.Listener {
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(10);
    private static final Duration SEND_TIMEOUT = Duration.ofSeconds(10);

    /** Listener for socket lifecycle events, delivered on the HTTP client thread. */
    public interface Listener {
        void onText(String text);

        void onClosed(String reason);
    }

    private final CountDownLatch open = new CountDownLatch(1);
    private final Listener listener;

    private volatile WebSocket socket;
    private volatile HttpClient httpClient;
    private volatile String closeReason;
    private volatile boolean closed;
    private final StringBuilder partial = new StringBuilder();

    private WebSocketConnection(Listener listener) {
        this.listener = listener;
    }

    /**
     * Opens an authenticated connection.
     *
     * <p>The token travels as {@code Authorization: Bearer}. A native client
     * sends no {@code Origin} header, which the host accepts only with the
     * Minecraft token.</p>
     *
     * @throws ConnectionException with a redacted message when the handshake fails
     */
    public static WebSocketConnection open(
            String url, String bearerToken, Listener listener) {
        WebSocketConnection connection = new WebSocketConnection(listener);

        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(CONNECT_TIMEOUT)
                .build();

        WebSocket.Builder builder = client.newWebSocketBuilder()
                .connectTimeout(CONNECT_TIMEOUT);
        if (bearerToken != null && !bearerToken.isBlank()) {
            builder.header("Authorization", "Bearer " + bearerToken);
        }

        try {
            connection.socket = builder
                    .buildAsync(URI.create(url), connection)
                    .get(CONNECT_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
        } catch (ExecutionException exception) {
            throw new ConnectionException(describeHandshakeFailure(exception.getCause()));
        } catch (TimeoutException exception) {
            throw new ConnectionException("handshake timed out");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ConnectionException("interrupted");
        } catch (IllegalArgumentException exception) {
            // A malformed URL must never echo the token or address into a log.
            throw new ConnectionException("invalid WebSocket URL");
        }

        // Keep a strong reference to the HttpClient for the connection's
        // lifetime. The JDK client is otherwise eligible for garbage collection
        // once open() returns, and a collected client silently drops the socket.
        connection.httpClient = client;
        return connection;
    }

    /**
     * Maps a JDK handshake failure to a short, redacted reason.
     *
     * <p>{@code java.net.http} reports a rejected upgrade as
     * {@code WebSocketHandshakeException: HTTP/1.1 401}. The status code is all
     * that is logged: the message never contains the token or the address.</p>
     */
    static String describeHandshakeFailure(Throwable cause) {
        if (cause == null) {
            return "handshake failed";
        }
        String message = cause.getMessage();
        if (message != null && message.contains("401")) {
            return "HTTP 401 (missing or invalid minecraftToken)";
        }
        if (message != null && message.contains("409")) {
            return "HTTP 409 (another publisher is already connected)";
        }
        if (message != null && message.contains("403")) {
            return "HTTP 403 (origin rejected)";
        }
        if (message != null && message.contains("429")) {
            return "HTTP 429 (connection rate limited)";
        }
        if (message != null && message.contains("HTTP")) {
            int index = message.indexOf("HTTP");
            return message.substring(index, Math.min(message.length(), index + 40));
        }
        return cause.getClass().getSimpleName();
    }

    public boolean isOpen() {
        return !closed && socket != null && !socket.isOutputClosed();
    }

    /** Sends a text frame, blocking until the send completes. */
    public void sendText(String text) {
        WebSocket current = socket;
        if (closed || current == null || current.isOutputClosed()) {
            throw new ConnectionException("not connected");
        }
        try {
            current.sendText(text, true).get(SEND_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
        } catch (ExecutionException exception) {
            throw new ConnectionException("send failed: " + describeHandshakeFailure(exception.getCause()));
        } catch (TimeoutException exception) {
            throw new ConnectionException("send timed out");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ConnectionException("interrupted while sending");
        }
    }

    /** Closes the socket and waits briefly for the close handshake. */
    public void close() {
        WebSocket current = socket;
        closed = true;
        if (current == null) {
            return;
        }
        try {
            current.sendClose(WebSocket.NORMAL_CLOSURE, "client closing")
                    .get(2, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        } catch (ExecutionException | TimeoutException | RuntimeException exception) {
            // Best effort: abort below regardless.
        }
        try {
            current.abort();
        } catch (RuntimeException exception) {
            TransportLog.debug("[QuestBridge] abort after close failed", exception);
        }
    }

    /** Why the socket closed, for logging. Never contains a token. */
    public String closeReason() {
        return closeReason;
    }

    // ---- WebSocket.Listener ------------------------------------------

    @Override
    public void onOpen(WebSocket webSocket) {
        open.countDown();
        webSocket.request(1);
    }
    @Override
    public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
        partial.append(data);
        if (last) {
            String text = partial.toString();
            partial.setLength(0);
            try {
                listener.onText(text);
            } catch (RuntimeException exception) {
                TransportLog.warn("[QuestBridge] failed to handle a host message", exception);
            }
        }
        // Demand the next frame AFTER handling this one. On some JDK builds the
        // demand is tied to the returned CompletableFuture, and returning null
        // from a listener that has already requested more can leave the reader
        // without a pending demand, silently stalling the socket.
        webSocket.request(1);
        return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
        closed = true;
        closeReason = statusCode + (reason == null || reason.isBlank() ? "" : " " + reason);
        open.countDown();
        listener.onClosed(closeReason);
        return CompletableFuture.completedFuture(null);
    }

    @Override
    public void onError(WebSocket webSocket, Throwable error) {
        closed = true;
        if (closeReason == null) {
            // The JDK reports the underlying cause only here; the class name
            // alone is not enough to diagnose a dropped connection.
            closeReason = error == null ? "error" : error.getClass().getSimpleName()
                    + (error.getMessage() == null ? "" : ": " + error.getMessage());
        }
        open.countDown();
        listener.onClosed(closeReason);
    }

    @Override
    public CompletionStage<?> onBinary(WebSocket webSocket, ByteBuffer data, boolean last) {
        // Protocol v1 forbids binary frames. Ignore the content, keep the
        // connection alive, and let the host enforce its own rules.
        webSocket.request(1);
        return CompletableFuture.completedFuture(null);
    }

    /** Transport-level failure with a message that is safe to log. */
    public static final class ConnectionException extends RuntimeException {
        public ConnectionException(String message) {
            super(message);
        }
    }
}
