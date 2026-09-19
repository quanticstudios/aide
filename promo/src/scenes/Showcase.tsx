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

type Props = {
  image: string;
  imageWidth: number;
  imageHeight: number;
  title: string;
  sub: string;
};

export const Showcase: React.FC<Props> = ({ image, imageWidth, imageHeight, title, sub }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      name="Showcase"
      style={{
        backgroundColor: "#07080a",
        fontFamily: "Geist",
        color: "#f4f4f6",
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 100,
        gap: 60,
      }}
    >
      <Interactive.Div
        name="Copy"
        style={{
          width: 620,
          flexShrink: 0,
          opacity: interpolate(frame, [0, 0.6 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [0, 0.8 * fps], ["0px 30px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Interactive.Div name="Title" style={{ fontSize: 84, fontWeight: 600, letterSpacing: -3, lineHeight: 1.05 }}>
          {title}
        </Interactive.Div>
        <Interactive.Div name="Sub" style={{ marginTop: 28, fontSize: 40, color: "#a1a1aa", lineHeight: 1.3 }}>
          {sub}
        </Interactive.Div>
      </Interactive.Div>
      <Interactive.Div
        name="Frame"
        style={{
          borderRadius: 20,
          overflow: "hidden",
          border: "2px solid #27272a",
          boxShadow: "0 40px 120px rgba(0,0,0,0.7)",
          opacity: interpolate(frame, [0.2 * fps, 0.9 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [0.2 * fps, 1.2 * fps], ["120px 0px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          scale: interpolate(frame, [1.2 * fps, 6 * fps], [1, 1.04], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <CanvasImage
          name="Screenshot"
          src={staticFile(image)}
          style={{ width: imageWidth, height: imageHeight, display: "block" }}
        />
      </Interactive.Div>
    </AbsoluteFill>
  );
};
