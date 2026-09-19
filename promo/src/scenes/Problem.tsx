import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      name="Problem"
      style={{
        backgroundColor: "#07080a",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "Geist",
        color: "#f4f4f6",
      }}
    >
      <Interactive.Div
        name="Headline"
        style={{
          fontSize: 120,
          fontWeight: 600,
          letterSpacing: -4,
          opacity: interpolate(frame, [0, 0.7 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Too many surfaces.
      </Interactive.Div>
      <Interactive.Div
        name="Chat"
        style={{
          position: "absolute",
          left: 220,
          top: 200,
          fontSize: 48,
          fontFamily: "Geist Mono",
          color: "#71717a",
          rotate: "-6deg",
          opacity: interpolate(frame, [0.6 * fps, 1.1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [0.6 * fps, 4 * fps], ["0px 0px", "-60px -40px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        4 chats
      </Interactive.Div>
      <Interactive.Div
        name="Terminals"
        style={{
          position: "absolute",
          right: 240,
          top: 240,
          fontSize: 48,
          fontFamily: "Geist Mono",
          color: "#71717a",
          rotate: "5deg",
          opacity: interpolate(frame, [0.8 * fps, 1.3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [0.8 * fps, 4 * fps], ["0px 0px", "70px -30px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        9 terminals
      </Interactive.Div>
      <Interactive.Div
        name="Git"
        style={{
          position: "absolute",
          left: 300,
          bottom: 220,
          fontSize: 48,
          fontFamily: "Geist Mono",
          color: "#71717a",
          rotate: "4deg",
          opacity: interpolate(frame, [1 * fps, 1.5 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [1 * fps, 4 * fps], ["0px 0px", "-50px 50px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        3 dirty worktrees
      </Interactive.Div>
      <Interactive.Div
        name="Jobs"
        style={{
          position: "absolute",
          right: 200,
          bottom: 260,
          fontSize: 48,
          fontFamily: "Geist Mono",
          color: "#71717a",
          rotate: "-3deg",
          opacity: interpolate(frame, [1.2 * fps, 1.7 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [1.2 * fps, 4 * fps], ["0px 0px", "60px 40px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        agents running somewhere
      </Interactive.Div>
    </AbsoluteFill>
  );
};
