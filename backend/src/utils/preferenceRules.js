/**
 * src/utils/preferenceRules.js
 * One definition of how long a student's priority list must be, shared by the
 * student submission, the CSV import and the frontend text.
 *
 * Each elective group (OE1, OE2, ...) has its own priority list, top choice first.
 * A list holds at most 15 courses. A *submitted* list must be full: 15 courses,
 * or every course that can be chosen when fewer than 15 exist. A draft may be
 * shorter while the student is still choosing.
 */

export const MAX_PREFERENCES_PER_GROUP = 15;

/** How many courses a submitted list must hold, given how many can be chosen. */
export const requiredListLength = (poolSize) =>
  Math.min(MAX_PREFERENCES_PER_GROUP, Math.max(0, poolSize));

/**
 * A message when the list length is not allowed, otherwise null.
 * @param {{ count: number, status: "draft"|"submitted", poolSize: number }} p
 */
export function listLengthProblem({ count, status, poolSize }) {
  if (count > MAX_PREFERENCES_PER_GROUP) {
    return `A priority list can have at most ${MAX_PREFERENCES_PER_GROUP} courses (you listed ${count}).`;
  }
  if (status === "submitted") {
    const required = requiredListLength(poolSize);
    if (count !== required) {
      return (
        `A submitted list needs exactly ${required} course${required === 1 ? "" : "s"} ` +
        `(${required < MAX_PREFERENCES_PER_GROUP ? "every course available" : `${MAX_PREFERENCES_PER_GROUP} choices`}); you listed ${count}.`
      );
    }
  }
  return null;
}

/** Can a course with this elective group be ranked in a list for `group`? A course with no group is open to every group. */
export const courseFitsGroup = (courseGroup, group) => courseGroup == null || courseGroup === group;
