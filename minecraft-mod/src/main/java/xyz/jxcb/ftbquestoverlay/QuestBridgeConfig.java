package xyz.jxcb.ftbquestoverlay;

import net.neoforged.neoforge.common.ModConfigSpec;

/**
 * Client configuration for the QuestBridge adapter.
 *
 * <p>Stored in {@code config/questbridge-client.toml}. The file is read when
 * NeoForge loads the config, which is well after the mod constructor runs — see
 * {@link #resolveMinecraftToken()} and {@code docs/troubleshooting.md} section
 * 2.1 for why that ordering previously made this file useless.</p>
 *
 * <p>The token is a local credential. It is never logged, never sent to the
 * host as data, and never appears in a rendered page.</p>
 */
public final class QuestBridgeConfig {
    public static final String DEFAULT_HOST_URL = "ws://127.0.0.1:8765/ws";

    private static final ModConfigSpec.Builder BUILDER = new ModConfigSpec.Builder();

    private static final ModConfigSpec.ConfigValue<String> HOST_URL = BUILDER
            .comment(
                    "WebSocket URL of the QuestBridge host.",
                    "The default is the documented loopback endpoint.")
            .define("hostUrl", DEFAULT_HOST_URL);

    private static final ModConfigSpec.ConfigValue<String> MINECRAFT_TOKEN = BUILDER
            .comment(
                    "The minecraftToken from the host's tokens.json.",
                    "Printed by `npm run host -- --print-urls`; never share or commit it.",
                    "Leave empty to let the adapter discover the host's own token file,",
                    "which it reads from the same locations the host writes to.",
                    "Overridden by -Dquestbridge.minecraftToken and QUESTBRIDGE_MINECRAFT_TOKEN.")
            .define("minecraftToken", "");

    private static final ModConfigSpec.BooleanValue ENABLED = BUILDER
            .comment("Publish to the host. Disable to run the in-game probe only.")
            .define("enabled", true);

    private static final ModConfigSpec.BooleanValue DISCOVER_TOKEN = BUILDER
            .comment(
                    "Read the host's tokens.json when no token is configured anywhere.",
                    "The file is local and same-user; see docs/local-authentication.md section 2.3.",
                    "Set false to require an explicit token.")
            .define("discoverToken", true);

    public static final ModConfigSpec SPEC = BUILDER.build();

    private QuestBridgeConfig() {
    }

    public static boolean enabled() {
        try {
            return ENABLED.getAsBoolean();
        } catch (IllegalStateException exception) {
            // Before the spec loads, the documented default applies. This is
            // read from the constructor, so the state is expected, not an error.
            return true;
        }
    }

    public static boolean discoverToken() {
        try {
            return DISCOVER_TOKEN.getAsBoolean();
        } catch (IllegalStateException exception) {
            return true;
        }
    }

    /**
     * Effective host URL: system property, then environment variable, then the
     * config file, then the documented default.
     */
    public static String resolveHostUrl() {
        String property = System.getProperty("questbridge.wsUrl");
        if (property != null && !property.isBlank()) {
            return property;
        }
        String environment = System.getenv("QUESTBRIDGE_WS_URL");
        if (environment != null && !environment.isBlank()) {
            return environment;
        }
        return readString(HOST_URL, DEFAULT_HOST_URL);
    }

    /**
     * Resolves the token and reports where it came from, so the adapter can log
     * the decision without logging the credential.
     *
     * <p>Precedence, normative in {@code docs/ftb-quests-integration.md} section
     * 11.1:</p>
     *
     * <ol>
     *   <li>{@code -Dquestbridge.minecraftToken} — explicit, per-launch</li>
     *   <li>{@code QUESTBRIDGE_MINECRAFT_TOKEN} — explicit, per-instance</li>
     *   <li>this config file's {@code minecraftToken} — the user's stated intent</li>
     *   <li>the host's own {@code tokens.json} — discovery</li>
     * </ol>
     *
     * <p>The config file deliberately outranks discovery. A user who has written
     * a token into it is expressing an intent, and silently overriding that with
     * a different host's token would produce a symptom that cannot be diagnosed
     * from the file. Discovery exists for the case where nothing is configured,
     * which is where the two blocked Phase 5 sessions were.</p>
     */
    public static TokenDiscovery.Result resolveMinecraftTokenResult() {
        String property = System.getProperty("questbridge.minecraftToken");
        if (property != null && !property.isBlank()) {
            return new TokenDiscovery.Result(
                    property.trim(), "system property questbridge.minecraftToken");
        }

        String environment = System.getenv("QUESTBRIDGE_MINECRAFT_TOKEN");
        if (environment != null && !environment.isBlank()) {
            return new TokenDiscovery.Result(
                    environment.trim(), "environment variable QUESTBRIDGE_MINECRAFT_TOKEN");
        }

        String configured = readString(MINECRAFT_TOKEN, "");
        if (configured != null && !configured.isBlank()) {
            return new TokenDiscovery.Result(configured.trim(), "config/questbridge-client.toml");
        }

        if (!discoverToken()) {
            return new TokenDiscovery.Result(null, "token discovery is disabled by configuration");
        }
        return TokenDiscovery.discover();
    }

    /**
     * The token alone, with the same precedence. Kept for callers that need the
     * value and not its provenance; returns {@code ""} when none was found.
     */
    public static String resolveMinecraftToken() {
        String token = resolveMinecraftTokenResult().token();
        return token == null ? "" : token;
    }

    /**
     * Reads a config value, tolerating a spec that has not loaded yet.
     *
     * <p>This is the trap that made the original defect possible: returning a
     * silent default here is correct, but only if the caller waits for
     * {@code ModConfigEvent.Loading} before trusting the answer. See
     * {@link #isSpecLoaded()}.</p>
     */
    private static String readString(ModConfigSpec.ConfigValue<String> value, String fallback) {
        try {
            String read = value.get();
            return read == null ? fallback : read;
        } catch (IllegalStateException exception) {
            // Config not loaded yet; the documented default applies.
            return fallback;
        }
    }

    /**
     * Whether the config spec has been loaded, so {@link #resolveMinecraftToken()}
     * can be trusted.
     *
     * <p>Callers must wait for this rather than reading the token from the mod
     * constructor. That mistake is recorded in {@code docs/troubleshooting.md}
     * section 2.1.</p>
     */
    public static boolean isSpecLoaded() {
        try {
            MINECRAFT_TOKEN.get();
            return true;
        } catch (IllegalStateException exception) {
            return false;
        }
    }
}
