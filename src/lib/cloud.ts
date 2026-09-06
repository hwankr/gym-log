import { validateData, type GymData } from "./gym";

export interface CloudSnapshot {
  data: GymData;
  revision: number;
}
export class CloudError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request(options?: RequestInit): Promise<CloudSnapshot> {
  let response: Response;
  try {
    response = await fetch("/api/data", {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      ...options,
    });
  } catch {
    throw new CloudError(
      "서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.",
      0,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CloudError(
      "서버 응답을 읽지 못했어요. 잠시 후 다시 시도해주세요.",
      response.status,
    );
  }
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("gym-log:auth-expired"));
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "기록을 불러오지 못했어요.";
    throw new CloudError(message, response.status);
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("data" in body) ||
    !("revision" in body) ||
    !validateData(body.data) ||
    !Number.isSafeInteger(body.revision) ||
    Number(body.revision) < 0
  ) {
    throw new CloudError(
      "서버의 기록 형식을 확인하지 못했어요. 데이터는 변경하지 않았어요.",
      500,
    );
  }
  return body as CloudSnapshot;
}
export const getCloudData = () => request();
export const saveCloudData = (data: GymData, revision: number) =>
  request({
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, revision }),
  });
