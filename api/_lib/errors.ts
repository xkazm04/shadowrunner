// Errors that cross the API (forge-pipeline requirement 7.4, 7.6): `{ error: { code, message } }`.
// The code is a spec code chosen by the caller (forge: `ForgeErrorCode` from @sr/forge/wire;
// voice and engine use the same shape). The message is ours and written for the user; upstream
// bodies, stack traces and secrets never reach it, and logs carry only the code.

/** HTTP status per spec code. Codes not listed answer 500. */
export const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  bad_input: 400,
  refused_likeness: 422,
  refused_content: 422,
  quota: 429,
  upstream: 502,
};

export function statusFor(code: string): number {
  return STATUS_BY_CODE[code] ?? 500;
}

/** An error the API may show the client as is: a spec code and a message we wrote. */
export class ApiError<C extends string = string> extends Error {
  readonly code: C;
  readonly status: number;

  constructor(code: C, message: string, status: number = statusFor(code)) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface ErrorBody<C extends string = string> {
  error: { code: C; message: string };
}

export function errorBody<C extends string>(code: C, message: string): ErrorBody<C> {
  return { error: { code, message } };
}

/** What the client sees for any error that is not an `ApiError`: nothing of the original. */
export const UNKNOWN_FAILURE = errorBody("upstream", "Something in the cellar failed. Try again.");

/**
 * Turns any thrown value into the JSON error response. An `ApiError` keeps its code, message and
 * status; anything else becomes the generic `upstream` body, because its message may hold
 * upstream text. Logs the code (and for unknown errors only the error's class name).
 */
export function errorResponse(err: unknown): Response {
  const headers = { "cache-control": "no-store" };
  if (err instanceof ApiError) {
    console.warn(`api error: ${err.code}`);
    return Response.json(errorBody(err.code, err.message), { status: err.status, headers });
  }
  console.error(`api error: unexpected ${err instanceof Error ? err.name : typeof err}`);
  return Response.json(UNKNOWN_FAILURE, { status: statusFor("upstream"), headers });
}
