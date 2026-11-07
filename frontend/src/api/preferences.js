import { request } from "./client.js";

const root = "/api/v1/preferences";

/** The signed-in student's own lists for a semester (ranked courses populated). */
export const getMyPreferences = (semesterId) => request(`${root}/me`, { query: { semesterId } }).then((d) => d.preferences);

/** Save one list. status: "draft" or "submitted". Fails with PREFERENCES_CLOSED outside the window. */
export const saveMyPreference = ({ semesterId, electiveGroup, rankedCourseIds, status }) =>
  request(`${root}/me`, { method: "PUT", body: { semesterId, electiveGroup, rankedCourseIds, status } }).then((d) => d.preference);
