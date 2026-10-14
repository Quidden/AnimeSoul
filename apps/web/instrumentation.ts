import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportServerError } = await import("./lib/diagnostics-server");
  const cookie = request.headers.cookie;
  await reportServerError(
    error,
    request.path,
    "boundary",
    typeof cookie === "string" ? cookie : "",
  );
};
