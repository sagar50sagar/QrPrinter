import { WebSocketServer, WebSocket } from 'ws'
import { deviceFromToken, bearerToken } from '../middleware/agentAuth.js'

// Live agent sockets, keyed by device id. A shop may have more than one agent;
// pushToShop reaches whichever are connected so a job moves immediately.
const sockets = new Map()
let reapTimer = null

const send = (ws, frame) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
}

export function pushToDevice(deviceId, frame) {
  const ws = sockets.get(deviceId)
  if (ws) send(ws, frame)
  return Boolean(ws)
}

export function pushToShop(shopId, frame) {
  let sent = 0
  for (const ws of sockets.values()) {
    if (ws.shopId === shopId && ws.readyState === WebSocket.OPEN) {
      send(ws, frame)
      sent++
    }
  }
  return sent
}

export const isOnline = (deviceId) => {
  const ws = sockets.get(deviceId)
  return Boolean(ws && ws.readyState === WebSocket.OPEN)
}

export function onlineDeviceIds(shopId) {
  const ids = []
  for (const [deviceId, ws] of sockets) if (ws.shopId === shopId && ws.readyState === WebSocket.OPEN) ids.push(deviceId)
  return ids
}

/** Attach the /agent/channel websocket to an existing http server. */
export function attachChannel(server) {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost')
    if (pathname !== '/agent/channel') return // let other upgrades (none today) pass
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  wss.on('connection', async (ws, req) => {
    const device = await deviceFromToken(bearerToken(req.headers.authorization)).catch(() => null)
    if (!device) {
      send(ws, { type: 'refused', reason: 'this device is not paired here' })
      ws.close(1008, 'unauthorized')
      return
    }

    ws.deviceId = device.id
    ws.shopId = device.shop_id
    ws.isAlive = true
    sockets.set(device.id, ws)
    send(ws, { type: 'welcome', device_id: device.id })

    ws.on('pong', () => { ws.isAlive = true })
    ws.on('message', (data) => {
      let frame
      try { frame = JSON.parse(data.toString()) } catch { return }
      if (frame?.type === 'ping') send(ws, { type: 'pong', device_id: device.id })
      else if (frame?.type === 'pong') ws.isAlive = true
      // hello / heartbeat frames are informational; REST carries the real state.
    })
    ws.on('close', () => {
      if (sockets.get(device.id) === ws) sockets.delete(device.id)
    })
    ws.on('error', () => { /* close handler cleans up */ })
  })

  // Reap peers that stopped answering so a half-open socket does not look online.
  reapTimer = setInterval(() => {
    for (const ws of sockets.values()) {
      if (!ws.isAlive) { ws.terminate(); continue }
      ws.isAlive = false
      send(ws, { type: 'ping' })
    }
  }, 25_000)
  reapTimer.unref?.()

  return wss
}

/**
 * Tell every live agent the server is going away and stop the reaper. Agents
 * reconnect on their own; a clean close code lets them do it immediately instead
 * of waiting for the ping timeout to notice a dead socket.
 */
export function shutdownChannels() {
  if (reapTimer) clearInterval(reapTimer)
  for (const ws of sockets.values()) ws.close(1001, 'server restarting')
  sockets.clear()
}