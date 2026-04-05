.PHONY: dev build lint typecheck \
        up down logs fresh \
        build-sandbox \
        help

# ── Local dev (hot-reload, no Docker) ────────────────────────────────────────
dev:
	pnpm dev

build:
	pnpm build

lint:
	pnpm lint

typecheck:
	turbo typecheck

# ── Docker (production compose) ──────────────────────────────────────────────
up-prod:
	docker compose up -d

down-prod:
	docker compose down

# Fresh start — wipe volumes and rebuild images
fresh-prod:
	docker compose down -v
	docker compose up -d --build

# ── Docker (dev compose) ─────────────────────────────────────────────────────
up-dev:
	docker compose -f docker-compose.dev.yml up -d

down-dev:
	docker compose -f docker-compose.dev.yml down -v

# ── Sandbox image ─────────────────────────────────────────────────────────────
build-sandbox:
	./scripts/build-sandbox.sh

# ── Help ─────────────────────────────────────────────────────────────────────
help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  Dev"
	@echo "    dev            pnpm dev (all services, hot-reload)"
	@echo "    build          turbo build"
	@echo "    lint           turbo lint"
	@echo "    typecheck      turbo typecheck"
	@echo ""
	@echo "  Docker (prod)"
	@echo "    up-prod         docker compose up -d"
	@echo "    down-prod       docker compose down"
	@echo "    fresh-prod      down -v + up --build"
	@echo ""
	@echo "  Docker (dev, only for sandbox-image testing)"
	@echo "    up-dev         docker-compose.dev.yml up -d"
	@echo "    down-dev       docker-compose.dev.yml down -v"
	@echo ""
	@echo "  Misc"
	@echo "    build-sandbox  build the sandbox Docker image"
