import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import { validateData, type GymData } from "../src/lib/gym.ts";
import { ConflictError, ValidationError } from "./repository.ts";

export interface DataRepository {
  getData(userId: string): Promise<{ data: GymData; revision: number }>;
  saveData(
    userId: string,
    data: GymData,
    expectedRevision: number,
  ): Promise<{ data: GymData; revision: number }>;
}

export function createApp({
  repository,
  auth,
  appOrigin,
}: {
  repository: DataRepository;
  auth: { proxy: RequestHandler; requireUser: RequestHandler };
  appOrigin: string;
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers.origin !== appOrigin) {
        res.status(403).json({
          error:
            "요청한 주소를 확인해주세요. 같은 사이트에서 다시 시도해주세요.",
        });
        return;
      }
    }
    next();
  });
  app.use("/api/auth", express.raw({ type: "*/*", limit: "1mb" }), auth.proxy);
  app.use("/api", express.json({ limit: "10mb" }));
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/api/data", auth.requireUser, async (_req, res) => {
    res.json(await repository.getData(res.locals.user.id));
  });
  app.put("/api/data", auth.requireUser, async (req, res) => {
    if (!req.is("application/json")) {
      res.status(415).json({ error: "JSON 형식의 기록만 저장할 수 있어요." });
      return;
    }
    const { data, revision } = req.body ?? {};
    if (
      !validateData(data) ||
      !Number.isSafeInteger(revision) ||
      revision < 0
    ) {
      res.status(400).json({
        error:
          "기록 형식이 올바르지 않아요. 이름, 날짜, 세트 입력을 확인해주세요.",
      });
      return;
    }
    res.json(await repository.saveData(res.locals.user.id, data, revision));
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "요청한 기능을 찾을 수 없어요." });
  });
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof ConflictError) {
      res.status(409).json({
        error:
          "다른 기기에서 기록이 변경됐어요. 최신 기록을 확인한 후 다시 저장해주세요.",
      });
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "기록 데이터는 10MB 이하여야 해요." });
      return;
    }
    if (error?.type === "entity.parse.failed") {
      res.status(400).json({ error: "데이터 형식이 올바르지 않아요." });
      return;
    }
    // Database errors can contain credentials or record contents: do not serialize them.
    console.error("Gym Log API request failed", {
      code: typeof error?.code === "string" ? error.code : "INTERNAL_ERROR",
    });
    res.status(503).json({
      error:
        "서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요. 저장 완료를 확인하지 못했어요.",
    });
  };
  app.use(handleError);
  return app;
}
