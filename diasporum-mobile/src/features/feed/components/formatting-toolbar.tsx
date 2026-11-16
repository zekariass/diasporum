/**
 * FormattingToolbar — composer toolbar that inserts markdown-lite markers
 * (**bold**, *italic*, ~~strike~~, `code`, - bullets, 1. numbered, - [ ]
 * checkboxes, > quotes, # headings, [text](url) links, leading-space indents)
 * into a plain TextInput around the current selection. HashtagText renders
 * them as styled text everywhere the post appears.
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/use-theme";

export interface TextRange {
  start: number;
  end: number;
}

export interface TextPatch {
  text: string;
  selection: TextRange;
}

/** Wrap the selection in `marker`; unwraps when it's already wrapped. */
export function wrapMarker(text: string, sel: TextRange, marker: string): TextPatch {
  const selected = text.slice(sel.start, sel.end);
  const before = text.slice(Math.max(0, sel.start - marker.length), sel.start);
  const after = text.slice(sel.end, sel.end + marker.length);
  if (before === marker && after === marker) {
    const next =
      text.slice(0, sel.start - marker.length) +
      selected +
      text.slice(sel.end + marker.length);
    return {
      text: next,
      selection: { start: sel.start - marker.length, end: sel.end - marker.length },
    };
  }
  const next = text.slice(0, sel.start) + marker + selected + marker + text.slice(sel.end);
  const cursor = selected
    ? sel.end + marker.length * 2
    : sel.start + marker.length;
  return { text: next, selection: { start: cursor, end: cursor } };
}

/** Start/end offsets of every line the selection touches. */
function lineBounds(text: string, sel: TextRange): { lineStart: number; lineEnd: number } {
  const lineStart = text.lastIndexOf("\n", sel.start - 1) + 1;
  let selEnd = sel.end;
  if (selEnd > sel.start && text[selEnd - 1] === "\n") selEnd -= 1;
  const nl = text.indexOf("\n", selEnd);
  return { lineStart, lineEnd: nl === -1 ? text.length : nl };
}

/** Replace the touched-line block and pick a sensible post-edit selection. */
function patchLines(
  text: string,
  sel: TextRange,
  transform: (lines: string[]) => string[],
  caretShift = 0,
): TextPatch {
  const { lineStart, lineEnd } = lineBounds(text, sel);
  const block = transform(text.slice(lineStart, lineEnd).split("\n")).join("\n");
  const next = text.slice(0, lineStart) + block + text.slice(lineEnd);
  if (sel.start === sel.end) {
    const pos = Math.max(lineStart, Math.min(lineStart + block.length, sel.start + caretShift));
    return { text: next, selection: { start: pos, end: pos } };
  }
  return { text: next, selection: { start: lineStart, end: lineStart + block.length } };
}

/** Toggle a line-start prefix ("- ", "> ") on every line the selection touches. */
export function prefixLine(text: string, sel: TextRange, prefix: string): TextPatch {
  const { lineStart, lineEnd } = lineBounds(text, sel);
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const allSet = lines.every((l) => l.startsWith(prefix));
  return patchLines(
    text,
    sel,
    () => lines.map((l) => (allSet ? l.slice(prefix.length) : l.startsWith(prefix) ? l : prefix + l)),
    (allSet ? -1 : 1) * prefix.length,
  );
}

/** Cycle the touched lines through heading levels: none → # → ## → ### → none. */
export function cycleHeading(text: string, sel: TextRange): TextPatch {
  const { lineStart, lineEnd } = lineBounds(text, sel);
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const m = /^(#{1,3})\s+/.exec(lines[0]);
  const level = m ? (m[1].length >= 3 ? 0 : m[1].length + 1) : 1;
  return patchLines(
    text,
    sel,
    () =>
      lines.map((l) => {
        const stripped = l.replace(/^#{1,3}\s+/, "");
        return level === 0 ? stripped : "#".repeat(level) + " " + stripped;
      }),
    level === 0 ? -((m?.[1].length ?? 0) + 1) : level + 1,
  );
}

/** Toggle "1. " numbering — continues the previous numbered line, else starts at 1. */
export function numberLines(text: string, sel: TextRange): TextPatch {
  const { lineStart, lineEnd } = lineBounds(text, sel);
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const NUMBERED = /^\d+[.)]\s+/;
  if (lines.every((l) => NUMBERED.test(l))) {
    return patchLines(text, sel, () => lines.map((l) => l.replace(NUMBERED, "")), -3);
  }
  let startNum = 1;
  if (lineStart > 0) {
    const prevStart = text.lastIndexOf("\n", lineStart - 2) + 1;
    const prev = /^(\d+)[.)]\s/.exec(text.slice(prevStart, lineStart - 1));
    if (prev) startNum = Number(prev[1]) + 1;
  }
  const marker = `${startNum}. `;
  return patchLines(
    text,
    sel,
    () => lines.map((l, i) => (NUMBERED.test(l) ? l : `${startNum + i}. ${l}`)),
    marker.length,
  );
}

