import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://docs.openmgr.ai",
  integrations: [
    starlight({
      title: "OpenMgr",
      description:
        "Open-source platform for managing AI coding agents. Self-hosted server, desktop app, mobile app, and modular agent framework.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/openmgr/openmgr",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/openmgr/openmgr/edit/main/docs/",
      },
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", link: "/" },
            {
              label: "Quickstart",
              link: "/getting-started/quickstart/",
            },
            {
              label: "Installation",
              link: "/getting-started/installation/",
            },
            {
              label: "Configuration",
              link: "/getting-started/configuration/",
            },
          ],
        },
        {
          label: "Guides",
          autogenerate: { directory: "guides" },
        },
        {
          label: "Platforms",
          autogenerate: { directory: "platforms" },
        },
        {
          label: "Concepts",
          autogenerate: { directory: "concepts" },
        },
        {
          label: "API Reference",
          autogenerate: { directory: "api" },
        },
        {
          label: "Contributing",
          autogenerate: { directory: "contributing" },
        },
      ],
    }),
  ],
});
