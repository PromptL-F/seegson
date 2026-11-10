import "dotenv/config";
import express, { type Request } from "express";
import { parse as parseCookieHeader } from "cookie";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createCorsMiddleware } from "./cors";
import { clearLegacySessionCookie } from "./cookies";
import { sdk } from "./sdk";
import { runScheduledArchCheck } from "../agent-tasks";
import { LEGACY_COOKIE_NAME } from "../../shared/const.js";
import { ENV } from "./env";

async function getScheduledTaskUid(req: Request): Promise<string | null> {
  const ticket = req.headers.cookie ? parseCookieHeader(req.headers.cookie)[LEGACY_COOKIE_NAME] : undefined;
  if (!ticket) return null;

  const session = await sdk.verifySession(ticket);
  if (!session || session.appId !== ENV.appId || !session.openId.startsWith("cron_")) return null;

  const identity = await sdk.getUserInfoWithJwt(ticket);
  if (
    identity.openId !== session.openId ||
    identity.projectId !== session.appId ||
    !identity.taskUid
  ) {
    return null;
  }
  return identity.taskUid;
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(createCorsMiddleware());
  app.use(clearLegacySessionCookie());

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  app.post("/api/scheduled/agent", async (req, res) => {
    try {
      // Heartbeat uses app_session_id; it is not the app's regular session-cookie name.
      const taskUid = await getScheduledTaskUid(req);
      if (!taskUid) {
        return res.status(401).json({ error: "A verified scheduled-task identity is required." });
      }
      const result = await runScheduledArchCheck(taskUid);
      return res.status(200).json({ ok: true, ...result });
    } catch {
      console.error("[scheduled] Seegson agent run failed");
      return res.status(500).json({ error: "Scheduled agent run failed." });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const port = parseInt(process.env.PORT || "3000");
  server.listen(port, () => {
    console.log("[api] server listening");
  });
}

startServer().catch(() => {
  console.error("[api] server failed to start");
});
