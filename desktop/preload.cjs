const { contextBridge, ipcRenderer } = require('electron');
// No filesystem, arbitrary IPC, shell command, or secret access is exposed.
contextBridge.exposeInMainWorld(
  'paperleafDesktop',
  Object.freeze({
    action: (name) => ipcRenderer.invoke('paperleaf:desktop-action', name),
  }),
);
