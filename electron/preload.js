// Preload script — exposes safe APIs to the renderer process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pitwallDesktop', {
  platform: process.platform,
  isElectron: true,
  hud: {
    toggle: () => ipcRenderer.invoke('hud:toggle'),
    setClickThrough: (enabled) => ipcRenderer.invoke('hud:setClickThrough', enabled),
    setOpacity: (opacity) => ipcRenderer.invoke('hud:setOpacity', opacity),
    setSize: (width, height) => ipcRenderer.invoke('hud:setSize', width, height),
  },
});
