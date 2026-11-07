import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createCourse, updateCourse } from "../../api/data.js";
import { ErrorAlert } from "../../components/ui/Alert.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Dialog } from "../../components/ui/Dialog.jsx";
import { SelectField, Switch, TextField } from "../../components/ui/Fields.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import {
  EMPTY_COURSE_FORM,
  buildCreatePayload,
  buildUpdatePayload,
  courseToForm,
  validateCourseForm,
} from "./courseForm.js";
import { SlotsEditor } from "./SlotsEditor.jsx";

/**
 * Add a course to the semester being viewed, or edit one. Faculty can change a course's details;
 * switching a course off (so runs ignore it) is an admin decision.
 */
export function CourseFormDialog({ open, onClose, course, semesterId, groups = [], isAdmin }) {
  const mode = course ? "edit" : "create";
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_COURSE_FORM);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open) {
      setForm(course ? courseToForm(course) : EMPTY_COURSE_FORM);
      setErrors({});
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, course]);

  const save = useMutation({
    mutationFn: () => {
      if (mode === "create") return createCourse(buildCreatePayload(form, semesterId));
      const payload = buildUpdatePayload(form, course, { isAdmin });
      return updateCourse(course._id, payload);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["data"] });
      queryClient.invalidateQueries({ queryKey: ["semesters", "overview"] });
      toast.success(mode === "create" ? "Course added" : "Course saved", `${saved.courseCode} · ${saved.title}`);
      onClose();
    },
  });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const compulsory = form.kind === "compulsory";

  const submit = (e) => {
    e.preventDefault();
    const found = validateCourseForm(form, mode);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (mode === "edit" && Object.keys(buildUpdatePayload(form, course, { isAdmin })).length === 0) {
      onClose();
      return;
    }
    save.mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={mode === "create" ? "Add a course" : `Edit ${course?.courseCode}`}
      description={mode === "create" ? `It will be added to ${semesterId}.` : course?.semesterId}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="course-form" loading={save.isPending}>
            {mode === "create" ? "Add course" : "Save changes"}
          </Button>
        </>
      }
    >
      <form id="course-form" onSubmit={submit} noValidate className="space-y-4">
        {save.error ? <ErrorAlert error={save.error} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Course code"
            required
            value={form.courseCode}
            onChange={(e) => set({ courseCode: e.target.value })}
            error={errors.courseCode}
            hint={mode === "edit" ? "The code cannot be changed." : "Stored in capitals."}
            disabled={mode === "edit"}
            autoComplete="off"
            data-autofocus={mode === "create" ? "" : undefined}
          />
          <SelectField
            label="Type"
            value={form.kind}
            onChange={(e) => set({ kind: e.target.value })}
            hint={compulsory ? "Compulsory courses are not allocated; they only block overlapping electives." : "Electives are chosen by students and allocated."}
          >
            <option value="elective">Elective</option>
            <option value="compulsory">Compulsory</option>
          </SelectField>
        </div>

        {compulsory ? (
          <TextField
            label="Departments"
            required
            value={form.departments}
            onChange={(e) => set({ departments: e.target.value })}
            error={errors.departments}
            hint="Students of these departments take this course. Separate with commas, for example CSE, ECE."
            autoComplete="off"
          />
        ) : (
          <TextField
            label="Seats"
            required
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={form.capacity}
            onChange={(e) => set({ capacity: e.target.value })}
            error={errors.capacity}
          />
        )}

        <TextField
          label="Title"
          required
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          error={errors.title}
          autoComplete="off"
          data-autofocus={mode === "edit" ? "" : undefined}
        />

        {compulsory ? null : (
        <div>
          <TextField
            label="Elective group"
            value={form.electiveGroup}
            onChange={(e) => set({ electiveGroup: e.target.value })}
            hint="Leave empty for an open elective: it is offered to every group (OE1, OE2, ...) and shares one pool of seats. Fill it in to offer the course to that group only."
            list="course-groups"
            autoComplete="off"
          />
          <datalist id="course-groups">
            {groups.map((g) => <option key={g} value={g} />)}
          </datalist>
        </div>
        )}

        <SlotsEditor slots={form.slots} onChange={(slots) => set({ slots })} errors={errors.slots} />

        {isAdmin && mode === "edit" ? (
          <Switch
            label="Active"
            description="Inactive courses are left out of allocation runs and cannot be ranked."
            checked={form.isActive}
            onChange={(isActive) => set({ isActive })}
          />
        ) : null}
      </form>
    </Dialog>
  );
}
