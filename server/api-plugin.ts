import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'
import { getAzureConfig, azureChatUrl } from './azure'
import { readKB, upsertResources } from './kb-store'
import { searchWeb } from './search'
import { browsePage } from './browser'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(payload)
}

export function apiPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'api-plugin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? ''

        // ── GET /api/kb ──────────────────────────────────────────────────
        if (url === '/api/kb' && req.method === 'GET') {
          return json(res, 200, readKB())
        }

        // ── POST /api/kb/resources ───────────────────────────────────────
        if (url === '/api/kb/resources' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req))
            const resources = Array.isArray(body) ? body : body.resources
            const kb = upsertResources(resources)
            return json(res, 200, kb)
          } catch (err) {
            return json(res, 400, { error: String(err) })
          }
        }

        // ── POST /api/search ─────────────────────────────────────────────
        if (url === '/api/search' && req.method === 'POST') {
          try {
            const { query, maxResults } = JSON.parse(await readBody(req))
            const results = await searchWeb(query, maxResults)
            return json(res, 200, results)
          } catch (err) {
            return json(res, 500, { error: String(err) })
          }
        }

        // ── POST /api/browse ─────────────────────────────────────────────
        if (url === '/api/browse' && req.method === 'POST') {
          try {
            const { url: targetUrl } = JSON.parse(await readBody(req))
            const result = await browsePage(targetUrl)
            return json(res, 200, result)
          } catch (err) {
            return json(res, 500, { error: String(err) })
          }
        }

        // ── POST /api/chat ────────────────────────────────────────────────
        if (url === '/api/chat' && req.method === 'POST') {
          try {
            const cfg = getAzureConfig(env)
            const body = await readBody(req)
            const azureUrl = azureChatUrl(cfg)

            const upstreamRes = await fetch(azureUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'api-key': cfg.key,
              },
              body,
            })

            const responseText = await upstreamRes.text()

            // Check if the client wants streaming
            const reqBody = JSON.parse(body)
            if (reqBody.stream) {
              res.writeHead(upstreamRes.status, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*',
              })
              res.end(responseText)
            } else {
              res.writeHead(upstreamRes.status, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              })
              res.end(responseText)
            }
            return
          } catch (err) {
            return json(res, 500, { error: String(err) })
          }
        }

        // ── OPTIONS preflight ────────────────────────────────────────────
        if (req.method === 'OPTIONS' && url.startsWith('/api/')) {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          })
          return res.end()
        }

        next()
      })
    },
  }
}
