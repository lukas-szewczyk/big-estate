// @ts-check
import "dotenv/config";
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: process.env.SITE_URL || "http://localhost:4321",
  integrations: [mdx(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
    },
  }),
});
