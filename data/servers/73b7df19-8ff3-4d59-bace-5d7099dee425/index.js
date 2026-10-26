const http = require("http");
const os = require("os");
const port = Number(process.env.SERVER_PORT || 8080);
const started = Date.now();

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (url === "/" || url === "/health") {
    res.end(JSON.stringify({
      panel: "kestrel",
      egg: "nodejs",
      status: "ok",
      port,
      uptime: Math.round((Date.now() - started) / 1000),
      node: process.version,
      host: os.hostname(),
      pid: process.pid
    }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log("nodejs listening on 0.0.0.0:" + port);
});
