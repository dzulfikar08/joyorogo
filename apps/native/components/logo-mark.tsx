import Svg, { Ellipse, Path } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";

/**
 * JoyoRogo mark: a progress ring filled clockwise from 12 o'clock, the last
 * gap holding one rice grain. Same geometry as apps/web/public/brand/logo-mark.svg.
 */
export function LogoMark({ size = 64 }: { size?: number }) {
  const { theme } = useUnistyles();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden>
      <Path
        d="M37.56 11.23A21.5 21.5 0 1 1 11.23 26.44"
        fill="none"
        stroke={theme.colors.primary}
        strokeWidth={12}
        strokeLinecap="round"
      />
      <Ellipse
        cx={21.25}
        cy={13.38}
        rx={8}
        ry={5.2}
        transform="rotate(330 21.25 13.38)"
        fill={theme.colors.bakar}
      />
    </Svg>
  );
}
