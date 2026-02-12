export function buildOpenApiSpec(baseUrl: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "Adfix PM API",
      version: "0.1.0",
      description: "Provider-agnostic backend API for Adfix PM."
    },
    servers: [
      {
        url: baseUrl
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      },
      parameters: {
        requestIdHeader: {
          in: "header",
          name: "x-request-id",
          required: false,
          schema: { type: "string" },
          description: "Optional request correlation ID."
        }
      }
    },
    paths: {
      "/health": {
        get: {
          summary: "Health check with database probe",
          responses: {
            "200": { description: "Healthy" },
            "503": { description: "Degraded (database unavailable)" }
          }
        }
      },
      "/auth/login": {
        post: {
          summary: "Authenticate with email/password",
          responses: { "200": { description: "Login successful" }, "401": { description: "Invalid credentials" } }
        }
      },
      "/auth/refresh": {
        post: {
          summary: "Rotate refresh token and issue new auth tokens",
          responses: { "200": { description: "Refresh successful" }, "401": { description: "Invalid refresh token" } }
        }
      },
      "/auth/me": {
        get: {
          summary: "Get current authenticated user",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Current user" }, "401": { description: "Unauthorized" } }
        }
      },
      "/clients": {
        get: {
          summary: "List clients",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Clients list" } }
        },
        post: {
          summary: "Create client",
          security: [{ bearerAuth: [] }],
          responses: { "201": { description: "Client created" } }
        }
      },
      "/projects": {
        get: {
          summary: "List projects",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Projects list" } }
        },
        post: {
          summary: "Create project",
          security: [{ bearerAuth: [] }],
          responses: { "201": { description: "Project created" } }
        }
      },
      "/tasks": {
        get: {
          summary: "List tasks",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Tasks list" } }
        },
        post: {
          summary: "Create task",
          security: [{ bearerAuth: [] }],
          responses: { "201": { description: "Task created" } }
        }
      },
      "/files/upload-url": {
        post: {
          summary: "Get a provider-agnostic signed upload URL (mock/local implementation)",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Upload URL generated" } }
        }
      },
      "/analytics/dashboard": {
        get: {
          summary: "Dashboard analytics",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Dashboard metrics" } }
        }
      },
      "/search": {
        get: {
          summary: "Global or scoped search",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Search results" } }
        }
      },
      "/users": {
        get: {
          summary: "List users",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Users list" } }
        }
      }
    }
  };
}
