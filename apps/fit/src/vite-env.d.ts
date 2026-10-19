/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin (https://api.joyorogo.com in production). */
  readonly VITE_SERVER_URL: string;
  /** "1" shows the credentialless dev sign-in on the Vite dev server (the API needs DEV_LOGIN set). */
  readonly VITE_DEV_LOGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
