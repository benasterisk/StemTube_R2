# Repository Guidelines

## Project Structure & Module Organization
StemTube is a Flask app anchored in `app.py`, which wires routes, sockets, and background jobs. Domain logic sits in `core/`, split into AI clients (`aiotube_client.py`), signal processing (`stems_extractor.py`, `demucs_wrapper.py`), and orchestration utilities (`download_manager.py`, `logging_config.py`). Shared helpers (ngrok, sessions, cleanup) live in `utils/`. Templates and static assets follow Flask defaults in `templates/` and `static/` (with `static/js`, `static/css`, and audio assets). Operations collateral—setup notes, screenshots, and logs—reside in `docs/`, `bug_screenshots/`, and `logs/`. Use `temp_files/` and `flask_session/` for runtime artifacts only; do not version their contents.

## Build, Test, and Development Commands
- `python3.12 setup_dependencies.py` — provisions the virtualenv, Torch, and model requirements.
- `source venv/bin/activate` — activates the managed environment for CLI work.
- `python check_config.py` — validates `.env` presence, permissions, and critical values.
- `python app.py` — launches the development server on http://localhost:5011.
- `python reset_admin_password.py` — refreshes admin credentials when rotating secrets.

## Coding Style & Naming Conventions
Default to Python 3.12 + PEP 8 with four-space indentation, expressive snake_case names, and module-level docstrings that mirror the existing `core/*.py` files. Prefer type hints on new public functions and keep orchestration code in Flask blueprints or service modules rather than in views. For templates, keep Jinja blocks lowercase with hyphenated filenames, and mirror static asset names (e.g., `static/js/mixer-controls.js`) when introducing related scripts.

## Testing Guidelines
The project currently lacks automated coverage; add `pytest`-based suites under `tests/` that mirror the module tree (e.g., `tests/core/test_stems_extractor.py`). Focus on deterministic units: config loading, download orchestration, and helper utilities. Use `pytest -k <pattern>` for targeted runs, and include fixture-driven mocks for GPU-dependent paths. Run tests from an activated venv so Demucs and madmom imports resolve.

## Commit & Pull Request Guidelines
Adopt Conventional Commit prefixes (`feat:`, `fix:`, `docs:`) followed by concise imperatives. Each PR should explain the problem, the solution, and any model weight changes; attach CLI snippets (`python app.py`) or screenshots for UI touches. Link GitHub issues where applicable, and call out GPU/runtime implications in a dedicated "Deployment Notes" paragraph.

## Security & Configuration Tips
Never commit `.env`, cached downloads, or `temp_files/` contents. Regenerate secret keys with `python - <<'PY' ...` as shown in the README, and rerun `python check_config.py` after any change. When touching Demucs or ngrok configuration, document required environment variables in `docs/` and ensure permissions remain `600`.
