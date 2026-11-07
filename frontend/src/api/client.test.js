import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, buildUrl, request, setUnauthorizedHandler } from "./client.js";
import * as authApi from "./auth.js";
import * as allocations from "./allocations.js";

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => setUnauthorizedHandler(null));

describe("buildUrl", () => {
  it("skips empty values and encodes the rest", () => {
    expect(buildUrl("/api/x", { a: 1, b: "", c: undefined, d: null, e: "a b&c" })).toBe("/api/x?a=1&e=a+b%26c");
    expect(buildUrl("/api/x")).toBe("/api/x");
    expect(buildUrl("/api/x", { page: 0 })).toBe("/api/x?page=0");
  });
});

describe("request", () => {
  it("sends cookies, returns the data of the envelope and posts JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { success: true, data: { run: { id: 1 } } }));
    vi.stubGlobal("fetch", fetchMock);
    const data = await request("/api/v1/thing", { method: "POST", body: { a: 1 } });
    expect(data).toEqual({ run: { id: 1 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/thing");
    expect(init).toMatchObject({ method: "POST", credentials: "include", body: '{"a":1}', headers: { "Content-Type": "application/json" } });
  });

  it("returns the whole body when there is no data envelope (e.g. /health)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { status: "ok" })));
    expect(await request("/health")).toEqual({ status: "ok" });
  });

  it("turns an error envelope into an ApiError with code, details and request id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(422, { success: false, error: { code: "IMPORT_VALIDATION_FAILED", message: "bad", details: [{ row: 2 }] }, requestId: "abc" })));
    const error = await request("/api/v1/x").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: "IMPORT_VALIDATION_FAILED", message: "bad", details: [{ row: 2 }], requestId: "abc" });
  });

  it("copes with an error that is not JSON (a proxy page)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502, headers: { "x-request-id": "hdr-1" } })));
    const error = await request("/api/v1/x").catch((e) => e);
    expect(error).toMatchObject({ status: 502, code: "HTTP_502", requestId: "hdr-1" });
    expect(error.message).toMatch(/502/);
  });

  it("reports an unreachable server as NETWORK_ERROR (status 0)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const error = await request("/api/v1/x").catch((e) => e);
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("tells the app when the session ended (401), except for login and the session check", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => json(401, { success: false, error: { code: "UNAUTHORIZED", message: "no" } })));

    await request("/api/v1/allocations/runs").catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);

    await authApi.login("a@b.co", "x").catch(() => {});
    await authApi.getMe().catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1); // unchanged
  });

  it("downloads a file and reads its name from Content-Disposition", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("a,b\n1,2\n", { status: 200, headers: { "content-disposition": 'attachment; filename="allocation-SEM-1-baseline-abc123.csv"' } })));
    const { blob, filename } = await allocations.exportRun("run1", "baseline");
    expect(filename).toBe("allocation-SEM-1-baseline-abc123.csv");
    expect(await blob.text()).toBe("a,b\n1,2\n");
  });
});

describe("endpoint wrappers", () => {
  it("call the documented paths with the documented bodies", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(200, { success: true, data: { run: {}, user: {}, semesters: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await allocations.publishRun("r 1", "baseline");
    await allocations.verifyRun("r1");
    await allocations.verifyRun("r1", "optimized");
    await allocations.listRuns({ status: "running", semesterId: "S", limit: 5 });
    await allocations.getResultsByStudent("r1", { algorithm: "baseline", search: "ash", page: 2 });
    await authApi.changePassword("old", "new-password");

    const seen = fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
    expect(seen).toEqual([
      "POST /api/v1/allocations/runs/r%201/publish",
      "POST /api/v1/allocations/runs/r1/verify",
      "POST /api/v1/allocations/runs/r1/verify?algorithm=optimized",
      "GET /api/v1/allocations/runs?status=running&semesterId=S&limit=5",
      "GET /api/v1/allocations/runs/r1/results/by-student?algorithm=baseline&search=ash&page=2",
      "POST /api/v1/auth/change-password",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ algorithm: "baseline" });
    expect(JSON.parse(fetchMock.mock.calls[5][1].body)).toEqual({ currentPassword: "old", newPassword: "new-password" });
  });
});
