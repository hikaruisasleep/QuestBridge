import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import xyz.jxcb.ftbquestoverlay.TokenDiscovery;

/**
 * Development harness for Proposal E's token-discovery path.
 *
 * <p>Exercises the real {@link TokenDiscovery} class — not a copy of its rules —
 * against temporary token files, so the claimed precedence and the JSON parsing
 * are checked rather than asserted. It needs no Minecraft: the class deliberately
 * imports nothing from the game.</p>
 *
 * <p><b>What this does not cover.</b> It cannot exercise E1 (the config-load
 * ordering) at all, because that defect was that a NeoForge callback had not
 * fired yet; nor E2 (re-resolution on reconnect), which is a property of
 * {@code ConnectionController}'s call site. Those need a live client. See
 * {@code docs/phase-5-plan.md} section 12.5.</p>
 *
 * <p>Usage:
 * {@code java DiscoveryHarness} — no arguments; it creates and cleans up its own
 * temporary directories.</p>
 */
public final class DiscoveryHarness {
    private static int failures;
    private static int checks;

    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("questbridge-discovery-");
        try {
            run(root);
        } finally {
            deleteRecursively(root);
        }

        System.out.println();
        System.out.printf("%d/%d checks passed%n", checks - failures, checks);
        if (failures > 0) {
            System.out.println("DISCOVERY FAILED");
            System.exit(1);
        }
        System.out.println("DISCOVERY OK");
    }

    private static void run(Path root) throws IOException {
        // ---- 1. A valid token file is read ------------------------------
        Path appData = Files.createDirectories(root.resolve("AppData/Roaming"));
        Path questBridge = Files.createDirectories(appData.resolve("QuestBridge"));
        writeTokens(questBridge, "token-from-appdata");

        Map<String, String> windowsEnv = new HashMap<>();
        windowsEnv.put("APPDATA", appData.toString());
        if (System.getProperty("os.name", "").toLowerCase().contains("win")) {
            TokenDiscovery.Result windows = TokenDiscovery.discover(windowsEnv, root.toString());
            check("finds the token under %APPDATA%\\QuestBridge",
                    windows.found() && "token-from-appdata".equals(windows.token()),
                    windows.source());
        } else {
            // The Windows branch is guarded by os.name, so on another platform
            // this is reported as not exercised rather than as a pass.
            System.out.println("  n/obs  %APPDATA% branch (not on Windows)");
        }

        // ---- 2. QUESTBRIDGE_CONFIG_DIR wins over the platform default ----
        Path override = Files.createDirectories(root.resolve("override"));
        writeTokens(override, "token-from-override");
        Map<String, String> overrideEnv = new HashMap<>(windowsEnv);
        overrideEnv.put("QUESTBRIDGE_CONFIG_DIR", override.toString());
        TokenDiscovery.Result fromOverride = TokenDiscovery.discover(overrideEnv, root.toString());
        check("QUESTBRIDGE_CONFIG_DIR overrides the platform default",
                "token-from-override".equals(fromOverride.token()),
                fromOverride.source());

        // ---- 3. A missing file is reported, not thrown --------------------
        Map<String, String> emptyEnv = new HashMap<>();
        emptyEnv.put("APPDATA", Files.createDirectories(root.resolve("empty")).toString());
        TokenDiscovery.Result missing = TokenDiscovery.discover(emptyEnv, root.toString());
        check("a missing token file yields no token and a reason",
                !missing.found() && missing.source() != null && missing.source().contains("no readable"),
                missing.source());

        // ---- 4. Malformed JSON is reported, not thrown --------------------
        Path malformed = Files.createDirectories(root.resolve("malformed"));
        Files.writeString(malformed.resolve("tokens.json"), "{not json", StandardCharsets.UTF_8);
        Map<String, String> malformedEnv = new HashMap<>();
        malformedEnv.put("QUESTBRIDGE_CONFIG_DIR", malformed.toString());
        TokenDiscovery.Result bad = TokenDiscovery.discover(malformedEnv, root.toString());
        check("malformed JSON yields no token and a reason",
                !bad.found() && bad.source() != null && bad.source().contains("not valid JSON"),
                bad.source());

        // ---- 5. A missing minecraftToken field is reported ----------------
        Path absent = Files.createDirectories(root.resolve("absent"));
        Files.writeString(absent.resolve("tokens.json"),
                "{\"version\":1,\"browserToken\":\"x\"}", StandardCharsets.UTF_8);
        Map<String, String> absentEnv = new HashMap<>();
        absentEnv.put("QUESTBRIDGE_CONFIG_DIR", absent.toString());
        TokenDiscovery.Result noField = TokenDiscovery.discover(absentEnv, root.toString());
        check("a file without minecraftToken yields no token",
                !noField.found() && noField.source() != null && noField.source().contains("no minecraftToken"),
                noField.source());

        // ---- 6. An empty minecraftToken is reported -----------------------
        Path blank = Files.createDirectories(root.resolve("blank"));
        writeTokens(blank, "");
        Map<String, String> blankEnv = new HashMap<>();
        blankEnv.put("QUESTBRIDGE_CONFIG_DIR", blank.toString());
        TokenDiscovery.Result empty = TokenDiscovery.discover(blankEnv, root.toString());
        check("an empty minecraftToken yields no token",
                !empty.found() && empty.source() != null && empty.source().contains("empty"),
                empty.source());

        // ---- 7. The token is never in toString() --------------------------
        // The Result record's default toString would leak the credential into
        // any log line or debugger that printed it. This is asserted because the
        // leak would be invisible until it mattered.
        Path leakDir = Files.createDirectories(root.resolve("leak"));
        writeTokens(leakDir, "super-secret-token-value");
        Map<String, String> leakEnv = new HashMap<>();
        leakEnv.put("QUESTBRIDGE_CONFIG_DIR", leakDir.toString());
        TokenDiscovery.Result leaked = TokenDiscovery.discover(leakEnv, root.toString());
        check("the token is found for this case at all", leaked.found(), leaked.source());
        check("Result.toString() does not contain the token",
                !leaked.toString().contains("super-secret-token-value"),
                leaked.toString());

        // ---- 8. The real host token file shape is accepted ----------------
        // The host writes {version, browserToken, minecraftToken}. A real file of
        // that shape must parse, or discovery would silently never work in the
        // one case it exists for.
        Path hostShape = Files.createDirectories(root.resolve("host-shape"));
        Files.writeString(hostShape.resolve("tokens.json"),
                "{\n  \"version\": 1,\n  \"browserToken\": \"browser-value\",\n"
                        + "  \"minecraftToken\": \"minecraft-value\"\n}\n",
                StandardCharsets.UTF_8);
        Map<String, String> hostEnv = new HashMap<>();
        hostEnv.put("QUESTBRIDGE_CONFIG_DIR", hostShape.toString());
        TokenDiscovery.Result host = TokenDiscovery.discover(hostEnv, root.toString());
        check("the host's own tokens.json shape parses",
                "minecraft-value".equals(host.token()),
                host.source());
        check("the browser token is not mistaken for the minecraft token",
                !"browser-value".equals(host.token()));
    }

    private static void writeTokens(Path directory, String minecraftToken) throws IOException {
        Files.writeString(directory.resolve("tokens.json"),
                "{\n  \"version\": 1,\n  \"browserToken\": \"b\",\n  \"minecraftToken\": \""
                        + minecraftToken + "\"\n}\n",
                StandardCharsets.UTF_8);
    }

    private static void check(String name, boolean condition, String detail) {
        checks++;
        if (!condition) {
            failures++;
        }
        System.out.printf("  %s  %s%s%n", condition ? "PASS" : "FAIL", name,
                detail == null ? "" : "  (" + detail + ")");
    }

    private static void check(String name, boolean condition) {
        check(name, condition, null);
    }

    private static void deleteRecursively(Path path) throws IOException {
        if (!Files.exists(path)) {
            return;
        }
        try (var walk = Files.walk(path)) {
            List<Path> paths = walk.sorted(java.util.Comparator.reverseOrder()).toList();
            for (Path entry : paths) {
                Files.deleteIfExists(entry);
            }
        }
    }

    private DiscoveryHarness() {
    }
}
