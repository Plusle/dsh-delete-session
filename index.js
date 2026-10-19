/**
 * Host half of the `delete-session` bundle.
 *
 * DSH has no session-deletion API: `sessionPersistence` is append-only and the
 * Workspace registry only archives. This plugin owns the one destructive
 * operation the Web UI needs, behind a single same-origin POST route:
 *
 *   POST /delete-session/delete   { sessionId, mode?: 'defer' }
 *
 * What it removes, in this order:
 *   1. the pin / archive marks (public registry API, before the log disappears)
 *   2. the session log directory  (<DSH_HOME>/sessions/<project>/<id>/)
 *   3. the projection cache row   (<DSH_HOME>/storages/session_projcache/sessions/<id>.json)
 *   4. the client list row        (ctx.emit('api-session/removed', id))
 *
 * A live session cannot be deleted safely: its Agent owns an open write handle
 * and `agents` publishes no dispose API. `mode: 'defer'` therefore stops the
 * work, archives the Session, records a tombstone, and purges the files on the
 * next Host start.
 */
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROUTE_PATH = '/delete-session/delete'
const MAX_BODY_BYTES = 4096
const SESSION_ID = /^session-[A-Za-z0-9._-]{1,180}$/
const TOMBSTONE_VERSION = 1

export const inject = ['webServer']

export function apply(ctx, config = {}) {
  const home = resolveHome(config)
  const roots = {
    sessions: resolveDir(config.sessionsRoot, path.join(home, 'sessions')),
    storages: resolveDir(config.storagesRoot, path.join(home, 'storages')),
    state: path.join(home, 'delete-session'),
  }
  const state = {
    tombstones: path.join(roots.state, 'pending.json'),
    audit: path.join(roots.state, 'deleted.jsonl'),
    pending: new Map(),
    tombstoneChain: Promise.resolve(),
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: (req, res) => handleRequest(ctx, state, roots, req, res),
  }), 'delete-session: http route')

  // A deferred delete recorded by a previous process can run now: the previous
  // process is gone, so no Agent holds the log and the file is unlocked.
  ctx.effect(() => {
    const timer = setTimeout(() => {
      purgeTombstones(ctx, state, roots).catch((error) => {
        warn(ctx, `pending purge failed: ${describe(error)}`)
      })
    }, 1500)
    return () => clearTimeout(timer)
  }, 'delete-session: pending purge')
}

/* ------------------------------------------------------------------ route -- */

