# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ghost MCP is a TypeScript Model Context Protocol (MCP) server that bridges LLM interfaces and Ghost CMS. It exposes Ghost's Admin API as MCP tools, resources, and prompts. Published as `@fanyangmeng/ghost-mcp` on npm.

## Commands

- **Build:** `npm run build` (compiles TypeScript to `./build/`)
- **Run:** `npm start` or `node build/server.js`
- **Run via npx:** `GHOST_API_URL=... GHOST_ADMIN_API_KEY=... npx @fanyangmeng/ghost-mcp`
- **No tests or linting** are currently configured

## Required Environment Variables

- `GHOST_API_URL` — Ghost site URL (e.g., `https://yourblog.com`)
- `GHOST_ADMIN_API_KEY` — Ghost Admin API key
- `GHOST_API_VERSION` — optional, defaults to `v5.0`

The server exits immediately if the first two are missing (see `src/config.ts`).

## Architecture

**Entry point:** `src/server.ts` — creates the MCP server, registers all resources/tools/prompts, connects via `StdioServerTransport`. Logs go to stderr (stdout is reserved for MCP protocol messages).

**Key modules:**
- `src/config.ts` — reads and validates env vars
- `src/ghostApi.ts` — initializes the `@tryghost/admin-api` client singleton
- `src/models.ts` — TypeScript interfaces for Ghost entities (Post, User, Member, Tier, Offer, Newsletter)
- `src/resources.ts` — MCP resource handlers (URI templates like `user://{user_id}`)
- `src/prompts.ts` — MCP prompt definitions (e.g., `summarize-post`)
- `src/tools/*.ts` — one file per Ghost entity type (10 total)

**Tool module pattern:** Every file in `src/tools/` exports a `registerXxxTools(server)` function. Inside, Zod schemas define parameters for each operation (browse/read/add/edit/delete), then tools are registered on the server with naming convention `{entity}_{action}` (e.g., `posts_browse`, `members_add`). All tools delegate to `ghostApiClient` methods and return JSON text responses.

**Tool coverage by entity:**
| Entity | Operations |
|---|---|
| posts, members, tags, tiers, offers, newsletters | browse, read, add, edit, delete |
| users | browse, read, edit, delete |
| invites | browse, add, delete |
| roles | browse, read |
| webhooks | add, edit, delete |

## Key Dependencies

- `@modelcontextprotocol/sdk` — MCP server/transport implementation
- `@tryghost/admin-api` — official Ghost Admin API client
- `zod` — runtime parameter validation for all tool inputs

## Notable TODOs in Codebase

- Resource handlers in `src/resources.ts` mostly return placeholders; actual API calls need implementation
- Server version is hardcoded in `src/server.ts:19` instead of reading from package.json
