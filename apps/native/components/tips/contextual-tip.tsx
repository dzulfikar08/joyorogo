import { TIPS, type Tip, type TipTag } from "@joyorogo/api/lib/tips";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { TipCard } from "@/components/tips/tip-card";

type Trigger = { test: RegExp; tags: TipTag[]; label: string };

/** Pemicu murah dari nama item hasil scan; tidak ada panggilan jaringan. */
const TRIGGERS: Trigger[] = [
  {
    test: /es teh|teh manis|soda|jus|syrup|sirup|gula aren|minuman manis/i,
    tags: ["sugary-drink"],
    label: "Ada minuman manis di piringmu",
  },
  {
    test: /saus|mayones|mayo|kecap|minyak|goreng|mentega/i,
    tags: ["sauce", "fried"],
    label: "Ada saus atau gorengan di piringmu",
  },
];

/**
 * Saran tips kontekstual setelah scan: kalau ada item yang cocok dengan
 * pemicu di atas, tawarkan artikel terkait. Seluruh kontennya statis dari
 * @joyorogo/api/lib/tips.
 */
export function ContextualTip({ names }: { names: string[] }) {
  const joined = names.join(" ");
  const trigger = TRIGGERS.find((candidate) => candidate.test.test(joined));
  if (!trigger) return null;
  const tip: Tip | undefined = TIPS.find((candidate) =>
    candidate.tags?.some((tag) => trigger.tags.includes(tag)),
  );
  if (!tip) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.note}>{trigger.label}</Text>
      <TipCard tip={tip} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    gap: theme.spacing.sm,
  },
  note: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
}));
