import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { FACULTY, fail, ok, renderApp } from "../../test/utils.jsx";

const semesters = ok({ semesters: [] });
const result = (patch = {}) => ({ dryRun: true, totalRows: 2, created: 2, updated: 0, skipped: 0, ...patch });
const CSV = "studentId,name,cgpa\n21CS001,Asha,8.7\n21CS002,Ben,7.2\n";

function open({ handler, user } = {}) {
  return renderApp({
    route: "/data/import",
    user,
    handlers: { "GET /api/v1/semesters/overview": semesters, "POST /api/v1/imports/:type": handler ?? ((call) => ok(result({ dryRun: call.query.dryRun === "true" }))) },
  });
}

/** userEvent.type treats braces and brackets as key names, so paste is the faithful way to enter CSV text. */
async function paste(events, text) {
  await events.click(await screen.findByLabelText("CSV contents"));
  await events.paste(text);
}

beforeEach(() => window.localStorage.clear());

describe("CSV import", () => {
  it("shows the columns for the chosen type and switches with the type", async () => {
    const { events } = open();
    expect(await screen.findByRole("heading", { name: "Import data" })).toBeInTheDocument();
    expect(screen.getByText("studentId")).toBeInTheDocument();
    expect(screen.getByText("Optional columns")).toBeInTheDocument();

    await events.click(screen.getByRole("radio", { name: "Preferences" }));
    expect(screen.getByText("rank")).toBeInTheDocument();
    expect(screen.queryByText("Optional columns")).not.toBeInTheDocument(); // preferences has none
    expect(screen.getByRole("radio", { name: "Submitted" })).toBeInTheDocument();
  });

  it("keeps both buttons off until there is something to check, and Import off until a check has passed", async () => {
    const { events } = open();
    const check = await screen.findByRole("button", { name: "Check the file" });
    const run = screen.getByRole("button", { name: "Import" });
    expect(check).toBeDisabled();
    expect(run).toBeDisabled();

    await paste(events, CSV);
    expect(check).toBeEnabled();
    expect(run).toBeDisabled();
    expect(screen.getByText(/Check the file first/)).toBeInTheDocument();
    expect(screen.getByText(/About 2 rows/)).toBeInTheDocument();
  });

  it("checks without saving, then imports the same input", async () => {
    const { events, callsTo } = open();
    await paste(events, CSV);
    await events.click(screen.getByRole("button", { name: "Check the file" }));

    expect(await screen.findByText("The file looks good")).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been saved yet/)).toBeInTheDocument();
    const [check] = callsTo("POST", "/api/v1/imports/students");
    expect(check.query).toMatchObject({ dryRun: "true", onExisting: "skip", createLogins: "false" });
    expect(check.contentType).toMatch(/text\/csv/);
    expect(check.body).toBe(CSV);

    const run = screen.getByRole("button", { name: "Import" });
    expect(run).toBeEnabled();
    await events.click(run);
    expect(await screen.findByRole("heading", { name: "Import finished" })).toBeInTheDocument();
    expect(callsTo("POST", "/api/v1/imports/students")[1].query.dryRun).toBe("false");
    // the box is emptied so the same file is not imported twice by accident
    expect(screen.getByLabelText("CSV contents")).toHaveValue("");
  });

  it("a check no longer counts once the text or an option changes", async () => {
    const { events } = open();
    await paste(events, CSV);
    await events.click(screen.getByRole("button", { name: "Check the file" }));
    await screen.findByText("The file looks good");
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();

    await events.click(screen.getByRole("radio", { name: "Update it" }));
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    expect(screen.queryByText("The file looks good")).not.toBeInTheDocument();
  });

  it("lists every problem row when the file is rejected, and imports nothing", async () => {
    const { events, callsTo } = open({
      handler: fail(422, "IMPORT_VALIDATION_FAILED", "The file has problems.", [
        { row: 3, column: "cgpa", message: "cgpa must be a number from 0 to 10." },
        { row: 5, column: "studentId", message: "studentId 21CS001 appears twice." },
      ]),
    });
    await paste(events, CSV);
    await events.click(screen.getByRole("button", { name: "Check the file" }));

    expect(await screen.findByText("The file has problems")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Problems found in the file" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("3")).toBeInTheDocument();
    expect(within(rows[0]).getByText("cgpa")).toBeInTheDocument();
    expect(within(rows[1]).getByText("studentId 21CS001 appears twice.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    expect(callsTo("POST", "/api/v1/imports/students").every((c) => c.query.dryRun === "true")).toBe(true);
  });

  it("shows other failures as an ordinary error", async () => {
    const { events } = open({ handler: fail(500, "IMPORT_FAILED", "The import failed and the records it created were removed.") });
    await paste(events, CSV);
    await events.click(screen.getByRole("button", { name: "Check the file" }));
    expect(await screen.findByText("The import failed and the records it created were removed.")).toBeInTheDocument();
  });

  it("refuses a file over 2 MB without sending it", async () => {
    const { events, callsTo } = open();
    const box = await screen.findByLabelText("CSV contents");
    // fireEvent-style direct value: typing 2 MB would take far too long
    const big = `a,b\n${"x".repeat(2 * 1024 * 1024 + 10)}`;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(box, { target: { value: big } });
    expect(await screen.findByText(/The limit is 2 MB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check the file" })).toBeDisabled();
    expect(callsTo("POST", "/api/v1/imports/students")).toHaveLength(0);
    expect(events).toBeDefined();
  });

  it("reads a chosen file", async () => {
    const { events, callsTo } = open();
    const input = await screen.findByLabelText("CSV file");
    await events.upload(input, new File([CSV], "students.csv", { type: "text/csv" }));
    await waitFor(() => expect(screen.getByLabelText("CSV contents")).toHaveValue(CSV));
    expect(screen.getByText("students.csv")).toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "Check the file" }));
    await waitFor(() => expect(callsTo("POST", "/api/v1/imports/students")[0].body).toBe(CSV));
  });

  it("passes the options for the type", async () => {
    const { events, callsTo } = open();
    await events.click(await screen.findByRole("radio", { name: "Preferences" }));
    await events.click(screen.getByRole("radio", { name: "Drafts" }));
    await paste(events, "studentId,semesterId,electiveGroup,courseCode,rank\n1,S,G,C,1");
    await events.click(screen.getByRole("button", { name: "Check the file" }));
    await waitFor(() => expect(callsTo("POST", "/api/v1/imports/preferences")).toHaveLength(1));
    expect(callsTo("POST", "/api/v1/imports/preferences")[0].query).toMatchObject({ status: "draft", dryRun: "true" });
  });

  describe("new logins", () => {
    const credentials = [
      { studentId: "21CS001", email: "asha@x.edu", temporaryPassword: "Abcd2345wxyz" },
      { studentId: "21CS002", email: "ben@x.edu", temporaryPassword: "Qrst6789mnpq" },
    ];
    const handler = (call) =>
      ok(
        call.query.dryRun === "true"
          ? result({ loginsCreated: 2 })
          : result({ dryRun: false, loginsCreated: 2, credentials, credentialsCsv: "studentId,email,temporaryPassword\n21CS001,asha@x.edu,Abcd2345wxyz\n" })
      );

    async function importWithLogins(events) {
      await paste(events, "studentId,name,cgpa,email\n21CS001,Asha,8.7,asha@x.edu");
      await events.click(screen.getByLabelText(/Create a login for each new student/));
      await events.click(screen.getByRole("button", { name: "Check the file" }));
      await screen.findByText("The file looks good");
      await events.click(screen.getByRole("button", { name: "Import" }));
      return screen.findByText("Temporary passwords");
    }

    it("shows each password once, hidden until asked, with a warning", async () => {
      const { events, callsTo } = open({ handler });
      await importWithLogins(events);
      expect(callsTo("POST", "/api/v1/imports/students")[0].query.createLogins).toBe("true");

      expect(screen.getByText("Shown only once")).toBeInTheDocument();
      expect(screen.queryByText("Abcd2345wxyz")).not.toBeInTheDocument();
      await events.click(screen.getByRole("button", { name: "Show passwords" }));
      expect(screen.getByText("Abcd2345wxyz")).toBeInTheDocument();
      expect(screen.getByText("Qrst6789mnpq")).toBeInTheDocument();
      await events.click(screen.getByRole("button", { name: "Hide passwords" }));
      expect(screen.queryByText("Abcd2345wxyz")).not.toBeInTheDocument();
    });

    it("can be downloaded, and dismissed for good", async () => {
      const saved = [];
      vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b) => (saved.push(b), "blob:test"), revokeObjectURL: () => {} }));
      const { events } = open({ handler });
      await importWithLogins(events);

      await events.click(screen.getByRole("button", { name: "Download CSV" }));
      expect(saved).toHaveLength(1);
      expect(await saved[0].text()).toContain("21CS001,asha@x.edu,Abcd2345wxyz");

      await events.click(screen.getByRole("button", { name: /I have saved them/ }));
      expect(screen.queryByText("Temporary passwords")).not.toBeInTheDocument();
    });
  });

  it("is for admins only", async () => {
    open({ user: FACULTY });
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Import data" })).not.toBeInTheDocument();
  });
});
