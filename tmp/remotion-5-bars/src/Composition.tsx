import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export type AnimatedBarChartProps = {
  title: string;
  subtitle: string;
  bars: Array<{
    label: string;
    value: number;
    color: string;
  }>;
};

const CHART_HEIGHT = 430;
const BAR_WIDTH = 120;
const BAR_GAP = 34;
const MAX_VALUE = 100;

export const AnimatedBarChart: React.FC<AnimatedBarChartProps> = ({ title, subtitle, bars }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const barAreaWidth = bars.length * BAR_WIDTH + (bars.length - 1) * BAR_GAP;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background:
          "radial-gradient(circle at 10% 15%, #1c2541 0%, #10172a 45%, #080c18 100%)",
        color: "#eef2ff",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 30 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 62,
            letterSpacing: 0.5,
            fontWeight: 700,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            marginTop: 10,
            marginBottom: 0,
            fontSize: 26,
            opacity: interpolate(frame, [0, fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            }),
          }}
        >
          {subtitle}
        </p>
      </div>

      <div
        style={{
          width: barAreaWidth,
          height: CHART_HEIGHT + 60,
          display: "flex",
          alignItems: "flex-end",
          gap: BAR_GAP,
          borderBottom: "2px solid rgba(226, 232, 240, 0.55)",
          paddingBottom: 18,
        }}
      >
        {bars.map((bar, index) => {
          const growth = spring({
            frame,
            fps,
            delay: index * 7,
            config: {
              damping: 16,
              mass: 0.85,
              stiffness: 120,
            },
          });

          const barHeight = (bar.value / MAX_VALUE) * CHART_HEIGHT * growth;
          const labelOpacity = interpolate(frame, [18 + index * 7, 35 + index * 7], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          return (
            <div
              key={bar.label}
              style={{
                width: BAR_WIDTH,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  marginBottom: 12,
                  fontSize: 30,
                  fontWeight: 600,
                  opacity: labelOpacity,
                  transform: `translateY(${interpolate(
                    frame,
                    [18 + index * 7, 35 + index * 7],
                    [14, 0],
                    {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.out(Easing.cubic),
                    },
                  )}px)`,
                }}
              >
                {Math.round(bar.value)}
              </div>
              <div
                style={{
                  width: "100%",
                  height: barHeight,
                  minHeight: 8,
                  borderRadius: "14px 14px 8px 8px",
                  background: `linear-gradient(180deg, ${bar.color}, ${bar.color}cc)`,
                  boxShadow: `0 16px 30px ${bar.color}55`,
                }}
              />
              <div
                style={{
                  marginTop: 16,
                  fontSize: 24,
                  fontWeight: 500,
                  opacity: 0.95,
                }}
              >
                {bar.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
