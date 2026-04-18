import "./index.css";
import { Composition } from "remotion";
import { AnimatedBarChart } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AnimatedBarChart5Bars"
        component={AnimatedBarChart}
        durationInFrames={150}
        fps={30}
        width={1280}
        height={720}
        defaultProps={{
          title: "Quarterly Revenue",
          subtitle: "Animated 5-bar chart in Remotion",
          bars: [
            { label: "Q1", value: 42, color: "#60a5fa" },
            { label: "Q2", value: 57, color: "#34d399" },
            { label: "Q3", value: 68, color: "#f59e0b" },
            { label: "Q4", value: 83, color: "#f97316" },
            { label: "Q5", value: 74, color: "#f472b6" },
          ],
        }}
      />
    </>
  );
};
