import { Router } from "express";
import { buildOpenApiSpec } from "../openapi/spec.js";

export const docsRouter = Router();

docsRouter.get("/docs.json", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}/api`;
  return res.status(200).json(buildOpenApiSpec(baseUrl));
});

docsRouter.get("/docs", (_req, res) => {
  return res.status(200).type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Adfix PM API Docs</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; line-height: 1.4; }
      pre { background: #f5f5f5; padding: 1rem; border-radius: 8px; overflow-x: auto; }
      a { color: #0b5cab; }
    </style>
  </head>
  <body>
    <h1>Adfix PM API Docs</h1>
    <p>OpenAPI spec: <a href="/api/docs.json">/api/docs.json</a></p>
    <p>Use this JSON in Swagger UI, Postman, or any OpenAPI client.</p>
  </body>
</html>`);
});
