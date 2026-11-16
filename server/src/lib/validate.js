import { badRequest } from './errors.js'

export function str(value, { field, max = 500, required = false } = {}) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (required && !text) throw badRequest(`${field || 'value'} is required`)
  if (text.length > max) throw badRequest(`${field || 'value'} is too long (max ${max})`)
  return text
}

export function email(value) {
  const text = str(value, { field: 'email', max: 254, required: true }).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw badRequest('enter a valid email address')
  return text
}

export function password(value) {
  const text = typeof value === 'string' ? value : ''
  if (text.length < 8) throw badRequest('password must be at least 8 characters')
  if (text.length > 200) throw badRequest('password is too long')
  return text
}

export function slug(value) {
  const text = str(value, { field: 'shop link', max: 60, required: true }).toLowerCase()
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(text))
    throw badRequest('shop link may use letters, numbers and hyphens only')
  return text
}

export function int(value, { field, min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback
    throw badRequest(`${field || 'value'} is required`)
  }
  const number = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(number) || number < min || number > max)
    throw badRequest(`${field || 'value'} must be between ${min} and ${max}`)
  return Math.trunc(number)
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  return value === 'true' || value === '1' || value === 'on' || value === 'yes'
}

export function mode(value) {
  const text = String(value ?? 'bw').toLowerCase()
  if (text !== 'bw' && text !== 'color') throw badRequest('print mode must be bw or color')
  return text
}

/** Rupees (number) → integer paise, rejecting nonsense prices. */
export function paise(rupees, field = 'price') {
  const number = typeof rupees === 'number' ? rupees : Number.parseFloat(String(rupees))
  if (!Number.isFinite(number) || number < 0 || number > 100000)
    throw badRequest(`${field} must be between 0 and 100000`)
  return Math.round(number * 100)
}

export const rupees = (paiseValue) => Math.round(Number(paiseValue)) / 100