import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const Model: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      name="Model"
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
          fontSize: 96,
          fontWeight: 600,
          letterSpacing: -3,
          marginBottom: 64,
          opacity: interpolate(frame, [0, 0.6 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        One workspace. Every surface.
      </Interactive.Div>
      <Interactive.Div
        name="Tree"
        style={{
          display: "flex",
          gap: 28,
          fontSize: 44,
          fontFamily: "Geist Mono",
          alignItems: "center",
        }}
      >
        <Interactive.Div
          name="Project"
          style={{
            padding: "18px 36px",
            borderRadius: 16,
            border: "2px solid #27272a",
            color: "#a1a1aa",
            opacity: interpolate(frame, [0.6 * fps, 1 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [0.6 * fps, 1.2 * fps], ["0px 30px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          Project
        </Interactive.Div>
        <Interactive.Div
          name="Arrow1"
          style={{
            color: "#3f3f46",
            opacity: interpolate(frame, [1 * fps, 1.3 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          →
        </Interactive.Div>
        <Interactive.Div
          name="Workspace"
          style={{
            padding: "18px 36px",
            borderRadius: 16,
            border: "2px solid #6d3cff",
            backgroundColor: "#15102a",
            color: "#f4f4f6",
            fontWeight: 600,
            opacity: interpolate(frame, [1.1 * fps, 1.5 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            scale: interpolate(frame, [1.1 * fps, 1.9 * fps], [0.8, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.spring({ damping: 200 }),
              output: "perceptual-scale",
            }),
          }}
        >
          Workspace
        </Interactive.Div>
        <Interactive.Div
          name="Arrow2"
          style={{
            color: "#3f3f46",
            opacity: interpolate(frame, [1.6 * fps, 1.9 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          →
        </Interactive.Div>
        <Interactive.Div
          name="Panes"
          style={{
            display: "flex",
            gap: 14,
            fontSize: 34,
            opacity: interpolate(frame, [1.8 * fps, 2.2 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [1.8 * fps, 2.4 * fps], ["-30px 0px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          <Interactive.Div name="Pane chat" style={{ padding: "12px 22px", borderRadius: 12, backgroundColor: "#1c1c1f", color: "#d4d4d8" }}>
            chat
          </Interactive.Div>
          <Interactive.Div name="Pane terminal" style={{ padding: "12px 22px", borderRadius: 12, backgroundColor: "#1c1c1f", color: "#d4d4d8" }}>
            terminal
          </Interactive.Div>
          <Interactive.Div name="Pane git" style={{ padding: "12px 22px", borderRadius: 12, backgroundColor: "#1c1c1f", color: "#d4d4d8" }}>
            git
          </Interactive.Div>
          <Interactive.Div name="Pane preview" style={{ padding: "12px 22px", borderRadius: 12, backgroundColor: "#1c1c1f", color: "#d4d4d8" }}>
            preview
          </Interactive.Div>
          <Interactive.Div name="Pane jobs" style={{ padding: "12px 22px", borderRadius: 12, backgroundColor: "#1c1c1f", color: "#d4d4d8" }}>
            jobs
          </Interactive.Div>
        </Interactive.Div>
      </Interactive.Div>
      <Interactive.Div
        name="Sub"
        style={{
          marginTop: 72,
          fontSize: 40,
          color: "#71717a",
          opacity: interpolate(frame, [2.6 * fps, 3.2 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Each workspace is a git worktree with its own layout, jobs and notifications.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