async function handleRequest(ctx, state, roots, req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { error: 'method-not-allowed', message: 'Use POST.' })
    return
  }

  const rejection = rejectUntrusted(ctx, req)
  if (rejection !== null) {
    send(res, rejection.status, { error: rejection.code, message: rejection.message })
    return
  }

  const contentType = String(req.headers['content-type'] ?? '')
  if (!/^application\/json\b/i.test(contentType)) {
    send(res, 415, { error: 'bad-request', message: 'Content-Type must be application/json.' })
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch (error) {
    send(res, error && error.code === 'too-large' ? 413 : 400, {
      error: 'bad-request',
      message: error && error.code === 'too-large' ? 'The request body is too large.' : 'The request body is not valid JSON.',
    })
    return
  }

  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  if (!SESSION_ID.test(sessionId)) {
    send(res, 400, { error: 'invalid-session-id', message: 'The session id is not a safe session identity.' })
    return
  }

  if (state.pending.has(sessionId)) {
    send(res, 409, { error: 'session/busy', message: 'A deletion for this session is already running.' })
    return
  }

  const outcome = (async () => {
    if (body?.mode === 'defer') return deferDelete(ctx, state, roots, sessionId)
    return deleteNow(ctx, state, roots, sessionId)
  })()
  state.pending.set(sessionId, outcome)
  try {
    const result = await outcome
    send(res, result.status, result.body)
  } catch (error) {
    warn(ctx, `delete ${sessionId} failed: ${describe(error)}`)
    send(res, 500, {
      error: 'delete-failed',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    state.pending.delete(sessionId)
  }
}

/* --------------------------------------------------------------- deletion -- */

async function deleteNow(ctx, state, roots, sessionId) {
  const facts = inspectLive(ctx, sessionId)
  if (facts.live) {
    return {
      status: 409,
      body: {
        error: 'session/live',
        message: 'This session is still running, so its files are locked by the Host. Stop it and restart DSH, or ask for a deferred delete.',
        running: facts.running,
      },
    }
  }

  const outcome = await performDelete(ctx, state, roots, sessionId)
  if (outcome.existed) {
    try {
      ctx.emit('api-session/removed', sessionId)
    } catch (error) {
      warn(ctx, `api-session/removed listener failed: ${describe(error)}`)
    }
  }
  await appendAudit(state, {
    at: Date.now(),
    id: sessionId,
    phase: 'deleted',
    bytes: outcome.bytes,
    dirs: outcome.dirs,
  })
  return {
    status: 200,
    body: {
      deleted: true,
      sessionId,
      alreadyGone: !outcome.existed,
      bytes: outcome.bytes,
      dirs: outcome.dirs,
      cache: outcome.cache,
    },
  }
}

async function deferDelete(ctx, state, roots, sessionId) {
  const registry = getService(ctx, 'workspaceRegistry')
  if (registry === undefined || typeof registry.archiveSession !== 'function') {
    return {
      status: 409,
      body: {
        error: 'session/live',
        message: 'This session is still running and this Host cannot archive it. Restart DSH and delete it again.',
      },
    }
  }

  try {
    await registry.archiveSession(sessionId, { stopActivity: true })
  } catch (error) {
    return {
      status: 409,
      body: {
        error: 'session/live',
        message: `The session could not be stopped and archived: ${describe(error)}`,
      },
    }
  }

  await addTombstone(state, sessionId)
  await appendAudit(state, { at: Date.now(), id: sessionId, phase: 'deferred' })
  return {
    status: 202,
    body: {
      deferred: true,
      sessionId,
      message: 'The session was stopped and archived. Its files are removed the next time DSH starts.',
    },
  }
}

/** Remove every artifact that belongs to exactly this Session. */
async function performDelete(ctx, state, roots, sessionId) {
  const persistence = getService(ctx, 'sessionPersistence')
  let existed = false
  if (persistence !== undefined && typeof persistence.stat === 'function') {
    try {
      existed = Boolean(await persistence.stat(sessionId))
    } catch {
      existed = false
    }
  }

  // Marks first: archive verifies the session still exists, and both writes are
  // durable before the log file disappears.
  const registry = getService(ctx, 'workspaceRegistry')
  if (registry !== undefined) {
    if (typeof registry.unpinSession === 'function') {
      await registry.unpinSession(sessionId).catch(() => undefined)
    }
    if (typeof registry.unarchiveSession === 'function') {
      await registry.unarchiveSession(sessionId).catch(() => undefined)
    }
  }

  const dirs = await findSessionDirs(roots.sessions, sessionId)
  let bytes = 0
  for (const dir of dirs) {
    bytes += await directorySize(dir).catch(() => 0)
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 })
    await pruneEmptyProject(roots.sessions, dir)
  }

  const cache = await deleteProjectionCache(ctx, roots.storages, sessionId)
  return {
    existed: existed || dirs.length > 0 || cache.domain || cache.files > 0,
    bytes,
    dirs: dirs.length,
    cache,
  }
}

/**
 * Locate every stored copy of one Session: one directory per project directory,
 * because the same id is unique but its project folder is derived from the cwd.
 */
async function findSessionDirs(sessionsRoot, sessionId) {
  const found = []
  let entries
  try {
    entries = await fsp.readdir(sessionsRoot, { withFileTypes: true })
  } catch {
    return found
  }
  const realRoot = await fsp.realpath(sessionsRoot).catch(() => path.resolve(sessionsRoot))
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const candidate = path.join(sessionsRoot, entry.name, sessionId)
    let info
    try {
      info = await fsp.lstat(candidate)
    } catch {
      continue
    }
    if (!info.isDirectory() || info.isSymbolicLink()) continue
    const real = await fsp.realpath(candidate).catch(() => '')
    if (real === '' || !isInside(realRoot, real)) continue
    found.push(candidate)
  }
  return found
}

