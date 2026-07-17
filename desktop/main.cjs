const { app, BrowserWindow, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const WEB_ROOT = path.join(__dirname, "dist-web");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function createStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestPath = decodeURIComponent((request.url || "/").split("?")[0]);
      const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
      let filePath = path.resolve(WEB_ROOT, relativePath);

      if (!filePath.startsWith(`${WEB_ROOT}${path.sep}`) && filePath !== WEB_ROOT) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(WEB_ROOT, "index.html");
      }

      response.setHeader("Cache-Control", "no-cache");
      response.setHeader("Content-Type", CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream");
      fs.createReadStream(filePath)
        .on("error", () => {
          if (!response.headersSent) response.writeHead(500);
          response.end("Unable to load application resource");
        })
        .pipe(response);
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate local application port"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function createWindow() {
  const { server, url } = await createStaticServer();
  const window = new BrowserWindow({
    backgroundColor: "#F7F4ED",
    height: 900,
    minHeight: 720,
    minWidth: 420,
    show: false,
    title: "墨读",
    width: 520,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.removeMenu();
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    }
  });
  window.once("closed", () => server.close());
  await window.loadURL(url);
}

app.whenReady().then(async () => {
  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
