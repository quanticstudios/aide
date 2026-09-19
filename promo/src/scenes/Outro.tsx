import {
  AbsoluteFill,
  CanvasImage,
  Easing,
  Interactive,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill
      name="Outro"
      style={{
        backgroundColor: "#07080a",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "Geist",
        color: "#f4f4f6",
        opacity: interpolate(frame, [durationInFrames - 20, durationInFrames - 1], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <CanvasImage
        name="Icon"
        src={staticFile("icon.png")}
        style={{
          width: 220,
          height: 220,
          scale: interpolate(frame, [0, 1 * fps], [0.6, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 200 }),
            output: "perceptual-scale",
          }),
          opacity: interpolate(frame, [0, 0.6 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
      <Interactive.Div
        name="Line"
        style={{
          marginTop: 48,
          fontSize: 88,
          fontWeight: 600,
          letterSpacing: -3,
          opacity: interpolate(frame, [0.6 * fps, 1.2 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Open the workspace. Not the tabs.
      </Interactive.Div>
      <Interactive.Div
        name="Studio"
        style={{
          marginTop: 32,
          fontSize: 36,
          color: "#71717a",
          letterSpacing: 6,
          opacity: interpolate(frame, [1.4 * fps, 2 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        aIDE · Quantic Studios
      </Interactive.Div>
    </AbsoluteFill>
  );
};
