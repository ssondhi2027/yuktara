# Yuktara developer commands. Backend commands run in backend/ with its .venv.
#   make setup   create backend/.venv and install dependencies
#   make dev     run the API on http://127.0.0.1:8000 (reloads on change)
#   make test    backend tests (database tests run when TEST_DATABASE_URL is set) and the frontend unit tests
#   make test-db start local Supabase, reset it, run every backend test against it
#   make lint    ruff for the backend, typecheck for the frontend
#   make walkthrough  end-to-end flow on the local stack (needs `make dev` running with SUPABASE_SERVICE_ROLE_KEY)

ifeq ($(OS),Windows_NT)
  PY := .venv/Scripts/python
else
  PY := .venv/bin/python
endif

LOCAL_DB := postgresql://postgres:postgres@127.0.0.1:54322/postgres

.PHONY: setup dev test test-db lint web walkthrough

setup:
	cd backend && python -m venv .venv && $(PY) -m pip install -e ".[dev]"

dev:
	cd backend && $(PY) -m uvicorn app.main:create_app --factory --reload --port 8000

test:
	cd backend && $(PY) -m pytest
	cd frontend && npm test

test-db:
	npx supabase start -x studio,logflare,vector,edge-runtime,realtime,imgproxy,postgres-meta
	npx supabase db reset
	cd backend && TEST_DATABASE_URL=$(LOCAL_DB) $(PY) -m pytest

lint:
	cd backend && $(PY) -m ruff check . && $(PY) -m ruff format --check .
	cd frontend && npm run typecheck

web:
	cd frontend && npm run dev

walkthrough:
	cd backend && $(PY) scripts/walkthrough.py
