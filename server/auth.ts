import type { Request, RequestHandler, Response } from "express";
import {
  createAuthServer,
  extractNeonAuthCookies,
  handleAuthProxyRequest,
  serializeSetCookie,
  validateCookieConfig,
} from "@neondatabase/auth/server";

type AuthConfig = {
  baseUrl: string;
  cookieSecret: string;
  appOrigin: string;
};

const authRoutes = new Map([
  ["get-session", "GET"],
  ["token", "GET"],
  ["sign-in/email", "POST"],
  ["sign-up/email", "POST"],
  ["sign-out", "POST"],
]);

function requestHeaders(request: Request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function appendCookies(response: Response, cookies: string[]) {
  if (!cookies.length) return;
  const existing = response.getHeader("set-cookie");
  const previous = Array.isArray(existing)
    ? existing.map(String)
    : existing
      ? [String(existing)]
      : [];
  response.setHeader("set-cookie", [...previous, ...cookies]);
}

export function createAuthHandlers(config: AuthConfig): {
  proxy: RequestHandler;
  requireUser: RequestHandler;
} {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const appOrigin = new URL(config.appOrigin).origin;
  new URL(baseUrl);
  validateCookieConfig({ secret: config.cookieSecret });

  const proxy: RequestHandler = async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const path = request.path.replace(/^\//, "");
    const method = authRoutes.get(path);
    if (!method) {
      response
        .status(404)
        .json({ message: "요청한 인증 기능을 찾을 수 없어요." });
      return;
    }
    if (request.method !== method) {
      response.setHeader("Allow", method);
      response.status(405).json({ message: "지원하지 않는 요청이에요." });
      return;
    }

    try {
      const headers = requestHeaders(request);
      // The origin is configured by the app, never derived from an untrusted Host header.
      const url = new URL(`/api/auth/${path}`, appOrigin);
      url.search = new URL(request.originalUrl, appOrigin).search;
      const body = Buffer.isBuffer(request.body)
        ? request.body.toString("utf8")
        : undefined;
      const upstream = await handleAuthProxyRequest({
        request: new globalThis.Request(url, {
          method,
          headers,
          ...(method === "POST" && body !== undefined ? { body } : {}),
        }),
        path,
        baseUrl,
        cookieSecret: config.cookieSecret,
        sameSite: "lax",
      });
      appendCookies(response, upstream.headers.getSetCookie());

      if (upstream.status >= 500) {
        response.status(502).json({
          message:
            "로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
        });
        return;
      }

      for (const [name, value] of upstream.headers) {
        // fetch has already decoded the body; Node will determine response framing.
        if (
          ![
            "set-cookie",
            "content-encoding",
            "content-length",
            "transfer-encoding",
            "connection",
          ].includes(name)
        ) {
          response.setHeader(name, value);
        }
      }
      response.setHeader("Cache-Control", "no-store");
      response
        .status(upstream.status)
        .send(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.status(502).json({
        message: "로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      });
    }
  };

  const requireUser: RequestHandler = async (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    const headers = requestHeaders(request);
    const cookies = extractNeonAuthCookies(headers);
    if (!cookies) {
      response.status(401).json({ message: "로그인 후 이용해 주세요." });
      return;
    }

    try {
      const auth = createAuthServer({
        baseUrl,
        cookieSecret: config.cookieSecret,
        sameSite: "lax",
        context: () => ({
          getCookies: () => cookies,
          setCookie: (name, value, options) => {
            appendCookies(response, [
              serializeSetCookie({ name, value, ...options }),
            ]);
          },
          getHeader: (name) => headers.get(name),
          getOrigin: () => headers.get("origin") || appOrigin,
          getFramework: () => "gym-log",
        }),
      });
      const { data, error } = await auth.getSession();
      if (error && error.status >= 500) {
        response.status(502).json({
          message:
            "로그인 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        });
        return;
      }
      if (error || !data?.session || !data.user?.id) {
        response
          .status(401)
          .json({ message: "로그인이 만료되었어요. 다시 로그인해 주세요." });
        return;
      }
      response.locals.user = {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
      };
      next();
    } catch {
      response.status(502).json({
        message: "로그인 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      });
    }
  };

  return { proxy, requireUser };
}
