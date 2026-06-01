import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const GITHUB_URL = "https://github.com/CECILIA-MULANDI/spectre-protocol-base-evm";
const EDIT_BASE = `${GITHUB_URL}/tree/main/website/`;

const config: Config = {
  title: "Spectre Protocol",
  tagline: "Zero-knowledge account recovery for autonomous on-chain agents",
  favicon: "img/favicon.ico",

  future: {
    v4: true,
  },

  url: "https://docs.spectreprotocol.xyz",
  baseUrl: "/",

  organizationName: "CECILIA-MULANDI",
  projectName: "spectre-protocol-base-evm",

  onBrokenLinks: "throw",

  headTags: [
    {
      tagName: "link",
      attributes: { rel: "preconnect", href: "https://fonts.googleapis.com" },
    },
    {
      tagName: "link",
      attributes: {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossorigin: "anonymous",
      },
    },
    {
      tagName: "link",
      attributes: {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Syne:wght@500;600;700&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    },
  ],

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "/",
          editUrl: EDIT_BASE,
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/social-card.png",
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "Spectre",
      logo: {
        alt: "Spectre Protocol logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          href: GITHUB_URL,
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Introduction", to: "/intro" },
            { label: "Quickstart", to: "/quickstart" },
            { label: "Recovery modes", to: "/recovery-modes" },
            { label: "Threat model", to: "/threat-model" },
          ],
        },
        {
          title: "Project",
          items: [
            { label: "GitHub", href: GITHUB_URL },
            { label: "spectreprotocol.xyz", href: "https://spectreprotocol.xyz" },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Spectre Protocol.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["solidity", "bash"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
