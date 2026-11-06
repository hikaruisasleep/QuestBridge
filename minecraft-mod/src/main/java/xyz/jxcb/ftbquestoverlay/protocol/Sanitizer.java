package xyz.jxcb.ftbquestoverlay.protocol;

/**
 * Coerces captured data into the value ranges protocol v1 accepts.
 *
 * <p>Protocol v1 rejects the whole message when a field violates its schema:
 * identifiers of 0 or more than 128 characters, empty required titles,
 * percentages outside 0-100, and duplicate chapter/quest/task IDs. FTB data is
 * authored by pack developers, so a single malformed quest could otherwise take
 * the entire overlay down.</p>
 *
 * <p>The rule is to drop or clamp only what cannot be represented, and to never
 * invent progression. Substitution is limited to display text that has no
 * alternative (empty titles), and is marked as such rather than passed off as
 * source data.</p>
 */
public final class Sanitizer {
    /** Protocol v1 maximum identifier length. */
    public static final int MAX_ID_LENGTH = 128;

    /** Turns text into a valid single-line protocol identifier, or null. */
    public static String id(String raw) {
        if (raw == null) {
            return null;
        }
        String cleaned = stripControlCharacters(raw).strip();
        if (cleaned.isEmpty() || cleaned.length() > MAX_ID_LENGTH) {
            return null;
        }
        return cleaned;
    }

    /** Removes control characters, which protocol v1 forbids in identifiers. */
    public static String stripControlCharacters(String value) {
        if (value == null) {
            return null;
        }
        StringBuilder builder = new StringBuilder(value.length());
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (character < 0x20 || character == 0x7f) {
                continue;
            }
            builder.append(character);
        }
        return builder.toString();
    }

    /**
     * Required titles must be non-empty. A title that is empty or blank after
     * cleaning is replaced by the caller-supplied placeholder, because a title
     * has no correct omission.
     */
    public static String requiredText(String value, String placeholder) {
        String cleaned = stripControlCharacters(value);
        if (cleaned == null || cleaned.isBlank()) {
            return placeholder;
        }
        return cleaned;
    }

    /**
     * Optional titles and subtitles are omitted when blank. Whitespace is kept
     * as newlines for multi-line subtitles, so only control characters other
     * than newline are removed.
     */
    public static String optionalMultilineText(String value) {
        if (value == null) {
            return null;
        }
        StringBuilder builder = new StringBuilder(value.length());
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (character == '\n' || character == '\r') {
                builder.append('\n');
                continue;
            }
            if (character < 0x20 || character == 0x7f) {
                continue;
            }
            builder.append(character);
        }
        String cleaned = builder.toString();
        return cleaned.isBlank() ? null : cleaned;
    }

    /** Clamps a nullable percentage into 0-100. */
    public static Integer percentage(Integer value) {
        if (value == null) {
            return null;
        }
        if (value < 0) {
            return 0;
        }
        if (value > 100) {
            return 100;
        }
        return value;
    }

    /**
     * Clamps a numeric task value to the protocol's non-negative range. A
     * negative value cannot mean anything to the overlay, and FTB does not
     * produce one; clamping keeps the task rather than rejecting the message.
     */
    public static Long nonNegative(Long value) {
        if (value == null) {
            return null;
        }
        return Math.max(0L, value);
    }
}
