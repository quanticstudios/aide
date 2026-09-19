import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export const fontsReady = Promise.all([
  loadFont({ family: "Geist", url: staticFile("geist.woff2"), weight: "100 900" }),
  loadFont({ family: "Geist Mono", url: staticFile("geist-mono.woff2"), weight: "100 900" }),
]);
