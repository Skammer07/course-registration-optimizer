import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { ADMIN, FACULTY, STUDENT, fail, fixture, ok, renderApp } from "../test/utils.jsx";

const runsList = () => ({ "GET /api/v1/allocations/runs": ok(fixture("runs-list").data), "GET /api/v1/semesters/overview": ok(fixture("semester-overview").data) });
const studentPages = () => ({
  "GET /api/v1/allocations/my-results": ok(fixture("my-results-unpublished").data),
  "GET /api/v1/semesters/me/status": ok(fixture("semester-status-open").data),
});

describe("signing in", () => {
  it("sends a signed-out visitor to the sign-in page", async () => {
    renderApp({ route: "/runs", user: null });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("signs an admin in and lands on the runs page, remembering where they were going", async () => {
    const { events, callsTo } = renderApp({
      route: "/runs?status=published",
      user: null,
      handlers: { ...runsList(), "POST /api/v1/auth/login": ok({ user: ADMIN }) },
    });
    await screen.findByRole("heading", { name: "Sign in" });
    const submit = screen.getByRole("button", { name: "Sign in" });
    expect(submit).toBeDisabled(); // nothing typed yet

    await events.type(screen.getByLabelText(/^email/i), "  admin@example.edu ");
    await events.type(screen.getByLabelText(/^password/i), "Admin-pass-123");
    await events.click(submit);

    expect(await screen.findByRole("heading", { name: "Allocation runs" })).toBeInTheDocument();
    expect(callsTo("POST", "/api/v1/auth/login")[0].body).toEqual({ email: "admin@example.edu", password: "Admin-pass-123" });
    // the filter in the original address survived the round trip through the login page
    expect(screen.getByLabelText("Status")).toHaveValue("published");
  });

  it("shows the server's message when the password is wrong, and keeps what was typed", async () => {
    const { events } = renderApp({
      user: null,
      route: "/login",
      handlers: { "POST /api/v1/auth/login": fail(401, "UNAUTHORIZED", "Invalid email or password.") },
    });
    await events.type(await screen.findByLabelText(/^email/i), "admin@example.edu");
    await events.type(screen.getByLabelText(/^password/i), "wrong");
    await events.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Sign-in failed")).toBeInTheDocument();
    expect(within(alert).getByText("Invalid email or password.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^email/i)).toHaveValue("admin@example.edu");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled(); // can try again
  });

  it("explains a rate-limit lockout in plain words", async () => {
    const { events } = renderApp({
      user: null,
      route: "/login",
      handlers: { "POST /api/v1/auth/login": fail(429, "RATE_LIMITED", "Too many login attempts. Please try again later.") },
    });
    await events.type(await screen.findByLabelText(/^email/i), "a@b.co");
    await events.type(screen.getByLabelText(/^password/i), "x");
    await events.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Too many attempts")).toBeInTheDocument();
  });

  it("can show and hide the password", async () => {
    const { events } = renderApp({ user: null, route: "/login" });
    const input = await screen.findByLabelText(/^password/i);
    expect(input).toHaveAttribute("type", "password");
    await events.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
  });

  it("a student lands on their results", async () => {
    const { events } = renderApp({
      user: null,
      route: "/login",
      handlers: { ...studentPages(), "POST /api/v1/auth/login": ok({ user: STUDENT }) },
    });
    await events.type(await screen.findByLabelText(/^email/i), "student@example.edu");
    await events.type(screen.getByLabelText(/^password/i), "Student-pass-123");
    await events.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "My results" })).toBeInTheDocument();
  });

  it("a signed-in user opening /login is sent on to their page", async () => {
    renderApp({ route: "/login", user: ADMIN, handlers: runsList() });
    expect(await screen.findByRole("heading", { name: "Allocation runs" })).toBeInTheDocument();
  });
});

describe("temporary password", () => {
  const temp = { ...ADMIN, mustChangePassword: true };

  it("forces the change before anything else, with no app navigation to wander off to", async () => {
    renderApp({ route: "/runs", user: temp });
    expect(await screen.findByRole("heading", { name: "Choose your own password" })).toBeInTheDocument();
    expect(screen.getByText("You are using a temporary password")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });

  it("checks the new password before asking the server", async () => {
    const { events, callsTo } = renderApp({ route: "/change-password", user: temp });
    await screen.findByRole("heading", { name: "Choose your own password" });

    await events.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByText("Enter your current password.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();

    await events.type(screen.getByLabelText(/^current password/i), "Temp-Pass-1");
    await events.type(screen.getByLabelText(/^new password/i), "Temp-Pass-1");
    await events.type(screen.getByLabelText(/^repeat new password/i), "different");
    await events.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByText("Choose a password different from the current one.")).toBeInTheDocument();
    expect(screen.getByText("The two passwords do not match.")).toBeInTheDocument();
    expect(callsTo("POST", "/api/v1/auth/change-password")).toHaveLength(0);
  });

  it("changes it, then goes to the user's page", async () => {
    let meCalls = 0;
    const { events, callsTo } = renderApp({
      route: "/change-password",
      user: temp,
      handlers: {
        ...runsList(),
        // the second look at the session sees the flag cleared
        "GET /api/v1/auth/me": () => ok({ user: ++meCalls === 1 ? temp : ADMIN }),
        "POST /api/v1/auth/change-password": ok(null, "Password changed"),
      },
    });
    await events.type(await screen.findByLabelText(/^current password/i), "Temp-Pass-1");
    await events.type(screen.getByLabelText(/^new password/i), "My-own-pass-9");
    await events.type(screen.getByLabelText(/^repeat new password/i), "My-own-pass-9");
    await events.click(screen.getByRole("button", { name: "Save new password" }));

    expect(await screen.findByRole("heading", { name: "Allocation runs" })).toBeInTheDocument();
    expect(callsTo("POST", "/api/v1/auth/change-password")[0].body).toEqual({ currentPassword: "Temp-Pass-1", newPassword: "My-own-pass-9" });
    expect(await screen.findByText("Password changed")).toBeInTheDocument();
  });

  it("shows the server's reason when the current password is wrong", async () => {
    const { events } = renderApp({
      route: "/change-password",
      user: temp,
      handlers: { "POST /api/v1/auth/change-password": fail(400, "INVALID_CURRENT_PASSWORD", "The current password is incorrect.") },
    });
    await events.type(await screen.findByLabelText(/^current password/i), "nope-nope");
    await events.type(screen.getByLabelText(/^new password/i), "My-own-pass-9");
    await events.type(screen.getByLabelText(/^repeat new password/i), "My-own-pass-9");
    await events.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
    expect(screen.getByText(/Reference:/)).toBeInTheDocument(); // the request id is offered for support
  });

  it("a normal user can open the page voluntarily and cancel out of it", async () => {
    const { events } = renderApp({ route: "/change-password", user: ADMIN, handlers: runsList() });
    expect(await screen.findByRole("heading", { name: "Change password" })).toBeInTheDocument();
    expect(screen.queryByText("You are using a temporary password")).not.toBeInTheDocument();
    await events.click(screen.getByRole("link", { name: "Cancel" }));
    expect(await screen.findByRole("heading", { name: "Allocation runs" })).toBeInTheDocument();
  });
});

describe("session end and sign-out", () => {
  it("returns to sign-in with an explanation when the session ends mid-use", async () => {
    renderApp({ route: "/runs", user: ADMIN, handlers: { "GET /api/v1/allocations/runs": fail(401, "UNAUTHORIZED", "Invalid or expired token."), "GET /api/v1/semesters/overview": ok(fixture("semester-overview").data) } });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Your session ended")).toBeInTheDocument();
  });

  it("signs out", async () => {
    const { events, callsTo } = renderApp({ route: "/runs", user: ADMIN, handlers: { ...runsList(), "POST /api/v1/auth/logout": ok(null) } });
    await screen.findByRole("heading", { name: "Allocation runs" });
    await events.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(callsTo("POST", "/api/v1/auth/logout")).toHaveLength(1);
    expect(screen.queryByText("Your session ended")).not.toBeInTheDocument(); // a deliberate sign-out is not an expiry
  });

  it("after a deliberate sign-out, the next person signing in lands on their own page, not the previous user's", async () => {
    const { events } = renderApp({
      route: "/runs",
      user: ADMIN,
      handlers: { ...runsList(), ...studentPages(), "POST /api/v1/auth/logout": ok(null), "POST /api/v1/auth/login": ok({ user: STUDENT }) },
    });
    await screen.findByRole("heading", { name: "Allocation runs" });
    await events.click(screen.getByRole("button", { name: "Sign out" }));
    await events.type(await screen.findByLabelText(/^email/i), "student@example.edu");
    await events.type(screen.getByLabelText(/^password/i), "Student-pass-123");
    await events.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "My results" })).toBeInTheDocument();
    expect(screen.queryByText("You don't have access to this page")).not.toBeInTheDocument();
  });

  it("explains a server that cannot be reached, with a way to retry", async () => {
    const { events } = renderApp({ route: "/runs", user: ADMIN, handlers: { "GET /api/v1/auth/me": () => { throw new TypeError("Failed to fetch"); } } });
    expect(await screen.findByText("Cannot reach the server")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(events).toBeTruthy();
  });
});

