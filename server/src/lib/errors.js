/** An error with an HTTP status and a customer-safe message. */
export class ApiError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const badRequest = (message) => new ApiError(400, message)
export const unauthorized = (message = 'sign in to continue') => new ApiError(401, message)
export const forbidden = (message, code) => new ApiError(403, message, code)
export const notFound = (message = 'not found') => new ApiError(404, message)
export const conflict = (message) => new ApiError(409, message)
export const tooManyRequests = (message = 'too many attempts — please wait a moment and try again') => new ApiError(429, message)

/** Wrap an async route so a thrown ApiError becomes a JSON response. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

/** Express error handler. Never leaks a stack or an internal path to the client. */
export function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  const status = error instanceof ApiError ? error.status : (error.status || 500)
  if (status >= 500) console.error('[http]', req.method, req.path, error)
  const message = status >= 500 ? 'something went wrong on our side' : error.message
  const body = { ok: false, error: message }
  if (error.code) body.code = error.code
  res.status(status).json(body)
}