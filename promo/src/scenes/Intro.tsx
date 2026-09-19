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

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      name="Intro"
      style={{
        backgroundColor: "#07080a",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "Geist",
        color: "#f4f4f6",
      }}
    >
      <CanvasImage
        name="Logo"
        src={staticFile("logo.png")}
        style={{
          width: 640,
          height: 480,
          opacity: interpolate(frame, [0, 0.8 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          scale: interpolate(frame, [0, 1.2 * fps], [0.85, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 200 }),
            output: "perceptual-scale",
          }),
        }}
      />
      <Interactive.Div
        name="Tagline"
        style={{
          marginTop: 8,
          fontSize: 56,
          fontWeight: 500,
          letterSpacing: -1,
          color: "#a1a1aa",
          opacity: interpolate(frame, [1 * fps, 1.8 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [1 * fps, 1.8 * fps], ["0px 24px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        The AI-native coding shell
      </Interactive.Div>
    </AbsoluteFill>
  );
};
