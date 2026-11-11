import Svg, { Polygon, Polyline, Rect } from "react-native-svg";

import { colors } from "@/lib/seegson-theme";

type Props = {
  size?: number;
  color?: string;
  accent?: string;
  /** Dibuja el octógono exterior. En tamaños muy pequeños se ve mejor sin él. */
  ring?: boolean;
};

/** Marca original de Seegson: octógono industrial, "S" angular y punto de señal. */
export function SeegsonLogo({ size = 40, color = colors.amber, accent = colors.teal, ring = true }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="Seegson">
      {ring && (
        <Polygon
          points="31,5 69,5 95,31 95,69 69,95 31,95 5,69 5,31"
          fill="none"
          stroke={color}
          strokeWidth={4.5}
          strokeLinejoin="miter"
        />
      )}
      <Polyline
        points="69,32 40,32 31,41 31,47 40,56 60,56 69,65 69,71 60,80 30,80"
        fill="none"
        stroke={color}
        strokeWidth={8.5}
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
      <Rect x={72} y={22} width={9} height={9} fill={accent} />
    </Svg>
  );
}
