import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { Intro } from "./scenes/Intro";
import { Problem } from "./scenes/Problem";
import { Model } from "./scenes/Model";
import { Showcase } from "./scenes/Showcase";
import { Nav } from "./scenes/Nav";
import { Outro } from "./scenes/Outro";

export const Promo: React.FC = () => {
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={120} name="Intro">
        <Intro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence durationInFrames={120} name="Problem">
        <Problem />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={linearTiming({ durationInFrames: 18 })} />
      <TransitionSeries.Sequence durationInFrames={150} name="Model">
        <Model />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence durationInFrames={150} name="Chat">
        <Showcase
          image="chat.png"
          imageWidth={1050}
          imageHeight={687}
          title="Chat with any model."
          sub="Claude, Codex or your own. @ a second opinion, / a skill, pick effort and supervision per turn."
        />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence durationInFrames={150} name="Fleet">
        <Showcase
          image="fleet.png"
          imageWidth={1050}
          imageHeight={656}
          title="Watch the fleet work."
          sub="An orchestrator routes each turn to agents. The live flow shows who owns it, who is running and what comes back."
        />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence durationInFrames={150} name="Git">
        <Showcase
          image="git.png"
          imageWidth={620}
          imageHeight={884}
          title="Review without leaving."
          sub="Stage, diff, commit, push and open the PR from the git pane. Line feedback goes straight back to the agent."
        />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-bottom" })} timing={linearTiming({ durationInFrames: 18 })} />
      <TransitionSeries.Sequence durationInFrames={135} name="Nav">
        <Nav />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence durationInFrames={120} name="Outro">
        <Outro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
