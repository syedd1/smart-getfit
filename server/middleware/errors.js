// Central error handling. Clients get a status code and a generic message — never a
// stack trace, SQL error or file path. Details go to the server log.

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

const GENERIC = {
  400: ['bad_request', 'The request was not valid.'],
  404: ['not_found', 'Not found.'],
  413: ['payload_too_large', 'The request is too large.'],
  500: ['internal_error', 'Something went wrong. Please try again.'],
};

const wantsJson = (req) => req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json';

export const notFound = (req, res, next) => next(new HttpError(404, ...GENERIC[404]));

export function errorHandler({ logger, pages }) {
  // Express recognises error handlers by their four parameters, so `next` must stay.
  return (err, req, res, next) => { // eslint-disable-line no-unused-vars
    let status = Number(err.status || err.statusCode) || 500;
    if (status < 400 || status > 599) status = 500;
    if (err.type === 'entity.too.large') status = 413;
    if (err.type === 'entity.parse.failed') status = 400;

    let code;
    let message;
    if (err instanceof HttpError && status < 500) {
      ({ code, message } = err);
    } else {
      [code, message] = GENERIC[status] || (status < 500 ? GENERIC[400] : GENERIC[500]);
    }

    if (status >= 500) {
      logger.error('request failed', { status, method: req.method, path: req.originalUrl, err });
    } else if (status !== 404) {
      logger.debug('request rejected', { status, code, method: req.method, path: req.originalUrl });
    }

    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(status).set('Cache-Control', 'no-store');
    if (wantsJson(req)) res.json({ error: code, message });
    else res.type('html').send(status === 404 || status < 500 ? pages.notFound : pages.serverError);
  };
}