describe("who can see what", () => {
  it("shows each role its own navigation", async () => {
    const admin = renderApp({ route: "/runs", user: ADMIN, handlers: runsList() });
    await screen.findByRole("heading", { name: "Allocation runs" });
    let nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Allocation runs" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "New run" })).toBeInTheDocument();
    admin.unmount();

    const faculty = renderApp({ route: "/runs", user: FACULTY, handlers: runsList() });
    await screen.findByRole("heading", { name: "Allocation runs" });
    nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("link", { name: "New run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New run" })).not.toBeInTheDocument();
    faculty.unmount();

    renderApp({ route: "/my-results", user: STUDENT, handlers: studentPages() });
    await screen.findByRole("heading", { name: "My results" });
    nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["My results", "My preferences"]);
  });

  it("a student cannot open admin pages, and is told why", async () => {
    renderApp({ route: "/runs", user: STUDENT });
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to my page" })).toHaveAttribute("href", "/my-results");
  });

  it("faculty can read runs but not start one", async () => {
    renderApp({ route: "/runs/new", user: FACULTY });
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("an unknown address gets a friendly page, not a blank one", async () => {
    renderApp({ route: "/nope", user: ADMIN });
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });

  it("opens the menu on a small screen and closes it after navigating", async () => {
    const { events } = renderApp({ route: "/runs", user: ADMIN, handlers: runsList() });
    await screen.findByRole("heading", { name: "Allocation runs" });
    await events.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = await screen.findByRole("dialog", { name: "Menu" });
    expect(within(menu).getByRole("link", { name: "New run" })).toBeInTheDocument();
    await events.click(within(menu).getByRole("button", { name: "Close menu" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).not.toBeInTheDocument());
  });
});
