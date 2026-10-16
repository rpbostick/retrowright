// A static file server for the browser checks: serves a built folder under a
// sub-path, as GitHub Pages serves the site under /<repo>/. It can be stopped
// (every request then fails, as with the network off), started again on the
// same port, and pointed at another build.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

/** `pages` maps a path under `subPath` to HTML served in place of any file. */
export async function startStaticServer({ root, subPath, ports, pages = {} }) {
  let dir = resolve(root);
  let server = null;
  let port = null;

  const handler = async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(subPath)) return void response.writeHead(404).end();
    const relative = decodeURIComponent(url.pathname.slice(subPath.length)) || "index.html";
    if (Object.hasOwn(pages, relative)) return void response.writeHead(200, { "content-type": "text/html" }).end(pages[relative]);
    const path = normalize(join(dir, relative));
    if (!path.startsWith(dir + sep)) return void response.writeHead(403).end();
    try {
      // no-cache: the browser asks again each time, so a new build is seen at once.
      response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", "cache-control": "no-cache" }).end(await readFile(path));
    } catch {
      response.writeHead(404).end();
    }
  };

  const listen = (candidates) =>
    new Promise((done, reject) => {
      const tryPort = (index) => {
        if (index >= candidates.length) return reject(new Error(`No free port in ${candidates.join(", ")}.`));
        const next = createServer(handler);
        next.once("error", (error) => (error.code === "EADDRINUSE" ? tryPort(index + 1) : reject(error)));
        next.listen(candidates[index], "127.0.0.1", () => {
          server = next;
          // Port 0 asks the system for any free port.
          port = next.address().port;
          done();
        });
      };
      tryPort(0);
    });

  await listen(ports);
  return {
    get port() {
      return port;
    },
    /** Serves `root` from now on. */
    setRoot(root) {
      dir = resolve(root);
    },
    async stop() {
      if (!server) return;
      const closing = server;
      server = null;
      closing.closeAllConnections();
      await new Promise((done) => closing.close(() => done()));
    },
    /** Starts again on the same port, serving `root`. */
    async start(root) {
      if (server) return;
      dir = resolve(root);
      await listen([port]);
    },
  };
}
