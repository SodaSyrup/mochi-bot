const { ValidationError } = require('../errors');

/**
 * Centralized bounded integer parsing for query/input values.
 *
 * Every dashboard route must parse limits/offsets/pages through this helper so
 * malformed values can never reach SQLite. Policy: undefined/empty falls back
 * to the default; any malformed, negative, or out-of-range value is a 400
 * validation error rather than a silent clamp.
 *
 * @param {*} value raw input (query param, body field)
 * @param {{ defaultValue: number, min: number, max: number, name: string }} opts
 * @returns {number}
 */
function parseBoundedInt(value, { defaultValue, min, max, name }) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new ValidationError(`"${name}" must be a finite integer.`);
  }

  const numeric = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(numeric)) {
    throw new ValidationError(`"${name}" must be an integer.`);
  }
  if (numeric < min) {
    throw new ValidationError(`"${name}" must be at least ${min}.`);
  }
  if (numeric > max) {
    throw new ValidationError(`"${name}" must be at most ${max}.`);
  }
  return numeric;
}

module.exports = { parseBoundedInt };