/** Delete the derived projection checkpoint, through the live domain when possible. */
async function deleteProjectionCache(ctx, storagesRoot, sessionId) {
  let domain = false
  try {
    const facility = getService(ctx, 'storageDomain')
    const handle = typeof facility?.get === 'function' ? facility.get('session_projcache') : undefined
    const table = typeof handle?.table === 'function' ? handle.table('sessions') : undefined
    if (typeof table?.delete === 'function') {
      domain = (await table.delete(sessionId)) === true
    }
  } catch {
    domain = false
  }

  let files = 0
  const dir = path.join(storagesRoot, 'session_projcache', 'sessions')
  let names
  try {
    names = await fsp.readdir(dir)
  } catch {
    return { domain, files }
  }
  for (const name of names) {
    if (name !== `${sessionId}.json` && !name.startsWith(`${sessionId}.json.bak.`)) continue
    try {
      await fsp.rm(path.join(dir, name), { force: true })
      files += 1
    } catch {
      // A file that cannot be removed here is retried by the next delete call.
    }
  }
  return { domain, files }
}

/** Remove the project directory when this was its last session. */
async function pruneEmptyProject(sessionsRoot, sessionDir) {
  const projectDir = path.dirname(sessionDir)
  if (path.dirname(projectDir) !== path.resolve(sessionsRoot)) return
  try {
    await fsp.rmdir(projectDir)
  } catch {
    // Not empty (other sessions) or not removable: leave it alone.
  }
}

async function directorySize(root) {
  let total = 0
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(target)
      } else if (entry.isFile()) {
        const info = await fsp.lstat(target).catch(() => undefined)
        if (info !== undefined) total += info.size
      }
    }
  }
  return total
}

/* ------------------------------------------------------------- tombstones -- */

async function readTombstones(state) {
  try {
    const raw = await fsp.readFile(state.tombstones, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed?.version !== TOMBSTONE_VERSION || !Array.isArray(parsed.ids)) return []
    return parsed.ids.filter((entry) => entry && typeof entry.id === 'string' && SESSION_ID.test(entry.id))
  } catch {
    return []
  }
}

async function writeTombstones(state, entries) {
  await fsp.mkdir(path.dirname(state.tombstones), { recursive: true })
  const temp = `${state.tombstones}.${process.pid}.tmp`
  await fsp.writeFile(temp, JSON.stringify({ version: TOMBSTONE_VERSION, ids: entries }, null, 2), 'utf8')
  await fsp.rename(temp, state.tombstones)
}

function mutateTombstones(state, mutate) {
  const run = state.tombstoneChain.then(async () => {
    const current = await readTombstones(state)
    const next = await mutate(current)
    await writeTombstones(state, next)
    return next
  })
  state.tombstoneChain = run.then(() => undefined, () => undefined)
  return run
}

function addTombstone(state, sessionId) {
  return mutateTombstones(state, (current) => {
    if (current.some((entry) => entry.id === sessionId)) return current
    return [...current, { id: sessionId, at: Date.now() }]
  })
}

async function purgeTombstones(ctx, state, roots) {
  const entries = await readTombstones(state)
  if (entries.length === 0) return
  const keep = []
  for (const entry of entries) {
    const facts = inspectLive(ctx, entry.id)
    if (facts.live) {
      keep.push(entry)
      continue
    }
    try {
      const outcome = await performDelete(ctx, state, roots, entry.id)
      try {
        ctx.emit('api-session/removed', entry.id)
      } catch {
        // No page is connected during startup; the row is gone from persistence anyway.
      }
      await appendAudit(state, {
        at: Date.now(),
        id: entry.id,
        phase: 'purged',
        bytes: outcome.bytes,
        dirs: outcome.dirs,
      })
    } catch (error) {
      keep.push(entry)
      warn(ctx, `pending delete ${entry.id} failed: ${describe(error)}`)
    }
  }
  await writeTombstones(state, keep)
}

