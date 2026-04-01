/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Credentials are now server-side only — no VITE_ prefixed secrets
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
