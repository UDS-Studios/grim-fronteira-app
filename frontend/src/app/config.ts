const baseUrl = import.meta.env.BASE_URL;

export const API_BASE = import.meta.env.DEV
  ? ""
  : baseUrl === "/"
    ? ""
    : baseUrl.replace(/\/$/, "");
