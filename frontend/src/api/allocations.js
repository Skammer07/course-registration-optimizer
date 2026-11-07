import { request } from "./client.js";

const root = "/api/v1/allocations";
const run = (id) => `${root}/runs/${encodeURIComponent(id)}`;

// ---- starting runs -------------------------------------------------------------
/** Both algorithms on the same input. Resolves to the stored run. */
export const compareRun = (body) => request(`${root}/compare`, { method: "POST", body }).then((d) => d.run);

/** One algorithm. body.algorithm is "baseline" or "optimized". */
export const runOne = (body) => request(`${root}/run`, { method: "POST", body }).then((d) => d.run);

// ---- reading runs ----------------------------------------------------------------
/** Paginated run history. Filters: semesterId, status, algorithm, page, limit. */
export const listRuns = (query) => request(`${root}/runs`, { query });

export const getRunSummary = (id) => request(`${run(id)}/summary`);

export const getResultsByStudent = (id, query) => request(`${run(id)}/results/by-student`, { query });

export const getResultsByCourse = (id, query) => request(`${run(id)}/results/by-course`, { query });

// ---- actions on a run --------------------------------------------------------------
export const publishRun = (id, algorithm) =>
  request(`${run(id)}/publish`, { method: "POST", body: { algorithm } }).then((d) => d.run);

export const cancelRun = (id) => request(`${run(id)}/cancel`, { method: "POST" });

export const deleteRun = (id) => request(run(id), { method: "DELETE" });

/** Replay check. Omit algorithm to verify every algorithm the run contains. */
export const verifyRun = (id, algorithm) => request(`${run(id)}/verify`, { method: "POST", query: { algorithm } });

/** CSV download: resolves to { blob, filename }. */
export const exportRun = (id, algorithm) => request(`${run(id)}/export`, { query: { algorithm }, responseType: "blob" });

// ---- students ------------------------------------------------------------------------
/** The signed-in student's own published assignments. */
export const getMyResults = () => request(`${root}/my-results`);
