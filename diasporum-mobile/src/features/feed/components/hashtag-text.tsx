/**
 * HashtagText — renders post body text with light markdown formatting and
 * pressable #hashtags that navigate to the community-scoped tag feed.
 *
 * Supported markers (inserted by the composer toolbar, or typed by hand):
 *   **bold**  *italic*  _italic_  ~~strikethrough~~  `code`  [label](url)
 *   - bullet item   1. numbered item   - [ ] / - [x] checkbox   > quoted line
 *   # / ## / ### heading   (2+ leading spaces) indented/nested items
 */
import React, { useMemo } from "react";
import { Platform, StyleSheet, Text, type TextStyle } from "react-native";
import { router } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { ThemedText } from "@/components/themed-text";
import { BrandColors } from "@/shared/theme/colors";
import { useTheme } from "@/hooks/use-theme";

const INLINE = new RegExp(
  "(\\[[^\\]\\n]+\\]\\((?:https?:\\/\\/|www\\.)[^)\\s]+\\))" + // link
  "|(\\*\\*[^*\\n]+\\*\\*)" + // bold
  "|(~~[^~\\n]+~~)" + // strikethrough
  "|(`[^`\\n]+`)" + // code
  "|(\\*[^*\\n]+\\*|_[^\\n_]+_)" + // italic
  "|(#[\\p{L}\\p{N}_]{2,50})", // hashtag
  "gu",
);
const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;
const INDENT = /^(\s{2,}|\t)/;
const CHECKBOX = /^[-•]\s*\[([ xX])\]\s+/;
const HEADING = /^(#{1,3})\s+/;
const NUMBERED = /^(\d+)[.)]\s+/;
const BULLET = /^[-•]\s+/;
const QUOTE = /^>\s?/;

interface Part {
  key: number;
  text: string;
  tag?: string;
  link?: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  quote?: boolean;
  bullet?: boolean;
  heading?: number;
}

interface Props {
  body: string;
  style?: object;
  numberOfLines?: number;
}

type InlineFlags = Pick<
  Part,
  "bold" | "italic" | "strike" | "code" | "quote" | "link" | "heading"
>;

/** Inline-parse one line, appending parts. Marker contents are parsed
 *  recursively so #tags stay tappable and styles nest (**bold _it_**). */
function parseInline(line: string, out: Part[], flags: InlineFlags = {}) {
  let last = 0;
  const re = new RegExp(INLINE.source, "gu");
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) {
      out.push({ key: out.length, text: line.slice(last, m.index), ...flags });
    }
    const [tok] = m;
    if (tok.startsWith("[")) {
      const link = LINK.exec(tok);
      if (link) {
        parseInline(link[1], out, { ...flags, link: link[2] });
      } else {
        out.push({ key: out.length, text: tok, ...flags });
      }
    } else if (tok.startsWith("**")) {
      parseInline(tok.slice(2, -2), out, { ...flags, bold: true });
    } else if (tok.startsWith("~~")) {
      parseInline(tok.slice(2, -2), out, { ...flags, strike: true });
    } else if (tok.startsWith("`")) {
      parseInline(tok.slice(1, -1), out, { ...flags, code: true });
    } else if (tok.startsWith("*") || tok.startsWith("_")) {
      parseInline(tok.slice(1, -1), out, { ...flags, italic: true });
    } else {
      out.push({ key: out.length, text: tok, tag: tok.slice(1).toLowerCase(), ...flags });
    }
    last = m.index + tok.length;
  }
  if (last < line.length) {
    out.push({ key: out.length, text: line.slice(last), ...flags });
  }
}

export function HashtagText({ body, style, numberOfLines }: Props) {
  const theme = useTheme();
  const parts = useMemo(() => {
    const out: Part[] = [];
    body.split("\n").forEach((line, i) => {
      if (i > 0) out.push({ key: out.length, text: "\n" });
      let rest = line;
      const ind = INDENT.exec(rest);
      if (ind) {
        const depth = Math.min(4, Math.ceil(ind[1].replace(/\t/g, "  ").length / 2));
        out.push({ key: out.length, text: " ".repeat(depth * 3) });
        rest = rest.slice(ind[1].length);
      }
      const heading = HEADING.exec(rest);
      const checkbox = CHECKBOX.exec(rest);
      const numbered = NUMBERED.exec(rest);
      const bullet = BULLET.exec(rest);
      const quote = QUOTE.exec(rest);
      if (heading) {
        parseInline(rest.slice(heading[0].length), out, {
          heading: heading[1].length,
        });
      } else if (checkbox) {
        const checked = checkbox[1].toLowerCase() === "x";
        out.push({
          key: out.length,
          text: checked ? "☑  " : "☐  ",
          bullet: true,
        });
        parseInline(rest.slice(checkbox[0].length), out);
      } else if (numbered) {
        out.push({ key: out.length, text: `${numbered[1]}.  `, bullet: true });
        parseInline(rest.slice(numbered[0].length), out);
      } else if (bullet) {
        out.push({ key: out.length, text: "•  ", bullet: true });
        parseInline(rest.slice(bullet[0].length), out);
      } else if (quote) {
        out.push({ key: out.length, text: "▏", quote: true });
        parseInline(rest.slice(quote[0].length), out, { quote: true });
      } else {
        parseInline(rest, out);
      }
    });
    return out;
  }, [body]);

  return (
    <ThemedText style={style} numberOfLines={numberOfLines}>
      {parts.map((p) => (
        <Text
          key={p.key}
          style={[
            p.tag && styles.tag,
            p.link && !p.tag && styles.link,
            p.bold && styles.bold,
            (p.italic || p.quote) && styles.italic,
            p.strike && styles.strike,
            p.code && styles.code,
            p.quote && { color: theme.textSecondary },
            p.bullet && styles.bullet,
            p.heading === 1 && styles.h1,
            p.heading === 2 && styles.h2,
            p.heading === 3 && styles.h3,
          ]}
          onPress={
            p.tag
              ? () =>
                  router.push({
                    pathname: "/(app)/posts/tag/[tag]",
                    params: { tag: p.tag! },
                  })
              : p.link
                ? () =>
                    openBrowserAsync(
                      p.link!.startsWith("http") ? p.link! : `https://${p.link}`,
                    )
                : undefined
          }
          accessibilityRole={p.tag || p.link ? "link" : undefined}
          accessibilityLabel={
            p.tag ? `Hashtag ${p.text}` : p.link ? `Link ${p.text}` : undefined
          }
        >
          {p.text}
        </Text>
      ))}
    </ThemedText>
  );
}

const MONO: TextStyle["fontFamily"] =
  Platform.OS === "ios" ? "Menlo" : "monospace";

const styles = StyleSheet.create({
  tag: { color: BrandColors.primary, fontWeight: "600" },
  link: { color: BrandColors.primary, textDecorationLine: "underline" },
  h1: { fontSize: 21, fontWeight: "700", lineHeight: 27 },
  h2: { fontSize: 18, fontWeight: "700", lineHeight: 24 },
  h3: { fontSize: 16, fontWeight: "600", lineHeight: 22 },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through" },
  code: {
    fontFamily: MONO,
    fontSize: 13,
    backgroundColor: "#00000010",
    borderRadius: 3,
  },
  bullet: { color: BrandColors.primary, fontWeight: "700" },
});
