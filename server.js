// Push Poker server: one table, server-authoritative state, pushed to every client over Socket.IO.
//
// Resilience:
// - A seat belongs to a player token (kept in the browser's localStorage), not to a socket.
//   Reconnecting with the token reclaims the seat; a seat that is offline can also be claimed
//   from another device via the join screen.
// - State is written to game-state.json after every change and reloaded on startup, so a
//   crashed or restarted server resumes the game and win counts.

import express from 'express'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Server } from 'socket.io'
import * as G from './lib/game.js'

const here = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = process.env.STATE_FILE || join(here, 'game-state.json')
const PORT = Number(process.env.PORT) || 3000

let state = loadState()

function loadState() {
  if (process.argv.includes('--fresh') || !existsSync(STATE_FILE)) return G.createState()
  try {
    const s = G.normalizeState(JSON.parse(readFileSync(STATE_FILE, 'utf8')))
    console.log(`Resumed saved table from ${STATE_FILE} (${s.players.length} players, phase: ${s.phase})`)
    return s
  } catch (e) {
    console.error(`Could not read ${STATE_FILE}, starting fresh:`, e.message)
    return G.createState()
  }
}

function saveState() {
  try {
    const tmp = STATE_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(state))
    renameSync(tmp, STATE_FILE) // atomic replace, so a crash mid-write never corrupts the save
  } catch (e) {
    console.error('Failed to save state:', e.message)
  }
}

const app = express()
app.use(express.static(join(here, 'public')))
app.use('/faces', express.static(join(here, 'node_modules/deck-of-cards/example/faces')))
const http = createServer(app)
const io = new Server(http, {
  // Generous timeouts: phones that background the tab or laptops that sleep come back quietly.
  pingInterval: 10000,
  pingTimeout: 20000,
})

// playerId -> Set of socket ids. A player is online if any of their sockets is connected.
const sockets = new Map()
const lastSlap = new Map() // playerId -> time of their last slap, to stop spamming
const onlineIds = () => new Set([...sockets].filter(([, s]) => s.size).map(([id]) => id))

function broadcast() {
  saveState()
  const online = onlineIds()
  for (const s of io.sockets.sockets.values()) sendView(s, online)
}

function sendView(socket, online = onlineIds()) {
  try {
    socket.emit('state', G.viewFor(state, socket.data.playerId ?? null, online))
  } catch (e) {
    console.error('Failed to build view:', e)
  }
}

// Never let one bad event take the table down; log it and keep serving.
process.on('uncaughtException', (e) => console.error('Uncaught error (server kept running):', e))
process.on('unhandledRejection', (e) => console.error('Unhandled rejection (server kept running):', e))

function bind(socket, player) {
  unbind(socket)
  socket.data.playerId = player.id
  if (!sockets.has(player.id)) sockets.set(player.id, new Set())
  sockets.get(player.id).add(socket.id)
  socket.emit('session', { token: player.token, playerId: player.id })
}

function unbind(socket) {
  const id = socket.data.playerId
  if (id) sockets.get(id)?.delete(socket.id)
  socket.data.playerId = null
}

io.on('connection', (socket) => {
  // Every event runs through here: errors go back to the caller, success re-broadcasts state.
  const on = (event, fn) =>
    socket.on(event, (payload = {}, ack) => {
      try {
        fn(payload)
        broadcast()
        if (typeof ack === 'function') ack({ ok: true })
      } catch (e) {
        if (!(e instanceof G.GameError)) console.error(e)
        if (typeof ack === 'function') ack({ ok: false, error: e.message })
      }
    })

  const me = () => socket.data.playerId || (() => { throw new G.GameError('Join the table first') })()

  on('hello', ({ token }) => {
    const p = token && state.players.find((x) => x.token === token)
    if (p) bind(socket, p)
    else socket.emit('session', { token: null, playerId: null })
  })
  on('join', ({ name, color }) => bind(socket, G.addPlayer(state, { name, color })))
  on('claimSeat', ({ playerId }) => {
    const p = G.getPlayer(state, playerId)
    if (onlineIds().has(p.id)) throw new G.GameError(`${p.name} is still connected`)
    bind(socket, p)
  })
  on('leave', () => {
    const id = me()
    G.removePlayer(state, id)
    for (const sid of sockets.get(id) || []) io.sockets.sockets.get(sid)?.emit('session', { token: null, playerId: null })
    for (const sid of sockets.get(id) || []) { const s = io.sockets.sockets.get(sid); if (s) s.data.playerId = null }
    sockets.delete(id)
  })
  on('kick', ({ playerId }) => {
    me()
    if (onlineIds().has(playerId)) throw new G.GameError('Only offline players can be removed')
    G.removePlayer(state, playerId)
  })
  on('start', () => { me(); G.startGame(state) })
  on('settings', ({ holeCards }) => { me(); G.setHoleCards(state, Number(holeCards)) })
  on('move', (move) => G.applyMove(state, me(), move))
  on('skip', () => {
    me()
    const p = G.currentPlayer(state)
    if (onlineIds().has(p.id)) throw new G.GameError(`${p.name} is online. Give them a moment!`)
    G.applyMove(state, p.id, { type: 'pass' })
  })
  on('abandon', () => { me(); G.abandonGame(state) })
  on('lobby', () => { me(); G.backToLobby(state) })
  on('nextGame', () => {
    me()
    if (state.phase === 'showdown') G.backToLobby(state)
    G.startGame(state)
  })

  // Easter egg: relay a slap to everyone else. Purely cosmetic; never touches game state.
  socket.on('slap', () => {
    const p = state.players.find((x) => x.id === socket.data.playerId)
    if (!p) return
    const now = Date.now()
    if (now - (lastSlap.get(p.id) || 0) < 1500) return
    lastSlap.set(p.id, now)
    for (const s of io.sockets.sockets.values()) {
      if (s.data.playerId !== p.id) s.emit('slap', { name: p.name, color: p.color })
    }
  })

  socket.on('disconnect', () => {
    unbind(socket)
    broadcast()
  })

  sendView(socket)
})

http.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Is Push Poker already running? Try PORT=${PORT + 1} npm start`)
  else console.error(e)
  process.exit(1)
})

http.listen(PORT, () => {
  console.log(`Push Poker running at http://localhost:${PORT}`)
  console.log(`Share it with: ngrok http ${PORT}`)
})
