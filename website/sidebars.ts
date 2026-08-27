import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    "why-spectre",
    {
      type: "category",
      label: "Get Started",
      collapsed: false,
      items: ["quickstart", "recovery-modes", "recovering-with-email"],
    },
    {
      type: "category",
      label: "Operate",
      collapsed: false,
      items: ["monitoring", "threat-model"],
    },
    {
      type: "category",
      label: "Reference",
      collapsed: false,
      items: ["roadmap"],
    },
  ],
};

export default sidebars;
