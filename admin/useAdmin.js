import { useCallback, useEffect, useState } from 'react'

/**
 * The platform console's state, backed by /api/admin. Separate from the shop
 * panel: a different cookie, a different audience, and no shop of its own.
 */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error || 'the server could not complete that')
    error.status = res.status
    throw error
  }
  return data
}

export function useAdmin() {
  const [admin, setAdmin] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [overview, setOverview] = useState(null)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)

  const refreshOverview = useCallback(async () => {
    try {
      const data = await api('/api/admin/overview')
      setOverview(data)
      setError('')
    } catch (err) {
      if (err.status === 401) setAdmin(null)
      else setError(err.message)
    }
  }, [])

  useEffect(() => {
    let alive = true
    api('/api/admin/auth/me')
      .then((data) => { if (alive) { setAdmin(data.admin); return refreshOverview() } })
      .catch(() => {})
      .finally(() => { if (alive) setAuthChecked(true) })
    return () => { alive = false }
  }, [refreshOverview])

  useEffect(() => {
    if (!admin) return undefined
    const timer = setInterval(refreshOverview, 5000)
    return () => clearInterval(timer)
  }, [admin, refreshOverview])

  const login = useCallback(async (email, password) => {
    const data = await api('/api/admin/auth/login', { method: 'POST', body: { email, password } })
    setAdmin(data.admin)
    await refreshOverview()
  }, [refreshOverview])

  const logout = useCallback(async () => {
    await api('/api/admin/auth/logout', { method: 'POST' }).catch(() => {})
    setAdmin(null)
    setOverview(null)
    setDetail(null)
  }, [])

  const openShop = useCallback(async (id) => {
    setOpening(true)
    try {
      const data = await api(`/api/admin/shops/${id}`)
      setDetail(data)
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setOpening(false)
    }
  }, [])

  const closeShop = useCallback(() => setDetail(null), [])

  const setSuspended = useCallback(async (id, suspended) => {
    try {
      const data = await api(`/api/admin/shops/${id}/suspend`, { method: 'POST', body: { suspended } })
      await refreshOverview()
      setDetail((current) =>
        current && current.shop.id === id ? { ...current, shop: { ...current.shop, ...data.shop } } : current)
      setError('')
      return data.shop
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [refreshOverview])

  const setComped = useCallback(async (id, comped) => {
    try {
      const data = await api(`/api/admin/shops/${id}/comp`, { method: 'POST', body: { comped } })
      await refreshOverview()
      setDetail((current) =>
        current && current.shop.id === id ? { ...current, billing: { ...current.billing, ...data.billing } } : current)
      setError('')
      return data
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [refreshOverview])

  const setPlanPrice = useCallback(async (amount, name) => {
    try {
      const data = await api('/api/admin/plan', { method: 'POST', body: { amount, name } })
      await refreshOverview()
      setError('')
      return data.plan
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [refreshOverview])

  return {
    admin, authChecked, overview, detail, error, opening,
    login, logout, openShop, closeShop, setSuspended, setComped, setPlanPrice, refreshOverview,
  }
}