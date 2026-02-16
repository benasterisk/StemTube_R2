# Contributing to StemTube

Thank you for your interest in contributing to StemTube! This document provides guidelines for contributing to the project.

---

## Code of Conduct

- Be respectful and constructive in all interactions
- Welcome newcomers and help them get started
- Focus on what's best for the project and community

---

## Before You Start

1. **Check existing issues** - Someone may already be working on it
2. **Open an issue first** - Discuss major changes before implementing
3. **Read the documentation** - Familiarize yourself with the architecture

**Key Documentation:**
- [Architecture Guide](docs/developer-guides/ARCHITECTURE.md) - System design
- [API Reference](docs/developer-guides/API-REFERENCE.md) - Endpoint documentation
- [Frontend Guide](docs/developer-guides/FRONTEND-GUIDE.md) - JavaScript modules
- [Backend Guide](docs/developer-guides/BACKEND-GUIDE.md) - Python modules

---

## Development Setup

```bash
# 1. Fork and clone
git clone https://github.com/YOUR-USERNAME/StemTube_R2.git
cd StemTube_R2

# 2. Set up development environment
python3.12 setup_dependencies.py

# 3. Create .env file
cp .env.example .env
python3 -c "import secrets; print('FLASK_SECRET_KEY=' + secrets.token_hex(32))" >> .env

# 4. Run in development mode
source venv/bin/activate
python app.py
```

---

## Code Style Guidelines

### Python

**Follow PEP 8** with these specifics:

```python
# Use 4 spaces for indentation (not tabs)
# Maximum line length: 100 characters (soft limit, 120 hard limit)

# Imports: stdlib → third-party → local
import os
import sys

from flask import Flask, request
import torch

from core.downloads_db import find_global_download
from core.config import DOWNLOADS_DIR

# Use docstrings for all functions
def process_audio(file_path: str, model: str = "htdemucs") -> dict:
    """
    Process audio file with stem extraction.

    Args:
        file_path: Path to audio file
        model: Demucs model name (default: htdemucs)

    Returns:
        dict: Extraction results with stem paths
    """
    pass

# Use type hints where practical
# Use descriptive variable names (no single letters except i, j in loops)
# Prefer explicit over implicit
```

### JavaScript

**Modern ES6+ conventions:**

```javascript
// Use const/let (never var)
const API_BASE = '/api';
let currentTime = 0;

// Use arrow functions for callbacks
items.forEach(item => {
    processItem(item);
});

// Use template literals
const message = `Processing ${fileName} with ${model}`;

// Use async/await (not .then() chains)
async function loadData() {
    const response = await fetch('/api/downloads');
    const data = await response.json();
    return data;
}

// Class-based modules (not prototypes)
class MixerModule {
    constructor(mixer) {
        this.mixer = mixer;
        this.init();
    }
}
```

### Comments

**CRITICAL**: All comments must be in **English only**.

```python
# GOOD: English technical comment
# Load audio with soundfile for BPM analysis

# BAD: French comment (must be translated)
# Charger l'audio with soundfile pour l'analyse du BPM
```

**Comment Guidelines:**
- Use comments to explain **why**, not **what**
- Document complex algorithms and business logic
- Add docstrings to all public functions/classes
- Keep comments concise and up-to-date

---

## Git Workflow

### Branch Naming

```bash
feature/add-new-model      # New features
fix/extraction-crash       # Bug fixes
docs/api-reference         # Documentation
refactor/cleanup-db        # Code improvements
test/add-unit-tests        # Testing additions
```

### Commit Messages

Follow conventional commits format:

```bash
feat: add support for HTDemucs 6-stem model
fix: resolve GPU memory leak in extraction
docs: update API reference with new endpoints
refactor: simplify download deduplication logic
test: add unit tests for chord detection
chore: update dependencies to latest versions
```

**Guidelines:**
- Use imperative mood ("add" not "added")
- Keep first line under 72 characters
- Add detailed description if needed (separated by blank line)
- Reference issues: `fixes #123` or `closes #456`

### Pull Request Process

1. **Create feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make focused commits**
   - One logical change per commit
   - Test before committing
   - Keep commits atomic and reversible

3. **Test thoroughly**
   ```bash
   # Test on CPU
   python app.py

   # Test on GPU (if available)
   python app.py  # Should auto-detect CUDA

   # Run any relevant test scripts
   python utils/testing/test_your_feature.py
   ```

4. **Update documentation**
   - Add/update docstrings
   - Update relevant .md files
   - Include examples if needed

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

   **PR Description Template:**
   ```markdown
   ## Changes
   - Brief description of what changed

   ## Motivation
   - Why this change is needed

   ## Testing
   - How you tested the changes
   - [ ] Tested on CPU
   - [ ] Tested on GPU
   - [ ] Updated documentation

   ## Related Issues
   Fixes #123
   ```

6. **Address review feedback**
   - Respond to all comments
   - Make requested changes
   - Push updates to same branch

---

## Testing Guidelines

### Manual Testing

**Always test:**
1. Download workflow (YouTube + file upload)
2. Extraction with different models
3. Chord detection and structure analysis
4. Mixer functionality (play/pause, stems, pitch/tempo)
5. Mobile interface (if UI changes)

**Test on:**
- Linux (primary platform)
- CPU mode (baseline)
- GPU mode (if available)

### Automated Testing

```bash
# Database operations
python utils/database/debug_db.py

# Audio analysis
python utils/testing/test_madmom_tempo_key.py <audio_file>
python utils/testing/test_lyrics_cpu.py <audio_file>

# Extraction
python utils/testing/test_extraction.py
```

---

## What to Contribute

### High-Priority Areas

**Features:**
- New Demucs models support
- Additional audio analysis features
- Performance optimizations
- Mobile interface improvements

**Bug Fixes:**
- GPU compatibility issues
- Database race conditions
- WebSocket stability
- Mobile audio playback

**Documentation:**
- Tutorial videos
- Use case examples
- API usage guides
- Troubleshooting tips

**Testing:**
- Unit tests for core modules
- Integration tests
- Performance benchmarks

### Please Avoid

- Unnecessary dependencies
- Breaking API changes without discussion
- Code without documentation
- Reformatting existing code (style-only PRs)
- French or non-English comments

---

## Code Review Criteria

Your PR will be reviewed for:

✅ **Functionality**
- Does it work as intended?
- Are edge cases handled?
- Is error handling robust?

✅ **Code Quality**
- Follows style guidelines?
- Well-structured and readable?
- Properly documented?

✅ **Testing**
- Manually tested?
- No regressions introduced?
- Works on CPU and GPU?

✅ **Documentation**
- Docstrings added/updated?
- README or guides updated?
- API changes documented?

✅ **Performance**
- No unnecessary overhead?
- Database queries optimized?
- Memory leaks addressed?

---

## Getting Help

**Questions?**
- Open a GitHub Discussion
- Check existing documentation
- Ask in pull request comments

**Found a Bug?**
- Search existing issues first
- Provide reproduction steps
- Include system information (OS, Python version, GPU)
- Attach relevant logs

**Need Guidance?**
- Review the [Architecture Guide](docs/developer-guides/ARCHITECTURE.md)
- Check [API Reference](docs/developer-guides/API-REFERENCE.md)
- Look at recent commits for examples

---

## Recognition

Contributors will be:
- Listed in project acknowledgments
- Credited in CHANGELOG.md
- Thanked in release notes

---

**Thank you for contributing to StemTube!** 🎉

Every contribution, no matter how small, helps make this project better for everyone.
