// @ts-check
import "dotenv/config";
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import react from "@astrojs/react";

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: process.env.SITE_URL || "http://localhost:4321",
  integrations: [mdx(), sitemap(), react()],
  vite: {
    // Astro and @tailwindcss/vite currently resolve different Vite type packages here.
    plugins: [/** @type {any} */ (tailwindcss())],
    optimizeDeps: {
      include: ["maplibre-gl", "@protomaps/basemaps", "pmtiles"],
    },
  },
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
    },
  }),
});
