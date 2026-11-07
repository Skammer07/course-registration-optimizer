import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createStudent, updateStudent } from "../../api/data.js";
import { ErrorAlert } from "../../components/ui/Alert.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Dialog } from "../../components/ui/Dialog.jsx";
import { Switch, TextField } from "../../components/ui/Fields.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import {
  EMPTY_STUDENT_FORM,
  buildCreatePayload,
  buildUpdatePayload,
  studentToForm,
  validateStudentForm,
} from "./studentForm.js";

/** Add a student to the semester being viewed, or edit one. Admin-only fields are read-only for faculty. */
export function StudentFormDialog({ open, onClose, student, semesterId, isAdmin }) {
  const mode = student ? "edit" : "create";
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_STUDENT_FORM);
  const [errors, setErrors] = useState({});
  const lockedForFaculty = mode === "edit" && !isAdmin;

  const save = useMutation({
    mutationFn: () =>
      mode === "create"
        ? createStudent(buildCreatePayload(form, semesterId))
        : updateStudent(student._id, buildUpdatePayload(form, student, { isAdmin })),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["data"] });
      queryClient.invalidateQueries({ queryKey: ["semesters", "overview"] });
      toast.success(mode === "create" ? "Student added" : "Student saved", `${saved.studentId} · ${saved.name}`);
      onClose();
    },
  });

  useEffect(() => {
    if (open) {
      setForm(student ? studentToForm(student) : EMPTY_STUDENT_FORM);
      setErrors({});
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = (e) => {
    e.preventDefault();
    const found = validateStudentForm(form, mode);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (mode === "edit" && Object.keys(buildUpdatePayload(form, student, { isAdmin })).length === 0) {
      onClose();
      return;
    }
    save.mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Add a student" : `Edit ${student?.studentId}`}
      description={mode === "create" ? `The student will be added to ${semesterId}. Logins are created from the CSV import.` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="student-form" loading={save.isPending}>
            {mode === "create" ? "Add student" : "Save changes"}
          </Button>
        </>
      }
    >
      <form id="student-form" onSubmit={submit} noValidate className="space-y-4">
        {save.error ? <ErrorAlert error={save.error} /> : null}
        {lockedForFaculty ? (
          <p className="rounded-lg bg-wash px-3 py-2 text-sm text-ink-2">
            You can change the name and department. CGPA, elective groups and whether the student is active are changed by an admin.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Student ID"
            required
            value={form.studentId}
            onChange={(e) => set({ studentId: e.target.value })}
            error={errors.studentId}
            hint={mode === "edit" ? "The ID cannot be changed." : "Stored in capitals."}
            disabled={mode === "edit"}
            autoComplete="off"
            data-autofocus={mode === "create" ? "" : undefined}
          />
          <TextField
            label="CGPA"
            required
            type="number"
            inputMode="decimal"
            min="0"
            max="10"
            step="0.01"
            value={form.cgpa}
            onChange={(e) => set({ cgpa: e.target.value })}
            error={errors.cgpa}
            disabled={lockedForFaculty}
          />
        </div>

        <TextField
          label="Name"
          required
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          error={errors.name}
          autoComplete="off"
          data-autofocus={mode === "edit" ? "" : undefined}
        />
        <TextField label="Department" value={form.department} onChange={(e) => set({ department: e.target.value })} autoComplete="off" />
        <TextField
          label="Elective groups"
          value={form.electiveGroups}
          onChange={(e) => set({ electiveGroups: e.target.value })}
          hint="Comma separated, for example PE1, OE1. Leave empty to let the student choose from every group."
          disabled={lockedForFaculty}
          autoComplete="off"
        />

        {isAdmin && mode === "edit" ? (
          <Switch
            label="Active"
            description="Inactive students are left out of allocation runs."
            checked={form.isActive}
            onChange={(isActive) => set({ isActive })}
          />
        ) : null}
      </form>
    </Dialog>
  );
}
