// ruxx stream — desktop shell (Windows / macOS).
//
// Wraps the existing Expo web export (built with `npx expo export --platform
// web`) in a Chromium window. The renderer is the exact same bundle the
// website runs; this process adds what a website cannot have:
//   • app:// protocol serving the bundled export (offline-capable browsing)
//   • premium offline downloads (desktop/downloads.js — sealed at rest)
//   • ad-network requests blocked outright (AdSense is not allowed in
//     desktop apps — the app is premium-only and ad-free by design)
//   • external links (payments, legal pages) opening in the default browser
//   • auto-updates from https://app.ruxxdigital.name.ng/downloads

const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog, ipcMain, session, shell } = require("electron");
const { autoUpdater } = require("electron-updater");

const appProtocol = require("./protocol");
const downloads = require("./downloads");

// Must run before app.ready.
appProtocol.registerSchemes();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;
  let pendingDeepLink = null;

  const bundleDir = () =>
    app.isPackaged
      ? path.join(process.resourcesPath, "dist")
      : path.join(__dirname, "..", "dist");

  function externalTargetsOpen(url) {
    return /^https?:\/\//i.test(url) || /^mailto:/i.test(url);
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 940,
      minHeight: 600,
      backgroundColor: "#050505",
      title: "ruxx stream",
      icon: path.join(__dirname, "assets", "icon.png"),
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false, // preload needs process.env for the app version
        spellcheck: false,
      },
    });

    mainWindow.once("ready-to-show", () => mainWindow?.show());

    // Payment (Paystack) and legal pages belong in the user's real browser.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (externalTargetsOpen(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (url.startsWith("app://")) return; // in-app route change
      event.preventDefault();
      if (externalTargetsOpen(url)) void shell.openExternal(url);
    });

    const deepLink = pendingDeepLink;
    pendingDeepLink = null;
    mainWindow.loadURL(deepLink ?? "app://app/");
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  }

  // Ad networks never load inside the app: AdSense's program policies allow
  // its code on websites only — inside a shipped application it would put
  // the publisher account (which monetizes the website) at risk.
  function blockAdNetworks() {
    session.defaultSession.webRequest.onBeforeRequest(
      {
        urls: [
          "*://*.googlesyndication.com/*",
          "*://*.googleadservices.com/*",
          "*://*.doubleclick.net/*",
          "*://adservice.google.com/*",
          "*://*.googletagmanager.com/*",
        ],
      },
      (_details, callback) => callback({ cancel: true })
    );
  }

  // ruxxstream://movie/12 → app://app/movie/12 (payments email links, etc).
  function deepLinkToAppUrl(url) {
    try {
      const parsed = new URL(url);
      const target = `${parsed.hostname}${parsed.pathname}`;
      return `app://app/${target.replace(/^\/+/, "")}`;
    } catch {
      return null;
    }
  }

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    const target = url.startsWith("ruxxstream://") ? deepLinkToAppUrl(url) : null;
    if (!target) return;
    if (mainWindow) {
      void mainWindow.loadURL(target);
    } else {
      pendingDeepLink = target;
    }
  });

  app.whenReady().then(() => {
    process.env.RUXX_APP_VERSION = app.getVersion();

    if (!fs.existsSync(path.join(bundleDir(), "index.html"))) {
      dialog.showErrorBox(
        "ruxx stream — web bundle missing",
        "The bundled web app was not found.\n\nBuild it first:\n  npm run web:export   (in the project root)\nthen restart the desktop app."
      );
      app.quit();
      return;
    }

    appProtocol.start({ bundleDir: bundleDir() });
    blockAdNetworks();
    downloads.registerIpc(ipcMain, () => mainWindow);
    createWindow();

    // macOS: keep the dock behavior (reopen recreates the window).
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    if (!app.isPackaged) return;
    // Auto-update from the generic feed (…/downloads/latest.yml on the site).
    autoUpdater.autoDownload = true;
    autoUpdater.checkForUpdatesAndNotify().catch((e) =>
      console.warn("[updater] check failed", e)
    );
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
