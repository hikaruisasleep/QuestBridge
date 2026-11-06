package xyz.jxcb.ftbquestoverlay.transport;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/**
 * Logging facade for transport code.
 *
 * <p>Transport classes must not reference the mod entry class. During Stage 4C a
 * transport log call made from a socket callback ran where the FML classes were
 * not resolvable, and the resulting {@code NoClassDefFoundError} surfaced as a
 * dropped WebSocket with no diagnostic at all. Keeping transport logging
 * self-contained removes that failure path.</p>
 *
 * <p>The mod's logger is reached by reflection and only if it loads; otherwise
 * output goes to stdout. Callers pass only message types, sizes, phases, and
 * host-declared values. The token and the server address are never passed here.</p>
 */
final class TransportLog {
    private static final boolean TRACE = Boolean.getBoolean("questbridge.transportTrace");

    private static volatile Object modLogger;
    private static volatile boolean modLoggerResolved;

    private TransportLog() {
    }

    static void info(String format, Object... args) {
        write("info", "INFO", render(format, args));
    }

    static void warn(String format, Object... args) {
        write("warn", "WARN", render(format, args));
    }

    static void error(String format, Object... args) {
        write("error", "ERROR", render(format, args));
    }

    static void error(String format, Throwable failure) {
        write("error", "ERROR", render(format) + describe(failure));
    }

    static void debug(String format, Object... args) {
        if (TRACE) {
            write("debug", "DEBUG", render(format, args));
        }
    }

    static void debug(String format, Throwable failure) {
        if (TRACE) {
            write("debug", "DEBUG", render(format) + describe(failure));
        }
    }

    static void warn(String format, Throwable failure) {
        write("warn", "WARN", render(format) + describe(failure));
    }

    private static String render(String format, Object... args) {
        if (args == null || args.length == 0) {
            return format;
        }
        try {
            return String.format(format, args);
        } catch (RuntimeException malformed) {
            // A bad format string must never break the transport.
            return format + " " + java.util.Arrays.toString(args);
        }
    }

    private static String describe(Throwable failure) {
        if (failure == null) {
            return "";
        }
        String detail = failure.getMessage() == null ? "" : ": " + failure.getMessage();
        return " (" + failure.getClass().getSimpleName() + detail + ")";
    }

    private static void write(String method, String level, String message) {
        String line = "[QuestBridge] " + level + " " + message;

        Object logger = modLogger();
        if (logger != null) {
            try {
                Method target = logger.getClass().getMethod(method, String.class);
                target.invoke(logger, line);
                return;
            } catch (InvocationTargetException | IllegalAccessException | NoSuchMethodException
                    | RuntimeException failure) {
                // Fall through to stdout rather than losing the message.
                System.out.println(line);
                return;
            }
        }

        if (!"INFO".equals(level) || TRACE) {
            System.out.println(line);
        }
    }

    /**
     * Resolves the mod logger reflectively, once. Returns null when the FML
     * classes are not present, which is the case in a standalone harness.
     */
    private static Object modLogger() {
        if (modLoggerResolved) {
            return modLogger;
        }
        synchronized (TransportLog.class) {
            if (modLoggerResolved) {
                return modLogger;
            }
            try {
                Class<?> mod = Class.forName("xyz.jxcb.ftbquestoverlay.QuestBridge", false,
                        TransportLog.class.getClassLoader());
                modLogger = mod.getField("LOGGER").get(null);
            } catch (Throwable unavailable) {
                modLogger = null;
            }
            modLoggerResolved = true;
            return modLogger;
        }
    }
}
