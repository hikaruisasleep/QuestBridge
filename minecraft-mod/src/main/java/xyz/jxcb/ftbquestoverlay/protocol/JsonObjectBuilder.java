package xyz.jxcb.ftbquestoverlay.protocol;

import java.util.function.Consumer;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;

/**
 * Thin builder over Gson that makes protocol field rules explicit at the call
 * site.
 *
 * <p>The distinction that matters is {@code string(...)} versus
 * {@code nullableString(...)}: protocol v1 requires an explicit JSON
 * {@code null} on some fields and rejects {@code null} on others. Having two
 * differently named methods means the required behaviour is visible in
 * {@link ProtocolMessages} instead of depending on a serializer setting.</p>
 */
public final class JsonObjectBuilder {
    private final JsonObject object = new JsonObject();

    public JsonObjectBuilder string(String key, String value) {
        if (value == null) {
            throw new IllegalArgumentException("Protocol field '" + key + "' must not be null");
        }
        object.add(key, new JsonPrimitive(value));
        return this;
    }

    public JsonObjectBuilder nullableString(String key, String value) {
        object.add(key, value == null ? JsonNull.INSTANCE : new JsonPrimitive(value));
        return this;
    }

    public JsonObjectBuilder number(String key, int value) {
        object.add(key, new JsonPrimitive(value));
        return this;
    }

    public JsonObjectBuilder number(String key, long value) {
        object.add(key, new JsonPrimitive(value));
        return this;
    }

    /** Optional integer: an explicit JSON null where the schema allows null. */
    public JsonObjectBuilder nullableNumber(String key, Integer value) {
        object.add(key, value == null ? JsonNull.INSTANCE : new JsonPrimitive(value));
        return this;
    }

    public JsonObjectBuilder bool(String key, boolean value) {
        object.add(key, new JsonPrimitive(value));
        return this;
    }

    public JsonObjectBuilder object(String key, Consumer<JsonObjectBuilder> builder) {
        JsonObjectBuilder nested = new JsonObjectBuilder();
        builder.accept(nested);
        object.add(key, nested.object);
        return this;
    }

    /** Copies every field of another builder into this one. */
    public JsonObjectBuilder merge(JsonObjectBuilder other) {
        for (var entry : other.object.entrySet()) {
            object.add(entry.getKey(), entry.getValue());
        }
        return this;
    }

    public JsonObjectBuilder array(String key, Consumer<ArrayBuilder> builder) {
        ArrayBuilder nested = new ArrayBuilder();
        builder.accept(nested);
        object.add(key, nested.array);
        return this;
    }

    public String build() {
        return ProtocolJson.GSON.toJson(object);
    }

    /** Element builder for arrays of primitives or objects. */
    public static final class ArrayBuilder {
        private final JsonArray array = new JsonArray();

        public ArrayBuilder value(String value) {
            array.add(value);
            return this;
        }

        public ArrayBuilder object(Consumer<JsonObjectBuilder> builder) {
            JsonObjectBuilder nested = new JsonObjectBuilder();
            builder.accept(nested);
            array.add(nested.object);
            return this;
        }
    }

    /** Exposed for callers that need the raw tree, such as tests. */
    public JsonObject toJsonObject() {
        return object;
    }

    static Gson gson() {
        return ProtocolJson.GSON;
    }
}
