import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { requireTrustedOrigin } from "./auth/middleware";
import { auth } from "./routes/auth";
import { orgs } from "./routes/orgs";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use(secureHeaders());
app.use("/v1/*", async (c, next) =>
  cors({ origin: c.env.PORTAL_ORIGIN, credentials: true, maxAge: 600 })(c, next),
);
app.use("/v1/*", requireTrustedOrigin);
app.use("/v1/*", async (c, next) => {
  await next();
  // Responses carry account data; never let a shared cache keep them.
  c.header("Cache-Control", "no-store");
});

app.get("/healthz", (c) => c.json({ ok: true }));
app.route("/v1/auth", auth);
app.route("/v1/orgs", orgs);

app.notFound((c) => c.json({ error: "Not found." }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Something went wrong." }, 500);
});

export default app;
