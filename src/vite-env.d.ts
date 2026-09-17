/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ROBOFLOW_API_KEY?: string
  readonly VITE_ROBOFLOW_MODEL_ID?: string
  /** Where saved boxes are posted. Defaults to /api/boxes on this origin. */
  readonly VITE_SYNC_URL?: string
  /** Matches the server's SYNC_TOKEN. Compiled into the bundle — not a secret. */
  readonly VITE_SYNC_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
