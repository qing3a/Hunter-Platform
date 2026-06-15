/// <reference types="vite/client" />

interface ConvoApi {
  ping(): Promise<string>;
}

declare global {
  interface Window {
    api: ConvoApi;
  }
}

export {};
