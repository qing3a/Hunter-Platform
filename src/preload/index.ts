import { contextBridge, ipcRenderer } from 'electron';

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
} as const;

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
