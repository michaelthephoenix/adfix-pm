type Method = "get" | "post" | "put" | "patch" | "delete";

type OpenApiSchema = Record<string, unknown>;
type OpenApiResponse = { description: string; content?: Record<string, { schema: OpenApiSchema }> };

const preciseSuccessSchemaByOperation: Record<string, string> = {
  "GET /health": "HealthResponse",
  "GET /ready": "ReadinessResponse",
  "GET /docs.json": "OpenApiDocument",
  "POST /auth/login": "AuthResponse",
  "POST /auth/refresh": "AuthResponse",
  "GET /auth/me": "CurrentUserResponse",
  "GET /analytics/dashboard": "DashboardResponse",
  "GET /notifications": "NotificationsResponse",
  "POST /notifications/read-all": "UpdatedCountResponse",
  "PATCH /notifications/{id}/read": "NotificationResponse",
  "PATCH /notifications/{id}/archive": "NullableNotificationResponse",
  "PATCH /notifications/{id}/restore": "NotificationResponse",
  "GET /client-portal/reviews": "ClientReviewInboxResponse"
};

const nonJsonSuccessContent: Record<string, { contentType: string; schema: OpenApiSchema }> = {
  "GET /docs": { contentType: "text/html", schema: { type: "string" } },
  "GET /analytics/projects.csv": { contentType: "text/csv", schema: { type: "string" } },
  "GET /analytics/team.csv": { contentType: "text/csv", schema: { type: "string" } },
  "GET /files/{id}/content": { contentType: "*/*", schema: { type: "string", format: "binary" } },
  "GET /files/{id}/preview": { contentType: "*/*", schema: { type: "string", format: "binary" } }
};

function operationSchemaName(method: string, routePath: string, status: string) {
  const name = `${method}_${routePath}_${status}`
    .replace(/[{}]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("");
  return `${name}Response`;
}

function applySuccessContracts(spec: {
  components: { schemas: Record<string, OpenApiSchema> };
  paths: Record<string, Record<string, unknown>>;
}) {
  for (const [routePath, pathItem] of Object.entries(spec.paths)) {
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const operation = rawOperation as { responses?: Record<string, OpenApiResponse> };
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!/^2\d\d$/.test(status)) continue;
        if (status === "204") {
          delete response.content;
          continue;
        }
        const operationKey = `${method.toUpperCase()} ${routePath}`;
        const nonJson = nonJsonSuccessContent[operationKey];
        if (nonJson) {
          response.content = { [nonJson.contentType]: { schema: nonJson.schema } };
          continue;
        }
        const schemaName = preciseSuccessSchemaByOperation[operationKey]
          ?? operationSchemaName(method, routePath, status);
        if (!spec.components.schemas[schemaName]) {
          spec.components.schemas[schemaName] = { $ref: "#/components/schemas/JsonObjectResponse" };
        }
        response.content = {
          "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } }
        };
      }
    }
  }
}

