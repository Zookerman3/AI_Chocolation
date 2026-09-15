/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ROBOFLOW_API_KEY?: string
  readonly VITE_ROBOFLOW_MODEL_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
