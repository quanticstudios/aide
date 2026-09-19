import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const Nav: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      name="Nav"
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
          marginBottom: 80,
          opacity: interpolate(frame, [0, 0.6 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Hands stay on the keyboard.
      </Interactive.Div>
      <Interactive.Div name="Rows" style={{ display: "flex", gap: 120, fontFamily: "Geist Mono" }}>
        <Interactive.Div
          name="Workspaces"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 28,
            opacity: interpolate(frame, [0.5 * fps, 1 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [0.5 * fps, 1.2 * fps], ["0px 30px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          <Interactive.Div name="Keys ws" style={{ display: "flex", gap: 16, fontSize: 56 }}>
            <Interactive.Div name="Alt" style={{ padding: "16px 32px", borderRadius: 14, backgroundColor: "#1c1c1f", border: "2px solid #3f3f46" }}>
              Alt
            </Interactive.Div>
            <Interactive.Div
              name="J"
              style={{
                padding: "16px 32px",
                borderRadius: 14,
                backgroundColor: "#1c1c1f",
                border: "2px solid #3f3f46",
                scale: interpolate(frame, [1.5 * fps, 1.6 * fps, 1.8 * fps], [1, 0.9, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              J
            </Interactive.Div>
            <Interactive.Div
              name="K"
              style={{
                padding: "16px 32px",
                borderRadius: 14,
                backgroundColor: "#1c1c1f",
                border: "2px solid #3f3f46",
                scale: interpolate(frame, [2.1 * fps, 2.2 * fps, 2.4 * fps], [1, 0.9, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              K
            </Interactive.Div>
          </Interactive.Div>
          <Interactive.Div name="Label ws" style={{ fontSize: 40, color: "#a1a1aa", fontFamily: "Geist" }}>
            cycle workspaces
          </Interactive.Div>
        </Interactive.Div>
        <Interactive.Div
          name="Panes"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 28,
            opacity: interpolate(frame, [0.8 * fps, 1.3 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [0.8 * fps, 1.5 * fps], ["0px 30px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          <Interactive.Div name="Keys panes" style={{ display: "flex", gap: 16, fontSize: 56 }}>
            <Interactive.Div name="Alt2" style={{ padding: "16px 32px", borderRadius: 14, backgroundColor: "#1c1c1f", border: "2px solid #3f3f46" }}>
              Alt
            </Interactive.Div>
            <Interactive.Div
              name="H"
              style={{
                padding: "16px 32px",
                borderRadius: 14,
                backgroundColor: "#1c1c1f",
                border: "2px solid #3f3f46",
                scale: interpolate(frame, [2.7 * fps, 2.8 * fps, 3 * fps], [1, 0.9, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              H
            </Interactive.Div>
            <Interactive.Div
              name="L"
              style={{
                padding: "16px 32px",
                borderRadius: 14,
                backgroundColor: "#1c1c1f",
                border: "2px solid #3f3f46",
                scale: interpolate(frame, [3.3 * fps, 3.4 * fps, 3.6 * fps], [1, 0.9, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              L
            </Interactive.Div>
          </Interactive.Div>
          <Interactive.Div name="Label panes" style={{ fontSize: 40, color: "#a1a1aa", fontFamily: "Geist" }}>
            cycle panes
          </Interactive.Div>
        </Interactive.Div>
      </Interactive.Div>
      <Interactive.Div
        name="Sub"
        style={{
          marginTop: 80,
          fontSize: 40,
          color: "#71717a",
          opacity: interpolate(frame, [2 * fps, 2.6 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Hold Alt to see every workspace. Release to land.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
