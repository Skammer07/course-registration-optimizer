import { request } from "./client.js";

const root = "/api/v1/semesters";

/**
 * Every semester that has data or an admin record, with what each holds. Admin / faculty.
 * [{ semesterId, name, recordExists, students, courses, preferenceLists, runs, published }]
 */
export const listSemesterOverview = () => request(`${root}/overview`).then((d) => d.semesters);

/** Banner status for a semester. Students pass "me". */
export const getSemesterStatus = (semesterId = "me") => request(`${root}/${encodeURIComponent(semesterId)}/status`);
