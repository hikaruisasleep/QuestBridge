package xyz.jxcb.ftbquestoverlay.protocol;

import java.nio.charset.StandardCharsets;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

/**
 * Strict, minimal JSON support for QuestBridge protocol v1.
 *
 * <p>This is not a general-purpose encoder. {@link JsonObjectBuilder} exists so
 * that object keys are written explicitly and null handling is impossible to get
 * wrong by accident, which matters because the receiving side uses strict
 * objects and rejects unknown or mis-typed fields.</p>
 *
 * <p>The protocol requires UTF-8 text frames, so escaping is disabled: valid
 * JSON text is valid UTF-8 and the WebSocket layer transmits bytes, not this
 * string's platform default charset.</p>
 */
public final class ProtocolJson {
    public static final Gson GSON = new GsonBuilder()
            .disableHtmlEscaping()
            .serializeNulls()
            .create();

    public static final java.nio.charset.Charset UTF8 = StandardCharsets.UTF_8;

    private ProtocolJson() {
    }

    public static byte[] toBytes(String json) {
        return json.getBytes(UTF8);
    }

    public static int utf8Length(String json) {
        return json.getBytes(UTF8).length;
    }
}
