import http from "node:http";

const port = Number(process.env.PORT || 8099);
const sourceApi = process.env.BOOK_SOURCE_URL;
const remoteBase = process.env.BOOK_SOURCE_REMOTE_BASE?.replace(/\/$/, "");
const searchTemplate = process.env.BOOK_SOURCE_SEARCH_TEMPLATE;
if (!sourceApi || !remoteBase || !searchTemplate) {
  throw new Error(
    "需要 BOOK_SOURCE_URL、BOOK_SOURCE_REMOTE_BASE 和 BOOK_SOURCE_SEARCH_TEMPLATE 环境变量",
  );
}
const localBase = "http://127.0.0.1:" + port;

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === "/source") {
      const upstream = await fetch(sourceApi);
      const payload = await upstream.json();
      const config = Array.isArray(payload) ? payload[0] : payload?.data ?? payload;
      config.bookSourceName += " · 自动化桥接";
      config.bookSourceUrl = localBase;
      config.searchUrl = localBase + searchTemplate;
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(config));
      return;
    }
    const upstream = await fetch(remoteBase + request.url, {
      headers: {
        Accept: request.headers.accept || "text/html",
        Referer: remoteBase + "/",
        "User-Agent": "Mozilla/5.0 (Android 16; Mobile) ModuReaderSourceTest/1.0",
      },
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("BOOK_SOURCE_PROXY_READY http://127.0.0.1:" + port);
});