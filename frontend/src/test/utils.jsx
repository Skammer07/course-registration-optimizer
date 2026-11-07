import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import App from "../App.jsx";
import { AuthProvider } from "../auth/AuthProvider.jsx";
import { ToastProvider } from "../components/ui/Toast.jsx";

// ---- real API responses captured from the backend (see src/test/fixtures) -------------
const files = import.meta.glob("./fixtures/*.json", { eager: true, import: "default" });
export const fixture = (name) => structuredClone(files[`./fixtures/${name}.json`]);

export const ADMIN = fixture("login-admin").data.user;
export const STUDENT = fixture("login-student").data.user;
export const FACULTY = { ...ADMIN, _id: "faculty-1", email: "faculty@example.edu", role: "faculty" };

// ---- response builders --------------------------------------------------------------------
export const ok = (data, message = "OK") => ({ status: 200, body: { success: true, message, data } });
export const created = (data) => ({ status: 201, body: { success: true, message: "Created", data } });
export const fail = (status, code, message, details = [], requestId = "req-test-1") => ({
  status,
  body: { success: false, error: { code, message, details }, requestId },
});
export const csvFile = (text, filename = "allocation.csv") => ({
  status: 200,
  raw: text,
  headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="${filename}"` },
});

/** Run summary as the API returns it: take the captured one and change what a test cares about. */
export function summaryOf(name, patch = {}) {
  const base = fixture(name).data;
  return { ...base, ...patch, run: { ...base.run, ...(patch.run ?? {}) } };
}

/** JSON bodies are parsed; a text body (a CSV upload) is kept as the string that was sent. */
function parseBody(init) {
  if (!init.body) return undefined;
  try {
    return JSON.parse(init.body);
  } catch {
    return init.body;
  }
}

/**
 * Fake fetch. `handlers` maps "METHOD /path/:param" to a response (or a function of the call).
 * Anything the UI asks for that is not mocked fails the test loudly.
 */
export function createFetchMock(handlers = {}) {
  const calls = [];
  const routes = Object.entries(handlers).map(([key, handler]) => {
    const [method, path] = key.split(" ");
    const regex = new RegExp(`^${path.replace(/:[A-Za-z]+/g, "[^/]+")}$`);
    return { method, regex, handler };
  });

  const fn = vi.fn(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    const call = {
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: parseBody(init),
      contentType: new Headers(init.headers ?? {}).get("content-type") ?? undefined,
    };
    calls.push(call);

    // later registrations win, so a test can override a default
    const route = [...routes].reverse().find((r) => r.method === method && r.regex.test(url.pathname));
    if (!route) throw new Error(`Unmocked request: ${method} ${url.pathname}${url.search}`);
    // a handler may return a promise (to keep a request "in flight" while a test looks at the UI)
    const result = await (typeof route.handler === "function" ? route.handler(call) : route.handler);
    const headers = { "content-type": "application/json", ...(result.headers ?? {}) };
    return new Response(result.raw !== undefined ? result.raw : JSON.stringify(result.body), { status: result.status, headers });
  });

  return {
    fn,
    calls,
    callsTo: (method, path) => calls.filter((c) => c.method === method && c.path === path),
    add: (key, handler) => {
      const [method, path] = key.split(" ");
      routes.push({ method, regex: new RegExp(`^${path.replace(/:[A-Za-z]+/g, "[^/]+")}$`), handler });
    },
  };
}

/**
 * Render the whole app at `route`, signed in as `user` (or signed out when null).
 * Returns the fake fetch (for assertions) and a userEvent instance.
 */
export function renderApp({ route = "/", user = ADMIN, handlers = {} } = {}) {
  const mock = createFetchMock({
    "GET /api/v1/auth/me": user ? ok({ user }) : fail(401, "UNAUTHORIZED", "No authentication token provided."),
    ...handlers,
  });
  vi.stubGlobal("fetch", mock.fn);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
  const events = userEvent.setup();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...mock, ...view, events, queryClient };
}
