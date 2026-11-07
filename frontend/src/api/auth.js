import { request } from "./client.js";

const root = "/api/v1/auth";

/** The signed-in user, or throws ApiError(401). Not routed through the "session ended" handler. */
export const getMe = () => request(`${root}/me`, { handle401: false }).then((d) => d.user);

export const login = (email, password) =>
  request(`${root}/login`, { method: "POST", body: { email, password }, handle401: false }).then((d) => d.user);

export const logout = () => request(`${root}/logout`, { method: "POST", handle401: false });

export const changePassword = (currentPassword, newPassword) =>
  request(`${root}/change-password`, { method: "POST", body: { currentPassword, newPassword }, handle401: false });
