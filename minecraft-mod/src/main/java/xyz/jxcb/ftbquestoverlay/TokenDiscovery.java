package xyz.jxcb.ftbquestoverlay;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/**
 * Finds the host's {@code minecraftToken} in the host's own token file.
 *
 * <p>This is the last resort of the token resolution order documented in
 * {@code docs/ftb-quests-integration.md} section 11.1: an explicit system
 * property, then an environment variable, then the adapter's own config file,
 * and only then discovery. It exists because the two blocked Phase 5 sessions
 * could not publish at all — nothing was configured, and the adapter had no way
 * to find the credential the host had already generated.</p>
 *
 * <p><b>Security.</b> Reading this file adds no trust boundary. It is the same
 * same-user, same-machine read the host already performs, and every process
 * running as this user could read it before this class existed. The
 * {@code minecraftToken} boundary — publisher versus reader — is unchanged, and
 * a browser still cannot publish. What does change is that the credential is
 * discoverable without configuration, which is the point of the feature. See
 * {@code docs/local-authentication.md} section 2.3.</p>
 *
 * <p><b>The token is never logged.</b> Callers may log {@link Result#source()}
 * and {@link Result#found()}, never {@link Result#token()}.</p>
 *
 * <p>The path rules deliberately mirror {@code packages/host/src/paths.ts}. If
 * that file changes, this one must change with it, or the adapter silently stops
 * finding the token.</p>
 */
public final class TokenDiscovery {
    /** Overrides every platform default, exactly as the host's own resolver does. */
    public static final String CONFIG_DIR_ENV = "QUESTBRIDGE_CONFIG_DIR";

    /** Explicit path to a token file; used by harnesses and by unusual setups. */
    public static final String TOKENS_FILE_PROPERTY = "questbridge.tokensFile";

    private static final String TOKENS_FILE_NAME = "tokens.json";

    private TokenDiscovery() {
    }

    /**
     * The token and where it came from.
     *
     * @param token  the token value, or {@code null} when none was found. Never
     *               log this.
     * @param source a human-readable description of where the value came from,
     *               or why discovery failed. Safe to log.
     */
    public record Result(String token, String source) {
        public boolean found() {
            return token != null && !token.isBlank();
        }

        /** {@inheritDoc} */
        @Override
        public String toString() {
            // Deliberately omits the token: a record's default toString would
            // put the credential into any log line or debugger view that prints
            // this object, which is exactly the leak the class documents against.
            return "Result[found=" + found() + ", source=" + source + "]";
        }
    }

    /** Discovers using the live JVM environment. */
    public static Result discover() {
        return discover(System.getenv(), System.getProperty("user.home"));
    }

    /**
     * Discovers with an injected environment, so the path rules are testable on
     * any platform without mutating the real environment.
     */
    public static Result discover(Map<String, String> env, String home) {
        String explicit = System.getProperty(TOKENS_FILE_PROPERTY);
        if (explicit != null && !explicit.isBlank()) {
            return read(Path.of(explicit.trim()), "system property " + TOKENS_FILE_PROPERTY);
        }

        String fromEnv = env.get(CONFIG_DIR_ENV);
        if (fromEnv != null && !fromEnv.isBlank()) {
            return readInDirectory(
                    Path.of(fromEnv.trim()), CONFIG_DIR_ENV + "=" + fromEnv.trim());
        }

        String os = System.getProperty("os.name", "").toLowerCase(java.util.Locale.ROOT);

        if (os.contains("win")) {
            String appData = env.get("APPDATA");
            if (appData != null && !appData.isBlank()) {
                return readInDirectory(
                        Path.of(appData.trim(), "QuestBridge"), "%APPDATA%\\QuestBridge");
            }
            return readInDirectory(
                    Path.of(home, "AppData", "Roaming", "QuestBridge"),
                    "%APPDATA% unset; home AppData");
        }

        if (os.contains("mac")) {
            return readInDirectory(
                    Path.of(home, "Library", "Application Support", "QuestBridge"),
                    "macOS Application Support");
        }

        String xdg = env.get("XDG_CONFIG_HOME");
        if (xdg != null && !xdg.isBlank()) {
            return readInDirectory(Path.of(xdg.trim(), "questbridge"), "XDG_CONFIG_HOME");
        }
        return readInDirectory(Path.of(home, ".config", "questbridge"), "~/.config/questbridge");
    }

    private static Result readInDirectory(Path directory, String describedAs) {
        return read(directory.resolve(TOKENS_FILE_NAME), describedAs);
    }

    /**
     * Reads and validates one token file.
     *
     * <p>Every failure is reported as a {@code source} string rather than thrown:
     * discovery failing is normal, and the adapter must fall through to its own
     * config without an error. The message says which step failed, because "no
     * token" and "the file is malformed" need different fixes.</p>
     */
    static Result read(Path path, String describedAs) {
        if (!Files.isReadable(path)) {
            return new Result(null, describedAs + ": no readable " + path);
        }

        String text;
        try {
            text = Files.readString(path, StandardCharsets.UTF_8);
        } catch (IOException | RuntimeException exception) {
            return new Result(null, describedAs + ": could not read " + path);
        }

        String token;
        try {
            JsonElement parsed = JsonParser.parseString(text);
            if (!parsed.isJsonObject()) {
                return new Result(null, describedAs + ": " + path + " is not a JSON object");
            }
            JsonObject root = parsed.getAsJsonObject();
            if (!root.has("minecraftToken") || !root.get("minecraftToken").isJsonPrimitive()) {
                return new Result(null, describedAs + ": " + path + " has no minecraftToken");
            }
            token = root.get("minecraftToken").getAsString();
        } catch (RuntimeException exception) {
            return new Result(null, describedAs + ": " + path + " is not valid JSON");
        }

        if (token == null || token.isBlank()) {
            return new Result(null, describedAs + ": minecraftToken is empty in " + path);
        }
        return new Result(token, describedAs + ": " + path);
    }
}
