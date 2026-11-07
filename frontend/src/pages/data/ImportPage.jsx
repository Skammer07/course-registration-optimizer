import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { importCsv } from "../../api/data.js";
import { Alert, ErrorAlert } from "../../components/ui/Alert.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Card, CardBody, CardHeader } from "../../components/ui/Card.jsx";
import { Segmented, inputClass } from "../../components/ui/Fields.jsx";
import { PageHeader, tableClass, tdClass, thClass } from "../../components/ui/Misc.jsx";
import { StatRow, StatTile } from "../../components/ui/StatTile.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { cn } from "../../components/ui/cn.js";
import {
  IMPORT_SPEC,
  IMPORT_TYPES,
  MAX_CSV_BYTES,
  byteLength,
  countRows,
  importSignature,
  templateCsv,
} from "../../features/data/importSpec.js";
import { saveBlob } from "../../lib/download.js";
import { formatInt, plural } from "../../lib/format.js";
import { useDocumentTitle } from "../../lib/hooks.js";

function ColumnList({ title, columns }) {
  if (columns.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {columns.map(([name, note]) => (
          <li key={name} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <code className="rounded bg-wash px-1.5 py-0.5 text-xs font-semibold text-ink">{name}</code>
            <span className="text-ink-3">{note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What went wrong in the file, row by row. */
function ProblemsTable({ details }) {
  const rows = details.filter((d) => d && typeof d === "object");
  const notes = details.filter((d) => typeof d === "string");
  return (
    <div className="space-y-3">
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className={tableClass}>
            <caption className="sr-only">Problems found in the file</caption>
            <thead>
              <tr>
                <th scope="col" className={thClass}>Row</th>
                <th scope="col" className={thClass}>Column</th>
                <th scope="col" className={thClass}>Problem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d, i) => (
                <tr key={i}>
                  <td className={cn(tdClass, "tabular w-16")}>{d.row ?? "–"}</td>
                  <td className={cn(tdClass, "w-40")}>{d.column ? <code className="text-xs">{d.column}</code> : "–"}</td>
                  <td className={tdClass}>{d.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {notes.length > 0 ? <ul className="list-disc pl-5 text-sm">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
    </div>
  );
}

/** The temporary passwords of newly created logins. They are shown once, so they can be saved here. */
function CredentialsPanel({ credentials, csv, onDismiss }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the download still works */
    }
  };

  return (
    <Card>
      <CardHeader
        title="Temporary passwords"
        description={`${plural(credentials.length, "new login")}. Students must change the password when they sign in.`}
        actions={
          <>
            <Button size="sm" icon={visible ? "x" : "shield"} onClick={() => setVisible((v) => !v)} aria-pressed={visible}>
              {visible ? "Hide passwords" : "Show passwords"}
            </Button>
            <Button size="sm" icon="copy" onClick={copy}>{copied ? "Copied" : "Copy as CSV"}</Button>
            <Button size="sm" icon="download" onClick={() => saveBlob(new Blob([csv], { type: "text/csv" }), "student-logins.csv")}>Download CSV</Button>
          </>
        }
      />
      <CardBody className="space-y-3">
        <Alert tone="warning" title="Shown only once">
          These passwords are not stored anywhere readable and cannot be shown again. Save the file and hand each password to its student.
        </Alert>
        <div className="max-h-72 overflow-auto rounded-lg border border-line">
          <table className={tableClass}>
            <caption className="sr-only">New student logins</caption>
            <thead>
              <tr>
                <th scope="col" className={thClass}>Student</th>
                <th scope="col" className={thClass}>Email</th>
                <th scope="col" className={thClass}>Password</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((c) => (
                <tr key={c.studentId}>
                  <td className={tdClass}>{c.studentId}</td>
                  <td className={tdClass}>{c.email}</td>
                  <td className={cn(tdClass, "font-mono text-xs")}>{visible ? c.temporaryPassword : "••••••••••••"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onDismiss}>I have saved them, hide this</Button>
        </div>
      </CardBody>
    </Card>
  );
}

function ResultSummary({ result, type }) {
  return (
    <div className="space-y-3">
      <StatRow label="Import result">
        <StatTile label="Rows in the file" value={formatInt(result.totalRows)} />
        <StatTile label={result.dryRun ? "Would be added" : "Added"} value={formatInt(result.created)} tone={result.created ? "good" : "neutral"} />
        <StatTile label={result.dryRun ? "Would be updated" : "Updated"} value={formatInt(result.updated)} />
        <StatTile label="Skipped" value={formatInt(result.skipped)} hint="Already exist, left as they are" />
      </StatRow>
      <p className="text-sm text-ink-2">
        {type === "students" && result.loginsCreated != null ? <span className="mr-4">Logins {result.dryRun ? "to create" : "created"}: <span className="tabular font-medium text-ink">{formatInt(result.loginsCreated)}</span></span> : null}
        {type === "preferences" && result.lists != null ? <span>Preference lists: <span className="tabular font-medium text-ink">{formatInt(result.lists)}</span></span> : null}
      </p>
    </div>
  );
}

export function ImportPage() {
  useDocumentTitle("Import data");
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInput = useRef(null);

  const [type, setType] = useState("students");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [onExisting, setOnExisting] = useState("skip");
  const [createLogins, setCreateLogins] = useState(false);
  const [status, setStatus] = useState("submitted");
  const [checked, setChecked] = useState(null); // { signature, result }
  const [credentials, setCredentials] = useState(null);

  const spec = IMPORT_SPEC[type];
  const options = { onExisting, createLogins: type === "students" && createLogins, status: type === "preferences" ? status : undefined };
  const signature = importSignature(type, text, options);
  const bytes = byteLength(text);
  const rows = countRows(text);
  const tooBig = bytes > MAX_CSV_BYTES;
  const checkedMatches = checked?.signature === signature;

  const run = useMutation({
    mutationFn: ({ dryRun }) => importCsv(type, text, { ...options, dryRun }),
    onSuccess: (result, { dryRun }) => {
      if (dryRun) {
        setChecked({ signature, result });
        return;
      }
      setChecked(null);
      setCredentials(result.credentials?.length ? { list: result.credentials, csv: result.credentialsCsv } : null);
      queryClient.invalidateQueries({ queryKey: ["data"] });
      queryClient.invalidateQueries({ queryKey: ["semesters", "overview"] });
      toast.success("Import finished", `${formatInt(result.created)} added, ${formatInt(result.updated)} updated, ${formatInt(result.skipped)} skipped.`);
      setText("");
      setFileName("");
    },
  });

  const reset = () => run.reset();
  const changeType = (next) => {
    setType(next);
    setChecked(null);
    reset();
  };
  const changeText = (value) => {
    setText(value);
    reset();
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    changeText(await file.text());
    setFileName(file.name);
    e.target.value = "";
  };

  const blocked = !text.trim() || tooBig;
  const problems = run.error?.code === "IMPORT_VALIDATION_FAILED" ? run.error.details ?? [] : null;
  const shownResult = run.data?.dryRun === false ? run.data : checkedMatches ? checked.result : null;

  return (
    <>
      <PageHeader title="Import data" subtitle="Add many students, courses or preference lists at once from a CSV file. Nothing is saved until you import." />

      <div className="space-y-4">
        <Card>
          <CardBody className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented label="What to import" value={type} onChange={changeType} options={IMPORT_TYPES} />
              <Button size="sm" icon="download" onClick={() => saveBlob(new Blob([templateCsv(type)], { type: "text/csv" }), `${type}-template.csv`)}>
                Download a template
              </Button>
            </div>

            <div>
              <p className="text-sm text-ink-2">{spec.summary}</p>
              <div className="mt-3 grid gap-5 sm:grid-cols-2">
                <ColumnList title="Required columns" columns={spec.required} />
                <ColumnList title="Optional columns" columns={spec.optional} />
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Your data" description="Choose a CSV file, or paste its contents." />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={onFile} className="sr-only" aria-label="CSV file" />
              <Button icon="upload" onClick={() => fileInput.current?.click()}>Choose a file</Button>
              {fileName ? <span className="text-sm text-ink-2">{fileName}</span> : <span className="text-sm text-ink-3">No file chosen</span>}
            </div>

            <div>
              <label htmlFor="csv-text" className="mb-1.5 block text-sm font-medium text-ink">CSV contents</label>
              <textarea
                id="csv-text"
                value={text}
                onChange={(e) => changeText(e.target.value)}
                rows={8}
                spellCheck={false}
                placeholder={spec.header.join(",")}
                className={cn(inputClass, "h-auto min-h-40 py-2 font-mono text-xs leading-relaxed")}
              />
              <p className={cn("mt-1 text-xs", tooBig ? "font-medium text-critical-ink" : "text-ink-3")} aria-live="polite">
                {tooBig
                  ? `This is ${(bytes / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB; split the file.`
                  : text.trim()
                    ? `About ${plural(rows, "row")} · ${(bytes / 1024).toFixed(1)} KB`
                    : "The first line must be the column names."}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-sm font-medium text-ink">If a record already exists</p>
                <Segmented
                  label="If a record already exists"
                  value={onExisting}
                  onChange={(v) => { setOnExisting(v); reset(); }}
                  options={[{ value: "skip", label: "Skip it" }, { value: "update", label: "Update it" }]}
                />
                <p className="mt-1.5 text-xs text-ink-3">Updating never clears a field because its cell is empty.</p>
              </div>

              {type === "students" ? (
                <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
                  <input type="checkbox" checked={createLogins} onChange={(e) => { setCreateLogins(e.target.checked); reset(); }} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
                  <span>
                    <span className="block font-medium text-ink">Create a login for each new student</span>
                    <span className="block text-xs text-ink-3">Needs an email column. Temporary passwords are shown once after the import.</span>
                  </span>
                </label>
              ) : null}

              {type === "preferences" ? (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-ink">Save the lists as</p>
                  <Segmented
                    label="Save the lists as"
                    value={status}
                    onChange={(v) => { setStatus(v); reset(); }}
                    options={[{ value: "submitted", label: "Submitted" }, { value: "draft", label: "Drafts" }]}
                  />
                  <p className="mt-1.5 text-xs text-ink-3">Only submitted lists are used by allocation runs.</p>
                </div>
              ) : null}
            </div>
          </CardBody>
        </Card>

        {run.error ? (
          problems ? (
            <Card>
              <CardHeader title="The file has problems" description="Nothing was imported. Fix these in the file and check it again." />
              <CardBody><ProblemsTable details={problems} /></CardBody>
            </Card>
          ) : (
            <ErrorAlert error={run.error} />
          )
        ) : null}

        {shownResult ? (
          <Card>
            <CardHeader
              title={shownResult.dryRun ? "The file looks good" : "Import finished"}
              description={shownResult.dryRun ? "Nothing has been saved yet. Import to save it." : "The data is saved."}
            />
            <CardBody><ResultSummary result={shownResult} type={type} /></CardBody>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button onClick={() => run.mutate({ dryRun: true })} loading={run.isPending && run.variables?.dryRun} disabled={blocked || run.isPending}>
            Check the file
          </Button>
          <Button variant="primary" icon="upload" onClick={() => run.mutate({ dryRun: false })} loading={run.isPending && run.variables?.dryRun === false} disabled={blocked || !checkedMatches || run.isPending}>
            Import
          </Button>
        </div>
        {!blocked && !checkedMatches ? <p className="-mt-2 text-right text-xs text-ink-3">Check the file first. Import unlocks when it passes.</p> : null}

        {credentials ? <CredentialsPanel credentials={credentials.list} csv={credentials.csv} onDismiss={() => setCredentials(null)} /> : null}
      </div>
    </>
  );
}
