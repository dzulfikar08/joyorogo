import { memo, useEffect, useMemo, type ReactElement } from "react";
import { Image, PixelRatio, StyleSheet, View } from "react-native";
import Svg, {
  ClipPath,
  Defs,
  Ellipse,
  G,
  Image as SvgImage,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import { nestedImageUris, splitSceneLayers } from "@/src/lib/scene-layers";
import {
  rogoNativeFonts,
  splitColor,
  type LinearPaint,
  type Paint,
  type RadialPaint,
  type Scene,
  type SceneNode,
  type Stop as SceneStop,
  type Stroke,
} from "@joyorogo/sticker";

/**
 * The native painter for a Scene: a 1:1 react-native-svg map, no layout. The view is
 * laid out at design px / PixelRatio dp, so a 1:1 capture is exactly 1080 px wide on
 * every device (view-shot is additionally asked for a fixed width and height).
 */

export type ImageStatus = "loaded" | "error";


type Ids = { next(prefix: string): string };

function stopsFor(stops: SceneStop[]): ReactElement[] {
  return stops.map((stop, i) => {
    const { rgb, a } = splitColor(stop.color);
    return <Stop key={i} offset={stop.at} stopColor={rgb} stopOpacity={a} />;
  });
}

function gradientRef(defs: ReactElement[], ids: Ids, paint: LinearPaint | RadialPaint): string {
  const id = ids.next("g");
  if ("linear" in paint) {
    const { x1, y1, x2, y2, stops } = paint.linear;
    defs.push(
      <LinearGradient key={id} id={id} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
        {stopsFor(stops)}
      </LinearGradient>,
    );
  } else {
    const { cx, cy, r, stops } = paint.radial;
    defs.push(
      <RadialGradient key={id} id={id} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={r} fx={cx} fy={cy}>
        {stopsFor(stops)}
      </RadialGradient>,
    );
  }
  return `url(#${id})`;
}

function fillProps(defs: ReactElement[], ids: Ids, fill: Paint | undefined) {
  if (fill === undefined) return { fill: "none" };
  if (typeof fill === "string") {
    const { rgb, a } = splitColor(fill);
    return { fill: rgb, fillOpacity: a };
  }
  return { fill: gradientRef(defs, ids, fill) };
}

function strokeProps(defs: ReactElement[], ids: Ids, stroke: Stroke | undefined) {
  if (!stroke) return {};
  const color =
    typeof stroke.color === "string"
      ? (() => {
          const { rgb, a } = splitColor(stroke.color);
          return { stroke: rgb, strokeOpacity: a };
        })()
      : { stroke: gradientRef(defs, ids, stroke.color) };
  return {
    ...color,
    strokeWidth: stroke.width,
    strokeLinecap: stroke.cap,
    strokeLinejoin: stroke.join,
    strokeDasharray: stroke.dash ? [stroke.dash[0], stroke.dash[1]] : undefined,
  };
}

type Ctx = {
  defs: ReactElement[];
  ids: Ids;
  onImage?: (uri: string, status: ImageStatus) => void;
};

const n2 = (v: number) => Math.round(v * 100) / 100;

function renderNode(node: SceneNode, key: string, ctx: Ctx): ReactElement {
  const { defs, ids } = ctx;
  switch (node.k) {
    case "rect":
      return (
        <Rect
          key={key}
          x={node.x}
          y={node.y}
          width={node.w}
          height={node.h}
          rx={node.rx}
          opacity={node.opacity}
          {...fillProps(defs, ids, node.fill)}
          {...strokeProps(defs, ids, node.stroke)}
        />
      );
    case "ellipse":
      return (
        <Ellipse
          key={key}
          cx={node.cx}
          cy={node.cy}
          rx={node.rx}
          ry={node.ry}
          opacity={node.opacity}
          {...fillProps(defs, ids, node.fill)}
          {...strokeProps(defs, ids, node.stroke)}
        />
      );
    case "path": {
      const t = node.transform;
      const path = (
        <Path
          key={t ? undefined : key}
          d={node.d}
          fillRule={node.fillRule}
          opacity={node.opacity}
          {...fillProps(defs, ids, node.fill)}
          {...strokeProps(defs, ids, node.stroke)}
        />
      );
      if (!t) return path;
      const transform = `translate(${n2(t.x)} ${n2(t.y)})${t.rotate ? ` rotate(${n2(t.rotate)})` : ""} scale(${t.scale})`;
      return (
        <G key={key} transform={transform}>
          {path}
        </G>
      );
    }
    case "text": {
      const { rgb, a } = splitColor(node.fill);
      const paint = rogoNativeFonts.paint(node.font, node.weight);
      return (
        <SvgText
          key={key}
          x={node.x}
          y={node.y}
          fontFamily={paint.family}
          fontSize={node.size}
          fill={rgb}
          fillOpacity={a}
          textAnchor={node.anchor}
          letterSpacing={node.letterSpacing}
          opacity={node.opacity}
        >
          {node.text}
        </SvgText>
      );
    }
    case "image": {
      let clipPath: string | undefined;
      if (node.rx) {
        const id = ids.next("c");
        defs.push(
          <ClipPath key={id} id={id}>
            <Rect x={node.x} y={node.y} width={node.w} height={node.h} rx={Math.min(node.rx, Math.min(node.w, node.h) / 2)} />
          </ClipPath>,
        );
        clipPath = `url(#${id})`;
      }
      return (
        <SvgImage
          key={key}
          x={node.x}
          y={node.y}
          width={node.w}
          height={node.h}
          href={{ uri: node.uri }}
          preserveAspectRatio={node.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
          opacity={node.opacity}
          clipPath={clipPath}
          onLoad={() => ctx.onImage?.(node.uri, "loaded")}
        />
      );
    }
    case "group": {
      let clipPath: string | undefined;
      if (node.clip) {
        const id = ids.next("c");
        const c = node.clip;
        defs.push(
          <ClipPath key={id} id={id}>
            <Rect x={c.x} y={c.y} width={c.w} height={c.h} rx={c.rx} />
          </ClipPath>,
        );
        clipPath = `url(#${id})`;
      }
      const transform = node.rotate
        ? `rotate(${n2(node.rotate.deg)} ${n2(node.rotate.cx)} ${n2(node.rotate.cy)})`
        : undefined;
      return (
        <G key={key} opacity={node.opacity} clipPath={clipPath} transform={transform}>
          {node.children.map((child, i) => renderNode(child, `${key}.${i}`, ctx))}
        </G>
      );
    }
  }
}

/** dp size of a design-px length, rounded so px * ratio stays integral. */
export const designToDp = (px: number) => Math.round((px / PixelRatio.get()) * 100) / 100;

export const SceneView = memo(function SceneView({
  scene,
  onImage,
}: {
  scene: Scene;
  onImage?: (uri: string, status: ImageStatus) => void;
}) {
  const layers = useMemo(() => {
    let count = 0;
    const ids: Ids = { next: (prefix) => `${prefix}${count++}` };
    return splitSceneLayers(scene.nodes).map((layer, li) => {
      if (layer.kind === "image") return { kind: "image" as const, node: layer.node, key: `l${li}` };
      const ctx: Ctx = { defs: [], ids, onImage };
      const nodes = layer.nodes.map((node, i) => renderNode(node, `l${li}n${i}`, ctx));
      return { kind: "svg" as const, defs: ctx.defs, nodes, key: `l${li}` };
    });
  }, [scene, onImage]);

  // Images nested in groups are painted by the Svg, which cannot report loads: treat them as ready.
  useEffect(() => {
    for (const uri of nestedImageUris(scene.nodes)) onImage?.(uri, "loaded");
  }, [scene, onImage]);

  const w = designToDp(scene.width);
  const h = designToDp(scene.height);
  return (
    <View style={{ width: w, height: h }}>
      {layers.map((layer) =>
        layer.kind === "svg" ? (
          <Svg
            key={layer.key}
            width={w}
            height={h}
            viewBox={`0 0 ${scene.width} ${scene.height}`}
            style={StyleSheet.absoluteFill}
          >
            {layer.defs.length ? <Defs>{layer.defs}</Defs> : null}
            {layer.nodes}
          </Svg>
        ) : (
          <SceneImage key={layer.key} node={layer.node} onImage={onImage} />
        ),
      )}
    </View>
  );
});

function SceneImage({
  node,
  onImage,
}: {
  node: Extract<SceneNode, { k: "image" }>;
  onImage?: (uri: string, status: ImageStatus) => void;
}) {
  const radius = node.rx ? designToDp(Math.min(node.rx, Math.min(node.w, node.h) / 2)) : 0;
  return (
    <Image
      source={{ uri: node.uri }}
      resizeMode={node.fit}
      onLoad={() => onImage?.(node.uri, "loaded")}
      onError={() => onImage?.(node.uri, "error")}
      fadeDuration={0}
      style={{
        position: "absolute",
        left: designToDp(node.x),
        top: designToDp(node.y),
        width: designToDp(node.w),
        height: designToDp(node.h),
        borderRadius: radius,
        opacity: node.opacity,
        overflow: "hidden",
      }}
    />
  );
}
