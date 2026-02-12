type Method = "get" | "post" | "put" | "patch" | "delete";

function withAuth(pathItem: Partial<Record<Method, Record<string, unknown>>>) {
  const output: Partial<Record<Method, Record<string, unknown>>> = {};
  for (const method of Object.keys(pathItem) as Method[]) {
    output[method] = {
      security: [{ bearerAuth: [] }],
      ...pathItem[method]
    };
  }
  return output;
}

export function buildOpenApiSpec(baseUrl: string) {
  const errorResponses = {
    "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
    "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
    "403": { description: "Forbidden", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
    "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
    "409": { description: "Conflict", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "Adfix PM API",
      version: "0.1.0",
      description: "Provider-agnostic backend API for Adfix PM."
    },
    servers: [{ url: baseUrl }],
    tags: [
      { name: "health" },
      { name: "docs" },
      { name: "auth" },
      { name: "clients" },
      { name: "projects" },
      { name: "tasks" },
      { name: "files" },
      { name: "analytics" },
      { name: "search" },
      { name: "users" },
      { name: "admin" },
      { name: "notifications" }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["code", "error", "requestId"],
          properties: {
            code: { type: "string", description: "Stable machine-readable error code." },
            error: { type: "string" },
            requestId: { type: ["string", "null"] },
            details: { nullable: true }
          }
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
          tags: ["health"],
          summary: "Liveness check",
          responses: {
            "200": { description: "Service process is running" }
          }
        }
      },
      "/ready": {
        get: {
          tags: ["health"],
          summary: "Readiness check (database connectivity)",
          responses: {
            "200": { description: "Ready to serve traffic" },
            "503": { description: "Not ready (database unavailable)" }
          }
        }
      },
      "/docs": {
        get: {
          tags: ["docs"],
          summary: "Docs landing page",
          responses: { "200": { description: "Docs HTML page" } }
        }
      },
      "/docs.json": {
        get: {
          tags: ["docs"],
          summary: "OpenAPI specification",
          responses: { "200": { description: "OpenAPI JSON document" } }
        }
      },

      "/auth/login": {
        post: {
          tags: ["auth"],
          summary: "Authenticate with email/password",
          responses: {
            "200": { description: "Login successful" },
            "401": { description: "Invalid credentials", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "400": { description: "Invalid payload", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
          }
        }
      },
      "/auth/refresh": {
        post: {
          tags: ["auth"],
          summary: "Rotate refresh token and issue new auth tokens",
          responses: {
            "200": { description: "Refresh successful" },
            "401": { description: "Invalid refresh token", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "400": { description: "Invalid payload", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
          }
        }
      },
      "/auth/logout": {
        post: {
          tags: ["auth"],
          summary: "Revoke current refresh session",
          responses: { "204": { description: "Logged out" }, ...errorResponses }
        }
      },
      "/auth/logout-all": {
        post: {
          tags: ["auth"],
          summary: "Revoke all refresh sessions for user",
          responses: { "204": { description: "All sessions revoked" }, ...errorResponses }
        }
      },
      "/auth/me": withAuth({
        get: {
          tags: ["auth"],
          summary: "Get current authenticated user",
          responses: { "200": { description: "Current user" }, ...errorResponses }
        }
      }),

      "/clients": withAuth({
        get: {
          tags: ["clients"],
          summary: "List clients",
          responses: { "200": { description: "Clients list" }, ...errorResponses }
        },
        post: {
          tags: ["clients"],
          summary: "Create client",
          responses: { "201": { description: "Client created" }, ...errorResponses }
        }
      }),
      "/clients/{id}": withAuth({
        get: {
          tags: ["clients"],
          summary: "Get client by ID",
          responses: { "200": { description: "Client detail" }, ...errorResponses }
        },
        put: {
          tags: ["clients"],
          summary: "Update client",
          responses: { "200": { description: "Client updated" }, ...errorResponses }
        },
        delete: {
          tags: ["clients"],
          summary: "Delete client",
          responses: { "204": { description: "Client deleted" }, ...errorResponses }
        }
      }),

      "/projects": withAuth({
        get: {
          tags: ["projects"],
          summary: "List projects (RBAC scoped)",
          responses: { "200": { description: "Projects list" }, ...errorResponses }
        },
        post: {
          tags: ["projects"],
          summary: "Create project",
          responses: { "201": { description: "Project created" }, ...errorResponses }
        }
      }),
      "/projects/{id}": withAuth({
        get: {
          tags: ["projects"],
          summary: "Get project detail",
          responses: { "200": { description: "Project detail" }, ...errorResponses }
        },
        put: {
          tags: ["projects"],
          summary: "Update project",
          responses: { "200": { description: "Project updated" }, ...errorResponses }
        },
        delete: {
          tags: ["projects"],
          summary: "Delete project",
          responses: { "204": { description: "Project deleted" }, ...errorResponses }
        }
      }),
      "/projects/{id}/phase": withAuth({
        patch: {
          tags: ["projects"],
          summary: "Transition project phase",
          responses: { "200": { description: "Phase changed" }, ...errorResponses }
        }
      }),
      "/projects/{id}/activity": withAuth({
        get: {
          tags: ["projects"],
          summary: "List project activity",
          responses: { "200": { description: "Project activity feed" }, ...errorResponses }
        }
      }),
      "/projects/{id}/team": withAuth({
        get: {
          tags: ["projects"],
          summary: "List project team members",
          responses: { "200": { description: "Project team members" }, ...errorResponses }
        },
        post: {
          tags: ["projects"],
          summary: "Add or update project team member role",
          responses: { "201": { description: "Project team member added/updated" }, ...errorResponses }
        }
      }),
      "/projects/{id}/team/{userId}": withAuth({
        delete: {
          tags: ["projects"],
          summary: "Remove project team member",
          responses: { "204": { description: "Project team member removed" }, ...errorResponses }
        }
      }),

      "/tasks": withAuth({
        get: {
          tags: ["tasks"],
          summary: "List tasks (RBAC scoped)",
          responses: { "200": { description: "Tasks list" }, ...errorResponses }
        },
        post: {
          tags: ["tasks"],
          summary: "Create task",
          responses: { "201": { description: "Task created" }, ...errorResponses }
        }
      }),
      "/tasks/{id}": withAuth({
        get: {
          tags: ["tasks"],
          summary: "Get task",
          responses: { "200": { description: "Task detail" }, ...errorResponses }
        },
        put: {
          tags: ["tasks"],
          summary: "Update task",
          responses: { "200": { description: "Task updated" }, ...errorResponses }
        },
        delete: {
          tags: ["tasks"],
          summary: "Delete task",
          responses: { "204": { description: "Task deleted" }, ...errorResponses }
        }
      }),
      "/tasks/{id}/status": withAuth({
        patch: {
          tags: ["tasks"],
          summary: "Transition task status",
          responses: { "200": { description: "Task status updated" }, ...errorResponses }
        }
      }),
      "/tasks/{id}/comments": withAuth({
        get: {
          tags: ["tasks"],
          summary: "List task comments",
          responses: { "200": { description: "Task comments list" }, ...errorResponses }
        },
        post: {
          tags: ["tasks"],
          summary: "Create task comment",
          responses: { "201": { description: "Task comment created" }, ...errorResponses }
        }
      }),
      "/tasks/{id}/comments/{commentId}": withAuth({
        delete: {
          tags: ["tasks"],
          summary: "Delete task comment",
          responses: { "204": { description: "Task comment deleted" }, ...errorResponses }
        }
      }),
      "/tasks/bulk/status": withAuth({
        post: {
          tags: ["tasks"],
          summary: "Bulk transition task statuses",
          responses: { "200": { description: "Bulk status result" }, ...errorResponses }
        }
      }),
      "/tasks/bulk/delete": withAuth({
        post: {
          tags: ["tasks"],
          summary: "Bulk delete tasks",
          responses: { "200": { description: "Bulk delete result" }, ...errorResponses }
        }
      }),

      "/files/project/{projectId}": withAuth({
        get: {
          tags: ["files"],
          summary: "List files by project",
          responses: { "200": { description: "Project files" }, ...errorResponses }
        }
      }),
      "/files/link": withAuth({
        post: {
          tags: ["files"],
          summary: "Register linked external file",
          responses: { "201": { description: "Linked file created" }, ...errorResponses }
        }
      }),
      "/files/upload": withAuth({
        post: {
          tags: ["files"],
          summary: "Register uploaded file metadata",
          responses: { "201": { description: "Uploaded file created" }, ...errorResponses }
        }
      }),
      "/files/upload-url": withAuth({
        post: {
          tags: ["files"],
          summary: "Get mock signed upload URL",
          responses: { "200": { description: "Upload URL generated" }, ...errorResponses }
        }
      }),
      "/files/complete-upload": withAuth({
        post: {
          tags: ["files"],
          summary: "Finalize upload record",
          responses: { "201": { description: "Upload completed" }, ...errorResponses }
        }
      }),
      "/files/{id}/download-url": withAuth({
        get: {
          tags: ["files"],
          summary: "Get download URL for file",
          responses: { "200": { description: "Download URL generated" }, ...errorResponses }
        }
      }),
      "/files/{id}": withAuth({
        delete: {
          tags: ["files"],
          summary: "Delete file",
          responses: { "204": { description: "File deleted" }, ...errorResponses }
        }
      }),

      "/analytics/dashboard": withAuth({
        get: {
          tags: ["analytics"],
          summary: "Dashboard analytics (RBAC scoped)",
          responses: { "200": { description: "Dashboard metrics" }, ...errorResponses }
        }
      }),
      "/analytics/projects": withAuth({
        get: {
          tags: ["analytics"],
          summary: "Project analytics report (RBAC scoped)",
          responses: { "200": { description: "Projects analytics" }, ...errorResponses }
        }
      }),
      "/analytics/team": withAuth({
        get: {
          tags: ["analytics"],
          summary: "Team analytics report (RBAC scoped)",
          responses: { "200": { description: "Team analytics" }, ...errorResponses }
        }
      }),
      "/analytics/timeline": withAuth({
        get: {
          tags: ["analytics"],
          summary: "Timeline analytics report (RBAC scoped)",
          responses: { "200": { description: "Timeline analytics" }, ...errorResponses }
        }
      }),
      "/analytics/projects.csv": withAuth({
        get: {
          tags: ["analytics"],
          summary: "Projects analytics CSV",
          responses: { "200": { description: "CSV download" }, ...errorResponses }
        }
      }),
      "/analytics/team.csv": withAuth({
        get: {
          tags: ["analytics"],
          summary: "Team analytics CSV",
          responses: { "200": { description: "CSV download" }, ...errorResponses }
        }
      }),

      "/search": withAuth({
        get: {
          tags: ["search"],
          summary: "Global/scoped search (RBAC scoped)",
          responses: { "200": { description: "Search results" }, ...errorResponses }
        }
      }),
      "/notifications": withAuth({
        get: {
          tags: ["notifications"],
          summary: "List current user notifications",
          responses: { "200": { description: "Notifications list" }, ...errorResponses }
        }
      }),
      "/notifications/read-all": withAuth({
        post: {
          tags: ["notifications"],
          summary: "Mark all current user notifications as read",
          responses: { "200": { description: "Bulk read update result" }, ...errorResponses }
        }
      }),
      "/notifications/{id}/read": withAuth({
        patch: {
          tags: ["notifications"],
          summary: "Mark notification as read",
          responses: { "200": { description: "Notification marked as read" }, ...errorResponses }
        }
      }),

      "/users": withAuth({
        get: {
          tags: ["users"],
          summary: "List users",
          responses: { "200": { description: "Users list" }, ...errorResponses }
        }
      }),
      "/users/{id}": withAuth({
        get: {
          tags: ["users"],
          summary: "Get user by ID",
          responses: { "200": { description: "User detail" }, ...errorResponses }
        },
        put: {
          tags: ["users"],
          summary: "Update own profile",
          responses: { "200": { description: "User updated" }, ...errorResponses }
        }
      }),
      "/users/audit-logs": withAuth({
        get: {
          tags: ["admin"],
          summary: "Admin: list audit logs",
          responses: { "200": { description: "Audit logs list" }, ...errorResponses }
        }
      }),
      "/users/{id}/status": withAuth({
        patch: {
          tags: ["admin"],
          summary: "Admin: activate/deactivate user",
          responses: { "200": { description: "User status updated" }, ...errorResponses }
        }
      }),
      "/users/{id}/project-roles/reset": withAuth({
        post: {
          tags: ["admin"],
          summary: "Admin: reset user project role assignments",
          responses: { "200": { description: "Roles reset result" }, ...errorResponses }
        }
      })
    }
  };
}
