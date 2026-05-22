# Kiro — Developer Index

## Sessions

| # | Title | Date | Status | Journal |
|---|---|---|---|---|
| 1 | AI Fashion Photo Refactor + Google Gemini Integration | 2026-05-17 | 🔄 In Progress | [journal-1.md](./journal-1.md) |

## Quick Context

- **Project**: AI 服装电商创作工作台 (AI Fashion E-commerce Workbench)
- **Active feature being worked on**: `ai-fashion-photo`
- **Current provider**: `IMAGE_API_PROVIDER=google` (Nano Banana 2)
- **Last known good build**: `pnpm build` passes as of 2026-05-17
- **Uncommitted changes**: Yes — see Session 1 journal for full list

## Resume Instructions

To pick up where this session left off:

1. Read `journal-1.md` → "Next Steps" section
2. Run `pnpm build` to confirm clean state
3. Start dev: `env -u HTTP_PROXY -u HTTPS_PROXY NO_PROXY='localhost,127.0.0.1,192.168.0.0/16,*.local' pnpm dev`
4. Test in browser at http://localhost:3000