async function appendAudit(state, record) {
  try {
    await fsp.mkdir(path.dirname(state.audit), { recursive: true })
    await fsp.appendFile(state.audit, `${JSON.stringify(record)}\n`, 'utf8')
  } catch {
    // Diagnostics only: a failed audit line never fails the deletion.
  }
}

/* --------------------------------------------------------------- security -- */

function rejectUntrusted(ctx, req) {
  const connection = getService(ctx, 'connection')
  const gate = connection?.requestRejection

  if (typeof gate === 'function') {
    // The Host's own fence: the same admission the /api route applies to every
    // browser request, including the page's own RPC calls. It already covers
    // Host/Origin, trusted and bind authorities, and the login cookie.
    let status
    try {
      // Keep `this`: the Host service method delegates to `this.admit`.
      status = gate.call(connection, { headers: req.headers })
    } catch {
      status = 403
    }
    if (status === 401) {
      return {
        status: 401,
        code: 'login-required',
        message: 'DSH login required: reopen the URL printed when dsh web started.',
      }
    }
    if (typeof status === 'number') {
      return {
        status,
        code: 'untrusted-origin',
        message: 'The Host refused this request.',
      }
    }
    return null
  }

  // Older Hosts without the connection service: keep a loopback fence of our own.
  if (!sameOrigin(req.headers, [])) {
    return {
      status: 403,
      code: 'untrusted-origin',
      message: 'This request came from an untrusted origin and was refused.',
    }
  }
  return null
}

/**
 * The same Host/Origin rule DSH's own API fence uses: a rebinding page cannot
 * forge `Host`, an absent Origin means the caller is not a page, and an Origin
 * that is present must match the Host.
 */
function sameOrigin(headers, trustedHosts) {
  const host = firstHeader(headers, 'host')
  if (host !== undefined && !loopbackAuthority(host) && !trustedAuthority(host, trustedHosts)) return false
  if (firstHeader(headers, 'sec-fetch-site')?.toLowerCase() === 'cross-site') return false
  const origin = firstHeader(headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function firstHeader(headers, name) {
  const value = headers?.[name]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0]
  return undefined
}

function loopbackAuthority(host) {
  const lower = host.toLowerCase()
  const name = lower.startsWith('[') ? lower.slice(0, lower.indexOf(']') + 1) : lower.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]'
}

function trustedAuthority(host, trustedHosts) {
  const request = parseAuthority(host)
  if (request === null) return false
  return trustedHosts.some((entry) => {
    const declared = parseAuthority(entry)
    if (declared === null) return false
    return declared.port === '' ? declared.hostname === request.hostname : declared.host === request.host
  })
}

function parseAuthority(value) {
  try {
    const url = new URL(`http://${value}`)
    const canonical = url.port === '' ? url.hostname : `${url.hostname}:${url.port}`
    return canonical === value.toLowerCase() ? url : null
  } catch {
    return null
  }
}

/* ----------------------------------------------------------------- helpers -- */

function inspectLive(ctx, sessionId) {
  const agents = getService(ctx, 'agents')
  const sessions = getService(ctx, 'sessions')
  const running = typeof agents?.get === 'function' && agents.get(sessionId) !== undefined
  const live = running || (typeof sessions?.get === 'function' && sessions.get(sessionId) !== undefined)
  return { live, running }
}

function getService(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request body too large')
      error.code = 'too-large'
      throw error
    }
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(res, status, body) {
  if (res.headersSent) return
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(body))
}

function resolveHome(config) {
  const configured = typeof config?.dshHome === 'string' && config.dshHome.trim() !== ''
    ? config.dshHome.trim()
    : undefined
  if (configured !== undefined) return path.resolve(configured)
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return path.resolve(env.trim())
  return path.join(os.homedir(), '.dsh')
}

function resolveDir(configured, fallback) {
  return typeof configured === 'string' && configured.trim() !== ''
    ? path.resolve(configured.trim())
    : path.resolve(fallback)
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

function warn(ctx, message) {
  try {
    ctx.logger?.warn?.(`[delete-session] ${message}`)
  } catch {
    // Logging never decides an outcome.
  }
}
