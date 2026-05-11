// Entry point bundled by scripts/build-demo.mjs into docs/demo/bundle.js
// Exposes BrowserProver on window so the demo HTML can call it without
// dealing with import maps.
import { BrowserProver } from "../src/provers/browser.js";

declare global {
  interface Window {
    SpectreDemo: {
      BrowserProver: typeof BrowserProver;
    };
  }
}

window.SpectreDemo = { BrowserProver };
