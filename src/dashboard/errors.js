// Application error model. Routes and services throw these; one Express error
// middleware translates them into predictable JSON responses.

class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'AppError';
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(400, 'VALIDATION', message);
    this.name = 'ValidationError';
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required.') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to access this resource.') {
    super(403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found.') {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict.') {
    super(409, 'CONFLICT', message);
    this.name = 'ConflictError';
  }
}

class ExternalServiceError extends AppError {
  constructor(message = 'An external service failed.') {
    super(502, 'EXTERNAL_SERVICE', message);
    this.name = 'ExternalServiceError';
  }
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ExternalServiceError,
};
