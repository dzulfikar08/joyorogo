import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { captureRef } from "react-native-view-shot";

import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import {
  CARD_H,
  CARD_W,
  StoryCard,
  type StorySpec,
} from "@/components/story/story-card";
import { instagramFbAppId, isShareCancel, shareStoryImage } from "@/components/story/share";

type ShareStoryButtonProps = {
  story: StorySpec;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "lg" | "sm";
  disabled?: boolean;
  style?: object;
};

/**
 * Renders `story` into an offscreen 1080x1920 card, captures it as a PNG and
 * hands it to Instagram Stories (Facebook App ID configured) or the system
 * share sheet. Pure data in — screens own their queries, the social feed can
 * reuse the same cards.
 */
export function ShareStoryButton({
  story,
  label = "Bagikan ke Story",
  variant = "primary",
  size,
  disabled,
  style,
}: ShareStoryButtonProps) {
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const share = async () => {
    if (!cardRef.current || busy) return;
    setBusy(true);
    try {
      const fileUri = await captureRef(cardRef, { format: "png", quality: 1 });
      await shareStoryImage(fileUri, instagramFbAppId());
    } catch (error) {
      if (!isShareCancel(error)) {
        toast.error("Gagal membagikan", "Coba lagi sebentar ya.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={style}>
      <View
        ref={cardRef}
        collapsable={false}
        pointerEvents="none"
        style={styles.offscreen}
      >
        <StoryCard story={story} />
      </View>
      <Button
        label={label}
        variant={variant}
        size={size}
        loading={busy}
        disabled={disabled}
        onPress={() => void share()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Fully offscreen but rendered: view-shot needs a mounted, non-collapsing view.
  offscreen: {
    position: "absolute",
    top: -CARD_H * 2,
    left: 0,
    width: CARD_W,
    height: CARD_H,
  },
});