const responseContractSchemas: Record<string, OpenApiSchema> = {
  JsonObject: { type: "object", additionalProperties: true },
  JsonObjectResponse: { type: "object", additionalProperties: true },
  User: {
    type: "object",
    required: ["id", "email", "name", "isAdmin", "accountType"],
    properties: {
      id: { type: "string", format: "uuid" },
      email: { type: "string", format: "email" },
      name: { type: "string" },
      isAdmin: { type: "boolean" },
      accountType: { type: "string", enum: ["staff", "client"] },
      avatarUrl: { type: "string", nullable: true }
    }
  },
  AuthResponse: {
    type: "object",
    required: ["accessToken", "user"],
    properties: {
      accessToken: { type: "string" },
      user: { $ref: "#/components/schemas/User" }
    }
  },
  CurrentUserResponse: {
    type: "object",
    required: ["user"],
    properties: { user: { $ref: "#/components/schemas/User" } }
  },
  HealthResponse: {
    type: "object",
    required: ["status", "service", "timestamp"],
    properties: {
      status: { type: "string", enum: ["ok"] },
      service: { type: "string" },
      timestamp: { type: "string", format: "date-time" }
    }
  },
  ReadinessResponse: {
    type: "object",
    required: ["status", "service", "checks", "timestamp"],
    properties: {
      status: { type: "string", enum: ["ok", "degraded"] },
      service: { type: "string" },
      checks: {
        type: "object",
        required: ["database", "storage"],
        properties: {
          database: { type: "string", enum: ["ok", "error"] },
          storage: { type: "string", enum: ["ok", "error"] }
        }
      },
      timestamp: { type: "string", format: "date-time" }
    }
  },
  OpenApiDocument: { type: "object", additionalProperties: true },
  DashboardAssignee: {
    type: "object",
    required: ["id", "name", "avatarUrl"],
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      avatarUrl: { type: "string", nullable: true }
    }
  },
  DashboardTask: {
    type: "object",
    required: ["id", "title", "priority", "dueDate", "projectId", "projectName", "clientName", "assignees"],
    properties: {
      id: { type: "string", format: "uuid" },
      title: { type: "string" },
      priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
      dueDate: { type: "string", format: "date", nullable: true },
      projectId: { type: "string", format: "uuid" },
      projectName: { type: "string" },
      clientName: { type: "string" },
      assignees: { type: "array", items: { $ref: "#/components/schemas/DashboardAssignee" } }
    }
  },
  DashboardInternalReview: {
    type: "object",
    required: ["versionId", "deliverableId", "deliverableTitle", "projectId", "projectName", "clientName", "versionNumber", "submittedAt", "submittedByName"],
    properties: {
      versionId: { type: "string", format: "uuid" }, deliverableId: { type: "string", format: "uuid" },
      deliverableTitle: { type: "string" }, projectId: { type: "string", format: "uuid" }, projectName: { type: "string" }, clientName: { type: "string" },
      versionNumber: { type: "integer" }, submittedAt: { type: "string", format: "date-time" }, submittedByName: { type: "string" }
    }
  },
  DashboardClientFeedback: {
    type: "object",
    required: ["notificationId", "type", "title", "message", "createdAt", "versionId", "deliverableId", "deliverableTitle", "projectId", "projectName", "clientName"],
    properties: {
      notificationId: { type: "string", format: "uuid" }, type: { type: "string" }, title: { type: "string" }, message: { type: "string" },
      createdAt: { type: "string", format: "date-time" }, versionId: { type: "string", format: "uuid" }, deliverableId: { type: "string", format: "uuid" },
      deliverableTitle: { type: "string" }, projectId: { type: "string", format: "uuid" }, projectName: { type: "string" }, clientName: { type: "string" }
    }
  },
  DashboardUnresolvedReview: {
    type: "object",
    required: ["versionId", "deliverableId", "deliverableTitle", "projectId", "projectName", "clientName", "versionNumber", "clientSubmittedAt"],
    properties: {
      versionId: { type: "string", format: "uuid" }, deliverableId: { type: "string", format: "uuid" }, deliverableTitle: { type: "string" },
      projectId: { type: "string", format: "uuid" }, projectName: { type: "string" }, clientName: { type: "string" }, versionNumber: { type: "integer" },
      clientSubmittedAt: { type: "string", format: "date-time" }
    }
  },
  DashboardWorkload: {
    type: "object",
    required: ["userId", "userName", "avatarUrl", "activeTasks", "dueToday", "overdueTasks", "blockedTasks"],
    properties: {
      userId: { type: "string", format: "uuid" }, userName: { type: "string" }, avatarUrl: { type: "string", nullable: true },
      activeTasks: { type: "integer" }, dueToday: { type: "integer" }, overdueTasks: { type: "integer" }, blockedTasks: { type: "integer" }
    }
  },
  DashboardResponse: {
    type: "object",
    required: ["data"],
    properties: {
      data: {
        type: "object",
        required: ["projectsByPhase", "overdueTasksCount", "projectsCompletedThisMonth", "projectsCompletedThisQuarter", "attentionCounts", "internalReviewsAwaitingDecision", "clientFeedbackAwaitingResponse", "dueTodayAssignments", "blockedTasks", "unresolvedClientReviews", "workload"],
        properties: {
          projectsByPhase: { type: "array", items: { type: "object", required: ["phase", "count"], properties: { phase: { type: "string" }, count: { type: "integer" } } } },
          overdueTasksCount: { type: "integer" }, projectsCompletedThisMonth: { type: "integer" }, projectsCompletedThisQuarter: { type: "integer" },
          attentionCounts: { type: "object", required: ["internalReviews", "clientFeedback", "dueToday", "blockedTasks", "unresolvedClientReviews"], properties: {
            internalReviews: { type: "integer" }, clientFeedback: { type: "integer" }, dueToday: { type: "integer" }, blockedTasks: { type: "integer" }, unresolvedClientReviews: { type: "integer" }
          } },
          internalReviewsAwaitingDecision: { type: "array", items: { $ref: "#/components/schemas/DashboardInternalReview" } },
          clientFeedbackAwaitingResponse: { type: "array", items: { $ref: "#/components/schemas/DashboardClientFeedback" } },
          dueTodayAssignments: { type: "array", items: { $ref: "#/components/schemas/DashboardTask" } },
          blockedTasks: { type: "array", items: { $ref: "#/components/schemas/DashboardTask" } },
          unresolvedClientReviews: { type: "array", items: { $ref: "#/components/schemas/DashboardUnresolvedReview" } },
          workload: { type: "array", items: { $ref: "#/components/schemas/DashboardWorkload" } }
        }
      }
    }
  },
  NotificationRecord: {
    type: "object",
    required: ["id", "user_id", "project_id", "task_id", "type", "title", "message", "metadata", "is_read", "read_at", "action_required", "action_status", "resolved_at", "resolution_reason", "archived_at", "created_at"],
    properties: {
      id: { type: "string", format: "uuid" }, user_id: { type: "string", format: "uuid" }, project_id: { type: "string", format: "uuid", nullable: true }, task_id: { type: "string", format: "uuid", nullable: true },
      type: { type: "string" }, title: { type: "string" }, message: { type: "string" }, metadata: { type: "object", additionalProperties: true }, is_read: { type: "boolean" },
      read_at: { type: "string", format: "date-time", nullable: true }, action_required: { type: "boolean" }, action_status: { type: "string", enum: ["open", "resolved", "superseded"] },
      resolved_at: { type: "string", format: "date-time", nullable: true }, resolution_reason: { type: "string", nullable: true }, archived_at: { type: "string", format: "date-time", nullable: true },
      created_at: { type: "string", format: "date-time" }
    }
  },
  Notification: {
    allOf: [
      { $ref: "#/components/schemas/NotificationRecord" },
      { type: "object", required: ["target_available"], properties: { target_available: { type: "boolean" } } }
    ]
  },
  NotificationResponse: { type: "object", required: ["data"], properties: { data: { $ref: "#/components/schemas/NotificationRecord" } } },
  NullableNotificationResponse: { type: "object", required: ["data"], properties: { data: { allOf: [{ $ref: "#/components/schemas/NotificationRecord" }], nullable: true } } },
  NotificationsResponse: {
    type: "object", required: ["data", "meta"], properties: {
      data: { type: "array", items: { $ref: "#/components/schemas/Notification" } },
      meta: { type: "object", required: ["page", "pageSize", "sortOrder", "total", "unreadCount", "openActionCount"], properties: {
        page: { type: "integer" }, pageSize: { type: "integer" }, sortOrder: { type: "string", enum: ["asc", "desc"] }, total: { type: "integer" }, unreadCount: { type: "integer" }, openActionCount: { type: "integer" }
      } }
    }
  },
  UpdatedCountResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["updatedCount"], properties: { updatedCount: { type: "integer" } } } } },
  ClientReviewDecision: {
    type: "object", required: ["id", "decision", "comment", "reviewedAt", "reviewerName"], properties: {
      id: { type: "string", format: "uuid" }, decision: { type: "string", enum: ["approved", "changes_requested"] }, comment: { type: "string", nullable: true },
      reviewedAt: { type: "string", format: "date-time" }, reviewerName: { type: "string" }
    }
  },
  ClientReviewInboxItem: {
    type: "object",
    required: ["versionId", "deliverableId", "deliverableTitle", "deliverableDescription", "deliverableStatus", "versionNumber", "submissionNote", "clientSubmittedAt", "file", "project", "client", "clientRole", "review", "canReview"],
    properties: {
      versionId: { type: "string", format: "uuid" }, deliverableId: { type: "string", format: "uuid" }, deliverableTitle: { type: "string" }, deliverableDescription: { type: "string", nullable: true },
      deliverableStatus: { type: "string" }, versionNumber: { type: "integer" }, submissionNote: { type: "string", nullable: true }, clientSubmittedAt: { type: "string", format: "date-time" },
      file: { type: "object", required: ["id", "name", "size", "mimeType", "storageType", "externalUrl"], properties: {
        id: { type: "string", format: "uuid" }, name: { type: "string" }, size: { type: "string" }, mimeType: { type: "string" },
        storageType: { type: "string", enum: ["local", "s3", "google_drive", "dropbox", "onedrive", "external"] }, externalUrl: { type: "string", nullable: true }
      } },
      project: { type: "object", required: ["id", "name", "phase", "deadline"], properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, phase: { type: "string" }, deadline: { type: "string", format: "date" } } },
      client: { type: "object", required: ["id", "name"], properties: { id: { type: "string", format: "uuid" }, name: { type: "string" } } },
      clientRole: { type: "string", enum: ["reviewer", "viewer"] },
      review: { allOf: [{ $ref: "#/components/schemas/ClientReviewDecision" }], nullable: true }, canReview: { type: "boolean" }
    }
  },
  ClientReviewInboxResponse: {
    type: "object", required: ["data", "meta"], properties: {
      data: { type: "array", items: { $ref: "#/components/schemas/ClientReviewInboxItem" } },
      meta: { type: "object", required: ["status", "sort", "counts"], properties: {
        status: { type: "string", enum: ["pending", "reviewed", "history"] }, sort: { type: "string", enum: ["oldest", "newest", "deadline"] },
        counts: { type: "object", required: ["pending", "reviewed", "history"], properties: { pending: { type: "integer" }, reviewed: { type: "integer" }, history: { type: "integer" } } }
      } }
    }
  }
};

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

  const spec = {
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
      { name: "notifications" },
      { name: "invitations" }
      ,{ name: "client portal" }
      ,{ name: "deliverables" }
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
        },
        ProjectSetupRequest: {
          type: "object",
          required: ["name", "startDate", "deadline", "team"],
          properties: {
            clientId: { type: "string", format: "uuid" },
            newClient: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string", minLength: 1, maxLength: 255 },
                company: { type: "string", nullable: true, maxLength: 255 }
              }
            },
            name: { type: "string", minLength: 1, maxLength: 255 },
            description: { type: "string", nullable: true, maxLength: 10000 },
            priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
            budget: { type: "string", nullable: true, maxLength: 32 },
            startDate: { type: "string", format: "date" },
            deadline: { type: "string", format: "date" },
            team: {
              type: "array",
              maxItems: 100,
              items: {
                type: "object",
                required: ["userId", "role"],
                properties: {
                  userId: { type: "string", format: "uuid" },
                  role: { type: "string", enum: ["manager", "member", "viewer"] }
                }
              }
            }
          },
          description: "Exactly one of clientId or newClient is required. All records are committed atomically."
        },
        ProjectPhaseTransitionRequest: {
          type: "object",
          required: ["phase"],
          properties: {
            phase: {
              type: "string",
              enum: ["client_acquisition", "strategy_planning", "production", "post_production", "delivery"]
            },
            reason: { type: "string", nullable: true, maxLength: 1000 },
            clientUpdate: { type: "string", nullable: true, maxLength: 2000 },
            confirmUnresolvedReviews: { type: "boolean", default: false }
          }
        },
        ...responseContractSchemas
      },
      parameters: {
        requestIdHeader: {
          in: "header",
          name: "x-request-id",
          required: false,
          schema: { type: "string" },
          description: "Optional request correlation ID."
        },
        idempotencyKeyHeader: {
          in: "header",
          name: "idempotency-key",
          required: false,
          schema: { type: "string", minLength: 1, maxLength: 255 },
          description: "Stable key used to safely retry a workflow mutation without creating duplicate work."
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
          summary: "Authenticate and set a secure refresh cookie",
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
          summary: "Rotate the refresh cookie and issue an access token",
          responses: {
            "200": { description: "Refresh successful" },
            "409": { description: "A concurrent request already rotated this cookie; retry once" },
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
      "/clients/{id}/activity": withAuth({
        get: {
          tags: ["clients"],
          summary: "List client-related project activity",
          responses: { "200": { description: "Client activity feed" }, ...errorResponses }
        }
      }),
      "/projects/setup": withAuth({
        post: {
          tags: ["projects"],
          summary: "Create a client, project, and initial team atomically",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProjectSetupRequest" }
              }
            }
          },
          responses: {
            "201": { description: "Project setup committed" },
            "422": {
              description: "One or more selected team members are invalid",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            },
            ...errorResponses
          }
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
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProjectPhaseTransitionRequest" }
              }
            }
          },
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
          summary: "Add a project team member",
          responses: { "201": { description: "Project team member added" }, ...errorResponses }
        }
      }),
      "/projects/{id}/team/{userId}": withAuth({
        patch: {
          tags: ["projects"],
          summary: "Change a project team member role",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["role"],
                  properties: { role: { type: "string", enum: ["manager", "member", "viewer"] } }
                }
              }
            }
          },
          responses: { "200": { description: "Project team role updated" }, ...errorResponses }
        },
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
      "/tasks/{id}/deliverables": withAuth({
        post: {
          tags: ["tasks", "deliverables"],
          summary: "Link an existing deliverable or create one for a task",
          responses: { "201": { description: "Deliverable linked to task" }, ...errorResponses }
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
      "/tasks/bulk/update": withAuth({
        post: {
          tags: ["tasks"],
          summary: "Bulk assign or classify tasks in one project",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["taskIds"],
                  properties: {
                    taskIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", format: "uuid" } },
                    assigneeIds: { type: "array", maxItems: 50, items: { type: "string", format: "uuid" } },
                    phase: { type: "string", enum: ["client_acquisition", "strategy_planning", "production", "post_production", "delivery"] },
                    priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
                    addLabels: {
                      type: "array",
                      maxItems: 12,
                      items: {
                        type: "object",
                        required: ["name", "color"],
                        properties: {
                          name: { type: "string", minLength: 1, maxLength: 50 },
                          color: { type: "string", enum: ["violet", "blue", "green", "amber", "rose", "slate"] }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: { "200": { description: "Bulk task update result" }, ...errorResponses }
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
      "/files/upload-binary": withAuth({
        post: {
          tags: ["files"],
          summary: "Upload a local project file (multipart, maximum 50 MB)",
          responses: { "201": { description: "File stored and registered" }, ...errorResponses }
        }
      }),
      "/files/{id}/content": withAuth({
        get: {
          tags: ["files"],
          summary: "Authorize and stream file content",
          responses: { "200": { description: "File content" }, ...errorResponses }
        }
      }),
      "/files/{id}/preview-session": withAuth({
        post: {
          tags: ["files"],
          summary: "Create a five-minute, file-scoped in-app preview session",
          responses: { "200": { description: "Preview session created" }, ...errorResponses }
        }
      }),
      "/files/{id}/preview": {
        get: {
          tags: ["files"],
          summary: "Stream inline preview content using the HTTP-only preview session",
          responses: {
            "200": { description: "Complete preview content" },
            "206": { description: "Partial preview content for media seeking" },
            ...errorResponses
          }
        }
      },
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
          summary: "Supervisor action dashboard (RBAC scoped)",
          responses: { "200": { description: "Review queues, delivery risks, due work, and team workload" }, ...errorResponses }
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
          parameters: [
            { name: "view", in: "query", schema: { type: "string", enum: ["all", "unread", "action_required", "resolved", "archived"] } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
            { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }
          ],
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

      "/client-invitations": withAuth({
        get: {
          tags: ["invitations"],
          summary: "List client portal memberships and pending invitations",
          responses: { "200": { description: "Client access list" }, ...errorResponses }
        },
        post: {
          tags: ["invitations"],
          summary: "Create a seven-day client invitation",
          responses: { "201": { description: "Invitation and one-time URL" }, ...errorResponses }
        }
      }),
      "/client-invitations/client/{clientId}": withAuth({
        get: {
          tags: ["invitations"],
          summary: "List invitations for a client organization",
          responses: { "200": { description: "Invitation list" }, ...errorResponses }
        }
      }),
      "/client-invitations/{id}": withAuth({
        delete: {
          tags: ["invitations"],
          summary: "Revoke an invitation",
          responses: { "204": { description: "Invitation revoked" }, ...errorResponses }
        }
      }),
      "/client-invitations/token/{token}": {
        get: {
          tags: ["invitations"],
          summary: "Inspect an invitation before acceptance",
          responses: { "200": { description: "Sanitized invitation details" }, ...errorResponses }
        }
      },
      "/client-invitations/token/{token}/accept": {
        post: {
          tags: ["invitations"],
          summary: "Accept invitation and create client account",
          responses: { "201": { description: "Client membership and session created" }, ...errorResponses }
        }
      },
      "/client-invitations/token/{token}/accept-existing": withAuth({
        post: {
          tags: ["invitations"],
          summary: "Accept invitation with the signed-in invited account",
          responses: { "200": { description: "Client membership created" }, ...errorResponses }
        }
      }),
      "/deliverables": withAuth({
        post: {
          tags: ["deliverables"],
          summary: "Create a project deliverable",
          responses: { "201": { description: "Deliverable created" }, ...errorResponses }
        }
      }),
      "/deliverables/project/{projectId}": withAuth({
        get: {
          tags: ["deliverables"],
          summary: "List deliverables, versions, and reviews",
          responses: { "200": { description: "Deliverable list" }, ...errorResponses }
        }
      }),
      "/deliverables/{id}/versions": withAuth({
        post: {
          tags: ["deliverables"],
          summary: "Submit a numbered deliverable version for internal review",
          parameters: [{ $ref: "#/components/parameters/idempotencyKeyHeader" }],
          responses: { "201": { description: "Version sent to project supervisors" }, ...errorResponses }
        }
      }),
      "/notifications/{id}/archive": withAuth({
        patch: {
          tags: ["notifications"],
          summary: "Archive a non-actionable or resolved notification",
          responses: { "200": { description: "Notification archived" }, ...errorResponses }
        }
      }),
      "/notifications/{id}/restore": withAuth({
        patch: {
          tags: ["notifications"],
          summary: "Restore an archived notification",
          responses: { "200": { description: "Notification restored" }, ...errorResponses }
        }
      }),
      "/client-invitations/memberships/{clientId}/{userId}": withAuth({
        patch: {
          tags: ["invitations"],
          summary: "Change an accepted client portal role (administrator only)",
          responses: { "200": { description: "Client membership role updated" }, ...errorResponses }
        },
        delete: {
          tags: ["invitations"],
          summary: "Revoke accepted client portal access (administrator only)",
          responses: { "204": { description: "Client membership revoked" }, ...errorResponses }
        }
      }),
      "/deliverables/versions/{versionId}/internal-review": withAuth({
        post: {
          tags: ["deliverables"],
          summary: "Approve or request changes during internal review",
          parameters: [{ $ref: "#/components/parameters/idempotencyKeyHeader" }],
          responses: { "201": { description: "Internal review recorded" }, ...errorResponses }
        }
      }),
      "/deliverables/versions/{versionId}/submit-client": withAuth({
        post: {
          tags: ["deliverables"],
          summary: "Submit an internally approved version to client reviewers",
          parameters: [{ $ref: "#/components/parameters/idempotencyKeyHeader" }],
          responses: { "200": { description: "Version submitted to the client" }, ...errorResponses }
        }
      }),
      "/deliverables/versions/{versionId}/withdraw-client": withAuth({
        post: {
          tags: ["deliverables"],
          summary: "Pull an active client review back to internal approval by its original submitter",
          parameters: [{ $ref: "#/components/parameters/idempotencyKeyHeader" }],
          responses: { "200": { description: "Version withdrawn from client review" }, ...errorResponses }
        }
      }),
      "/deliverables/versions/{versionId}/messages": withAuth({
        post: {
          tags: ["deliverables"],
          summary: "Send a supervisor reply to the client review thread",
          parameters: [{ $ref: "#/components/parameters/idempotencyKeyHeader" }],
          responses: { "201": { description: "Message sent" }, ...errorResponses }
        }
      }),
      "/deliverables/versions/{versionId}/forward-feedback": withAuth({
        post: {
          tags: ["deliverables"],
          summary: "Route edited client feedback to selected project tasks",
          parameters: [{ $ref: "#/components/parameters/idempotencyKeyHeader" }],
          responses: { "201": { description: "Feedback added to tasks and assignees notified" }, ...errorResponses }
        }
      }),
      "/client-portal/projects": withAuth({
        get: {
          tags: ["client portal"],
          summary: "List signed-in client's projects",
          responses: { "200": { description: "Sanitized client project list" }, ...errorResponses }
        }
      }),
      "/client-portal/projects/{projectId}": withAuth({
        get: {
          tags: ["client portal"],
          summary: "Get sanitized client project detail",
          responses: { "200": { description: "Client project detail" }, ...errorResponses }
        }
      }),
      "/client-portal/versions/{versionId}/reviews": withAuth({
        post: {
          tags: ["client portal"],
          summary: "Approve or request changes on the latest version",
          parameters: [{ $ref: "#/components/parameters/idempotencyKeyHeader" }],
          responses: { "201": { description: "Review recorded" }, ...errorResponses }
        }
      }),
      "/client-portal/reviews": withAuth({
        get: {
          tags: ["client portal"],
          summary: "List the signed-in client's review-ready deliverables and history",
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["pending", "reviewed", "history"], default: "pending" } },
            { name: "sort", in: "query", schema: { type: "string", enum: ["oldest", "newest", "deadline"] } }
          ],
          responses: { "200": { description: "Sanitized client review inbox" }, ...errorResponses }
        }
      }),
      "/client-portal/versions/{versionId}/messages": withAuth({
        post: {
          tags: ["client portal"],
          summary: "Send a message to project supervisors in a deliverable thread",
          parameters: [{ $ref: "#/components/parameters/idempotencyKeyHeader" }],
          responses: { "201": { description: "Client message sent" }, ...errorResponses }
        }
      }),

      "/users": withAuth({
        get: {
          tags: ["users"],
          summary: "List users",
          responses: { "200": { description: "Users list" }, ...errorResponses }
        },
        post: {
          tags: ["admin"],
          summary: "Admin: create a staff account",
          responses: { "201": { description: "Staff account created" }, ...errorResponses }
        }
      }),
      "/users/me/change-password": withAuth({
        post: {
          tags: ["users"],
          summary: "Change the current user's password",
          responses: { "204": { description: "Password changed and other sessions revoked" }, ...errorResponses }
        }
      }),
      "/users/admin/password-reset": withAuth({
        post: {
          tags: ["admin"],
          summary: "Administrator password reset for a user",
          responses: { "200": { description: "Password reset result" }, ...errorResponses }
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
  applySuccessContracts(spec as unknown as {
    components: { schemas: Record<string, OpenApiSchema> };
    paths: Record<string, Record<string, unknown>>;
  });
  return spec;
}
