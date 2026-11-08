/**
 * HashtagText — renders post body text with pressable #hashtags that
 * navigate to the community-scoped tag feed.
 */

import React, { useMemo } from "react";
import { StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { BrandColors } from "@/shared/theme/colors";

const TAG = /#[\p{L}\p{N}_]{2,50}/gu;

interface Props {
  body: string;
  style?: object;
  numberOfLines?: number;
}

export function HashtagText({ body, style, numberOfLines }: Props) {
  const parts = useMemo(() => {
    const out: { key: number; text: string; tag?: string }[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    const re = new RegExp(TAG.source, "g"); // fresh regex — TAG's lastIndex must not be mutated
    while ((m = re.exec(body))) {
      if (m.index > last) out.push({ key: out.length, text: body.slice(last, m.index) });
      out.push({ key: out.length, text: m[0], tag: m[0].slice(1).toLowerCase() });
      last = m.index + m[0].length;
    }
    if (last < body.length) out.push({ key: out.length, text: body.slice(last) });
    return out;
  }, [body]);

  return (
    <ThemedText style={style} numberOfLines={numberOfLines}>
      {parts.map((p) =>
        p.tag ? (
          <Text
            key={p.key}
            style={styles.tag}
            onPress={() =>
              router.push({
                pathname: "/(app)/posts/tag/[tag]",
                params: { tag: p.tag! },
              })
            }
            accessibilityRole="link"
            accessibilityLabel={`Hashtag ${p.text}`}
          >
            {p.text}
          </Text>
        ) : (
          <Text key={p.key}>{p.text}</Text>
        ),
      )}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  tag: { color: BrandColors.primary, fontWeight: "600" },
});