/** Toggle "- [ ] " checkboxes on the touched lines. */
export function checkboxLines(text: string, sel: TextRange): TextPatch {
  const { lineStart, lineEnd } = lineBounds(text, sel);
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const CHECKED = /^[-•]\s*\[[ xX]\]\s+/;
  if (lines.every((l) => CHECKED.test(l))) {
    return patchLines(text, sel, () => lines.map((l) => l.replace(CHECKED, "")), -6);
  }
  return patchLines(text, sel, () =>
    lines.map((l) => (CHECKED.test(l) ? l : `- [ ] ${l}`)), 6,
  );
}

/** Indent/outdent the touched lines by two spaces (nested bullets/quotes). */
export function indentLines(text: string, sel: TextRange, dir: 1 | -1): TextPatch {
  return patchLines(
    text,
    sel,
    (lines) => lines.map((l) => (dir > 0 ? "  " + l : l.replace(/^ {1,2}/, ""))),
    dir * 2,
  );
}

/**
 * Detect Enter pressed at the end of a list/quote line and continue it:
 * "1. item↵" → "2. ", "- [ ] x↵" → "- [ ] ", "- x↵" → "- ", "> x↵" → "> ".
 * Pressing Enter on an empty marker exits the list instead. Returns null when
 * the change isn't a single newline insertion after a marker.
 */
export function continueList(
  prev: string,
  sel: TextRange,
  next: string,
): TextPatch | null {
  if (sel.start !== sel.end) return null;
  const at = sel.start;
  if (next.length !== prev.length + 1) return null;
  if (next[at] !== "\n") return null;
  if (next.slice(0, at) !== prev.slice(0, at)) return null;
  if (next.slice(at + 1) !== prev.slice(at)) return null;
  const lineStart = prev.lastIndexOf("\n", at - 1) + 1;
  const line = prev.slice(lineStart, at);
  const m = /^(\s*)(- \[[ xX]\] |[-•] |(\d+)[.)] |> )/.exec(line);
  if (!m) return null;
  const [full, indent, marker, num] = m;
  if (line === full) {
    // Empty item — drop the marker (and the newline) to exit the list.
    const patched = prev.slice(0, lineStart) + prev.slice(at);
    return { text: patched, selection: { start: lineStart, end: lineStart } };
  }
  const nextMarker =
    num !== undefined ? `${Number(num) + 1}. ` : marker.startsWith("- [") ? "- [ ] " : marker;
  const patched = next.slice(0, at + 1) + indent + nextMarker + next.slice(at + 1);
  const pos = at + 1 + indent.length + nextMarker.length;
  return { text: patched, selection: { start: pos, end: pos } };
}

/** Wrap the selection as [label](url); placeholders are pre-selected for typing over. */
export function linkify(text: string, sel: TextRange): TextPatch {
  const selected = text.slice(sel.start, sel.end);
  if (selected) {
    const insert = `[${selected}](https://)`;
    const next = text.slice(0, sel.start) + insert + text.slice(sel.end);
    const urlStart = sel.start + selected.length + 3;
    return { text: next, selection: { start: urlStart, end: urlStart + 8 } };
  }
  const insert = "[label](https://)";
  const next = text.slice(0, sel.start) + insert + text.slice(sel.end);
  return { text: next, selection: { start: sel.start + 1, end: sel.start + 6 } };
}

export function FormattingToolbar({
  text,
  selection,
  onChange,
  disabled = false,
}: {
  text: string;
  selection: TextRange;
  onChange: (patch: TextPatch) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const tools: {
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    label: string;
    run: () => TextPatch;
  }[] = [
    { icon: "format-header-pound", label: "Heading", run: () => cycleHeading(text, selection) },
    { icon: "format-bold", label: "Bold", run: () => wrapMarker(text, selection, "**") },
    { icon: "format-italic", label: "Italic", run: () => wrapMarker(text, selection, "*") },
    { icon: "format-strikethrough-variant", label: "Strikethrough", run: () => wrapMarker(text, selection, "~~") },
    { icon: "code-tags", label: "Code", run: () => wrapMarker(text, selection, "`") },
    { icon: "link-variant", label: "Link", run: () => linkify(text, selection) },
    { icon: "format-list-bulleted", label: "Bullet list", run: () => prefixLine(text, selection, "- ") },
    { icon: "format-list-numbered", label: "Numbered list", run: () => numberLines(text, selection) },
    { icon: "format-list-checkbox", label: "Checklist", run: () => checkboxLines(text, selection) },
    { icon: "format-quote-close", label: "Quote", run: () => prefixLine(text, selection, "> ") },
    { icon: "format-indent-increase", label: "Indent", run: () => indentLines(text, selection, 1) },
    { icon: "format-indent-decrease", label: "Outdent", run: () => indentLines(text, selection, -1) },
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.row}
      accessibilityRole="toolbar"
    >
      {tools.map((tool) => (
        <Pressable
          key={tool.icon}
          onPress={() => onChange(tool.run())}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={tool.label}
          hitSlop={4}
          style={({ pressed }) => [
            styles.tool,
            { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            pressed && { opacity: 0.7 },
            disabled && { opacity: 0.4 },
          ]}
        >
          <MaterialCommunityIcons name={tool.icon} size={16} color={theme.textSecondary} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, marginBottom: 6 },
  tool: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
