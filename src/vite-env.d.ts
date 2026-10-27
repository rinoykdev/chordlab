/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** "1" in the single-file preview build (no service worker, everything inlined). */
  readonly VITE_SINGLE?: string;
}
