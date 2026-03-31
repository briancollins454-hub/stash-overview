/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SHOPIFY_DOMAIN: string;
  readonly VITE_SHOPIFY_ACCESS_TOKEN: string;
  readonly VITE_DECO_DOMAIN: string;
  readonly VITE_DECO_USERNAME: string;
  readonly VITE_DECO_PASSWORD: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
