package xyz.jxcb.ftbquestoverlay;

import net.neoforged.neoforge.common.ModConfigSpec;

/**
 * Client configuration for the QuestBridge adapter.
 *
 * <p>Stored in {@code config/questbridge-client.toml} and read at startup. A
 * missing or incomplete file is not an error: the adapter stays idle until a URL
 * and token are configured, because publishing requires the credential and a
 * guessed default token would not work.</p>
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
                    "Leave empty to run without publishing (the adapter logs this and stays idle).")
            .define("minecraftToken", "");

    private static final ModConfigSpec.BooleanValue ENABLED = BUILDER
            .comment("Publish to the host. Disable to run the in-game probe only.")
            .define("enabled", true);

    public static final ModConfigSpec SPEC = BUILDER.build();

    private QuestBridgeConfig() {
    }

    public static boolean enabled() {
        try {
            return ENABLED.getAsBoolean();
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
     * Effective token, with the same precedence as the URL. Mirrors the mock
     * publisher, which also accepts a system property and an environment
     * variable.
     */
    public static String resolveMinecraftToken() {
        String property = System.getProperty("questbridge.minecraftToken");
        if (property != null && !property.isBlank()) {
            return property;
        }
        String environment = System.getenv("QUESTBRIDGE_MINECRAFT_TOKEN");
        if (environment != null && !environment.isBlank()) {
            return environment;
        }
        return readString(MINECRAFT_TOKEN, "");
    }

    private static String readString(ModConfigSpec.ConfigValue<String> value, String fallback) {
        try {
            String read = value.get();
            return read == null ? fallback : read;
        } catch (IllegalStateException exception) {
            // Config not loaded yet; the documented default applies.
            return fallback;
        }
    }
}
