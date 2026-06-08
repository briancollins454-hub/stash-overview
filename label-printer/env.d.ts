/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LABEL_PRINTER_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
