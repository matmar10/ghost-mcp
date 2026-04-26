#!/usr/bin/env node

const transportMode = (process.env.TRANSPORT || 'stdio').toLowerCase();

if (transportMode === 'stdio') {
    startStdio();
} else if (transportMode === 'http') {
    startHttp();
} else {
    console.error(`Unknown TRANSPORT: ${transportMode}. Use "stdio" or "http".`);
    process.exit(1);
}

async function startStdio() {
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const { createServer } = await import('./createServer.js');
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Ghost MCP TypeScript Server running on stdio");
}

async function startHttp() {
    const { randomUUID } = await import("node:crypto");
    const express = (await import("express")).default;
    const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const { isInitializeRequest } = await import("@modelcontextprotocol/sdk/types.js");
    const { mcpAuthRouter } = await import("@modelcontextprotocol/sdk/server/auth/router.js");
    const { requireBearerAuth } = await import("@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js");
    const { GhostOAuthProvider } = await import("./auth/oauthProvider.js");
    const { createServer } = await import("./createServer.js");

    const PORT = parseInt(process.env.PORT || '8080', 10);
    const mcpPassword = process.env.MCP_PASSWORD;
    const issuerUrl = process.env.MCP_ISSUER_URL;

    if (!mcpPassword) {
        console.error("Error: MCP_PASSWORD environment variable is required in HTTP mode.");
        process.exit(1);
    }
    if (!issuerUrl) {
        console.error("Error: MCP_ISSUER_URL environment variable is required in HTTP mode.");
        process.exit(1);
    }

    const provider = new GhostOAuthProvider(mcpPassword, issuerUrl);
    const issuer = new URL(issuerUrl);
    const mcpUrl = new URL('/mcp', issuer);

    const bearerAuth = requireBearerAuth({ provider });

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // OAuth endpoints (/.well-known, /authorize, /token, /register, /revoke)
    app.use(mcpAuthRouter({
        provider,
        issuerUrl: issuer,
    }));

    // Protected resource metadata
    const resourceMetadata = {
        resource: mcpUrl.href,
        authorization_servers: [issuer.href],
    };

    app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
        res.json(resourceMetadata);
    });

    app.get('/.well-known/oauth-protected-resource', (_req, res) => {
        res.json(resourceMetadata);
    });

    // Health check
    app.get('/health', (_req, res) => {
        res.status(200).json({ status: 'ok' });
    });

    // Login page
    app.get('/login', (req, res) => {
        const { client_id, redirect_uri, code_challenge, state, scope } = req.query as Record<string, string>;
        res.setHeader('Content-Type', 'text/html');
        res.send(`<!DOCTYPE html>
<html>
<head>
    <title>Ghost MCP - Login</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
        .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 360px; width: 100%; }
        h1 { margin: 0 0 1.5rem; font-size: 1.25rem; text-align: center; }
        input { width: 100%; padding: 0.5rem; margin: 0.5rem 0 1rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        button { width: 100%; padding: 0.5rem; background: #15171a; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
        button:hover { background: #333; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Ghost MCP Server</h1>
        <form method="POST" action="/login">
            <input type="hidden" name="client_id" value="${escapeHtml(client_id || '')}">
            <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri || '')}">
            <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge || '')}">
            <input type="hidden" name="state" value="${escapeHtml(state || '')}">
            <input type="hidden" name="scope" value="${escapeHtml(scope || '')}">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required autofocus>
            <button type="submit">Sign In</button>
        </form>
    </div>
</body>
</html>`);
    });

    app.post('/login', (req, res) => {
        const { password, client_id, redirect_uri, code_challenge, state, scope } = req.body;

        if (!password || !provider.validatePassword(password)) {
            const params = new URLSearchParams({
                client_id: client_id ?? '',
                redirect_uri: redirect_uri ?? '',
                code_challenge: code_challenge ?? '',
                state: state ?? '',
                scope: scope ?? '',
                error: 'invalid_password',
            });
            res.redirect(`/login?${params.toString()}`);
            return;
        }

        if (!client_id || !redirect_uri || !code_challenge) {
            res.status(400).json({ error: 'Missing required OAuth parameters' });
            return;
        }

        const scopes = scope ? scope.split(' ') : [];
        const code = provider.generateAuthCode(client_id, code_challenge, redirect_uri, scopes);

        const redirectUrl = new URL(redirect_uri);
        redirectUrl.searchParams.set('code', code);
        if (state) {
            redirectUrl.searchParams.set('state', state);
        }
        res.redirect(redirectUrl.toString());
    });

    // MCP endpoints (protected by bearer auth)
    const sessions = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();

    app.post('/mcp', bearerAuth, async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId && sessions.has(sessionId)) {
            const transport = sessions.get(sessionId)!;
            await transport.handleRequest(req, res, req.body);
            return;
        }

        if (!sessionId && isInitializeRequest(req.body)) {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid: string) => {
                    sessions.set(sid, transport);
                },
            });
            transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid) sessions.delete(sid);
            };
            const server = createServer();
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            return;
        }

        res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session ID' },
            id: null,
        });
    });

    app.get('/mcp', bearerAuth, async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !sessions.has(sessionId)) {
            res.status(400).send('Invalid or missing session ID');
            return;
        }
        await sessions.get(sessionId)!.handleRequest(req, res);
    });

    app.delete('/mcp', bearerAuth, async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !sessions.has(sessionId)) {
            res.status(400).send('Invalid or missing session ID');
            return;
        }
        await sessions.get(sessionId)!.handleRequest(req, res);
    });

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Ghost MCP HTTP server listening on port ${PORT}`);
    });

    process.on('SIGINT', async () => {
        for (const [sid, transport] of sessions) {
            await transport.close();
            sessions.delete(sid);
        }
        process.exit(0);
    });
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
