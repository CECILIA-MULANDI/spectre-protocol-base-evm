// Entry point bundled by scripts/build-demo.mjs into docs/demo/bundle.js
// Exposes SDK surfaces on window so the static demo HTML files can call them
// without dealing with import maps.
import { BrowserProver } from "../src/provers/browser.js";
import {
  computeSignal,
  encodeBindCustomData,
  encodeProofData,
  toPersonhoodNullifier,
  bindFieldsForRecovery,
  renderZKPassportSnippet,
} from "../src/personhood.js";

const Personhood = {
  computeSignal,
  encodeBindCustomData,
  encodeProofData,
  toPersonhoodNullifier,
  bindFieldsForRecovery,
  renderZKPassportSnippet,
};

declare global {
  interface Window {
    SpectreDemo: {
      BrowserProver: typeof BrowserProver;
      Personhood: typeof Personhood;
    };
  }
}

window.SpectreDemo = { BrowserProver, Personhood };
