// Preload — the only bridge between the renderer (the bundled Expo web
// app) and the Electron main process. Runs with contextIsolation on, so
// the page sees exactly this API and nothing else (no Node, no ipcRenderer).
//
// The app detects the desktop shell through `window.ruxxDesktop.platform`
// (src/lib/platform.ts) and takes the premium-only, ad-free, download-capable
// code paths from there.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ruxxDesktop", {
  platform: "desktop",
  version: process.env.RUXX_APP_VERSION || "0.0.0",
  os: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "other",

  downloads: {
    start: (movieId, url) => ipcRenderer.invoke("downloads:start", { movieId, url }),
    cancel: (movieId) => ipcRenderer.send("downloads:cancel", { movieId }),
    remove: (movieId) => ipcRenderer.invoke("downloads:remove", { movieId }),
    listExists: (movieIds) => ipcRenderer.invoke("downloads:exists", { movieIds }),
    preparePlayback: (movieId, ext, cipher) =>
      ipcRenderer.invoke("downloads:prepare", {
        movieId,
        ext,
        cipherKey: cipher?.key,
        cipherNonce: cipher?.nonce,
        plainBytes: cipher?.plainBytes,
      }),
    releasePlayback: (movieId) => ipcRenderer.invoke("downloads:release", { movieId }),
    onProgress: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("downloads:progress", handler);
      return () => ipcRenderer.removeListener("downloads:progress", handler);
    },
  },
});
