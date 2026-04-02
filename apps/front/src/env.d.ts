/// <reference types="astro/client" />

interface Env {
  DATABASE_URL?: string;
  GEOCODER_BASE_URL?: string;
  HYPERDRIVE?: Hyperdrive;
  PUBLIC_ENABLE_DRAW_TO_SEARCH?: string;
}

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare global {
  interface ImportMetaEnv {
    readonly PUBLIC_API_BASE_URL?: string;
    readonly API_SERVER_BASE_URL?: string;
    readonly DATABASE_URL?: string;
    readonly GEOCODER_BASE_URL?: string;
    readonly PUBLIC_ENABLE_DRAW_TO_SEARCH?: string;
    readonly SITE_URL?: string;
    readonly AUTH_COOKIE_DOMAIN?: string;
  }
}

declare namespace App {
  interface Locals extends Runtime {}
}
