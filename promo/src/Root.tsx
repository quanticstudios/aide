import "./index.css";
import { Composition, Folder } from "remotion";
import { fontsReady } from "./fonts";
import { Promo } from "./Promo";
import { Intro } from "./scenes/Intro";
import { Problem } from "./scenes/Problem";
import { Model } from "./scenes/Model";
import { Showcase } from "./scenes/Showcase";
import { Nav } from "./scenes/Nav";
import { Outro } from "./scenes/Outro";

const calculateMetadata = async () => {
  await fontsReady;
  return {};
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Promo"
        component={Promo}
        durationInFrames={984}
        fps={30}
        width={1920}
        height={1080}
        calculateMetadata={calculateMetadata}
      />
      <Folder name="Scenes">
        <Composition id="Intro" component={Intro} durationInFrames={120} fps={30} width={1920} height={1080} calculateMetadata={calculateMetadata} />
        <Composition id="Problem" component={Problem} durationInFrames={120} fps={30} width={1920} height={1080} calculateMetadata={calculateMetadata} />
        <Composition id="Model" component={Model} durationInFrames={150} fps={30} width={1920} height={1080} calculateMetadata={calculateMetadata} />
        <Composition
          id="Chat"
          component={Showcase}
          durationInFrames={150}
          fps={30}
          width={1920}
          height={1080}
          calculateMetadata={calculateMetadata}
          defaultProps={{
            image: "chat.png",
            imageWidth: 1050,
            imageHeight: 687,
            title: "Chat with any model.",
            sub: "Claude, Codex or your own. @ a second opinion, / a skill, pick effort and supervision per turn.",
          }}
        />
        <Composition id="Nav" component={Nav} durationInFrames={135} fps={30} width={1920} height={1080} calculateMetadata={calculateMetadata} />
        <Composition id="Outro" component={Outro} durationInFrames={120} fps={30} width={1920} height={1080} calculateMetadata={calculateMetadata} />
      </Folder>
    </>
  );
};
