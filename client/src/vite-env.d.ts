/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_SOCKET_URL: string;
  readonly VITE_APP_NAME: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Build-time-injected SHA of the current deploy (see vite.config.ts).
 * Compared against /api/version at runtime to drive the auto-update toast.
 * Equals 'dev' on local builds; the runtime check ignores that case.
 */
declare const __APP_VERSION__: string;
