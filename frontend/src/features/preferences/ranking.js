/** Editing a ranked list of course ids. Pure functions: the list is never changed in place. */

export const addCourse = (list, id) => (list.includes(id) ? list : [...list, id]);

export const removeCourse = (list, id) => list.filter((x) => x !== id);

/** Move the item at `index` one place up (-1) or down (+1); out-of-range moves change nothing. */
export function moveCourse(list, index, direction) {
  const to = index + direction;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export const sameList = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Groups a student may choose from: their own, else every group that has courses. */
export function groupsFor(student, courses) {
  if (student?.electiveGroups?.length) return student.electiveGroups;
  return [...new Set(courses.filter((c) => c.kind !== "compulsory").map((c) => c.electiveGroup).filter(Boolean))].sort();
}

/** A priority list holds at most 15 courses, top choice first. */
export const MAX_CHOICES = 15;

/** How many courses a submitted list must hold: 15, or every course available when there are fewer. */
export const requiredChoices = (poolSize) => Math.min(MAX_CHOICES, Math.max(0, poolSize));

/**
 * The courses a list for `group` can choose from: the ones that belong to that group and the open
 * ones (no group of their own), which every group may use. Compulsory courses are never chosen.
 */
export const poolFor = (courses, group) =>
  courses.filter((c) => c.kind !== "compulsory" && (c.electiveGroup == null || c.electiveGroup === group));
