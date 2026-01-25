# StemTube Security Setup Guide

## 🔒 Security Configuration

This guide explains how to properly configure StemTube Web with secure credentials and environment variables.

---

## Quick Start (Production)

### 1. Create Environment File

```bash
# Copy the example file
cp .env.example .env

# Secure the file permissions
chmod 600 .env
```

### 2. Generate Secure Secret Key

```bash
# Generate a random secret key
python -c "import secrets; print(secrets.token_hex(32))"
```

Copy the output and add it to your `.env` file:

```bash
FLASK_SECRET_KEY=<paste-generated-key-here>
```

### 3. Configure ngrok (Optional)

If you have a custom ngrok URL:

```bash
NGROK_URL=your-subdomain.ngrok-free.app
```

To get a custom ngrok URL:
1. Sign up at https://ngrok.com
2. Go to https://dashboard.ngrok.com/cloud-edge/domains
3. Create or use existing domain

### 4. Start the Application

```bash
# Load environment variables and start
source .env  # Or use a tool like direnv
python app.py

# Or use the deployment script (automatically loads .env)
./utils/deployment/start_service.sh
```

---

## Environment Variables Reference

### Required (Production)

| Variable | Description | Example |
|----------|-------------|---------|
| `FLASK_SECRET_KEY` | Flask session signing key | `a1b2c3d4e5f6...` (64 chars) |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `NGROK_URL` | Custom ngrok domain | (random URL) |
| `FLASK_ENV` | Environment mode | `production` |
| `FLASK_DEBUG` | Debug mode (0/1) | `0` |
| `FLASK_HOST` | Bind address | `0.0.0.0` |
| `FLASK_PORT` | Port number | `5011` |
| `USE_GPU` | Use GPU for extraction | auto-detect |
| `DATABASE_PATH` | Database file path | `stemtubes.db` |

See `.env.example` for complete list of available variables.

---

## Security Best Practices

### 1. Secret Key Management

**❌ NEVER do this:**
```python
app.config['SECRET_KEY'] = 'my-secret-key'  # Hardcoded
```

**✅ Always do this:**
```python
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY')  # From environment
```

**Generate strong keys:**
```bash
# Method 1: Python secrets module (recommended)
python -c "import secrets; print(secrets.token_hex(32))"

# Method 2: OpenSSL
openssl rand -hex 32

# Method 3: /dev/urandom
head -c 32 /dev/urandom | base64
```

### 2. File Permissions

**Secure your .env file:**
```bash
# Only owner can read/write
chmod 600 .env

# Verify permissions
ls -la .env
# Should show: -rw------- (600)
```

### 3. Git Safety

**Verify .env is ignored:**
```bash
# Check if .env is in .gitignore
grep "^\.env$" .gitignore

# Verify it won't be committed
git status --ignored | grep .env
```

**If you accidentally committed secrets:**
```bash
# Remove from git history (DANGER: rewrites history)
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env" \
  --prune-empty --tag-name-filter cat -- --all

# Force push (coordinate with team!)
git push origin --force --all
```

### 4. Multiple Environments

Use different secrets for each environment:

```bash
# Development
.env.development
FLASK_SECRET_KEY=dev-key-only-for-local-testing

# Staging
.env.staging
FLASK_SECRET_KEY=staging-key-different-from-prod

# Production
.env.production
FLASK_SECRET_KEY=prod-key-super-secure-never-share
```

Load appropriate file:
```bash
# Development
ln -sf .env.development .env

# Production
ln -sf .env.production .env
```

### 5. Production Secret Management

**For production deployments, use a secret management service:**

- **AWS Secrets Manager**
- **HashiCorp Vault**
- **Azure Key Vault**
- **Google Cloud Secret Manager**

Example with AWS Secrets Manager:
```bash
# Store secret
aws secretsmanager create-secret \
  --name stemtube/flask-secret-key \
  --secret-string "$(python -c 'import secrets; print(secrets.token_hex(32))')"

# Retrieve in application startup script
export FLASK_SECRET_KEY=$(aws secretsmanager get-secret-value \
  --secret-id stemtube/flask-secret-key \
  --query SecretString \
  --output text)
```

### 6. Rotation Policy

**Rotate secrets regularly:**

1. Generate new secret key
2. Update environment variable
3. Restart application
4. **Note:** All users will be logged out (sessions invalidated)

**Recommended rotation schedule:**
- Development: No rotation needed
- Staging: Every 90 days
- Production: Every 30-90 days

---

## Loading Environment Variables

### Method 1: Manual Export (Development)

```bash
# Load .env manually
export $(cat .env | grep -v '^#' | xargs)

# Start application
python app.py
```

### Method 2: python-dotenv (Recommended)

**Install:**
```bash
pip install python-dotenv
```

**In app.py:**
```python
from dotenv import load_dotenv
load_dotenv()  # Loads .env automatically

# Now environment variables are available
SECRET_KEY = os.environ.get('FLASK_SECRET_KEY')
```

### Method 3: direnv (Automatic)

**Install direnv:**
```bash
# Ubuntu/Debian
sudo apt-get install direnv

# macOS
brew install direnv

# Add to shell (~/.bashrc or ~/.zshrc)
eval "$(direnv hook bash)"  # or zsh
```

**Create .envrc:**
```bash
# .envrc
dotenv .env
```

**Allow directory:**
```bash
direnv allow .
```

Now `.env` loads automatically when you `cd` into the project directory.

### Method 4: Systemd Service

**For production with systemd:**

```ini
# /etc/systemd/system/stemtube.service
[Service]
EnvironmentFile=/path/to/StemTube-dev/.env
ExecStart=/path/to/StemTube-dev/venv/bin/python app.py
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart stemtube
```

---

## Troubleshooting

### Issue: Sessions keep expiring

**Cause:** `FLASK_SECRET_KEY` not set or changes on restart

**Solution:**
1. Set persistent `FLASK_SECRET_KEY` in `.env`
2. Ensure `.env` is loaded before starting app
3. Don't use random key generation on every startup

### Issue: ngrok URL not working

**Cause:** `NGROK_URL` variable not set or invalid

**Solution:**
1. Verify URL format: `your-subdomain.ngrok-free.app`
2. Check ngrok dashboard for correct domain
3. Ensure domain is configured and active

### Issue: .env not loading

**Cause:** Environment variables not exported

**Solution:**
```bash
# Verify .env exists
ls -la .env

# Check if variables are in environment
env | grep FLASK_SECRET_KEY

# Manually load
export $(cat .env | grep -v '^#' | xargs)
```

---

## Security Checklist

Before deploying to production:

- [ ] Created `.env` from `.env.example`
- [ ] Generated secure `FLASK_SECRET_KEY` (64+ random chars)
- [ ] Set file permissions: `chmod 600 .env`
- [ ] Verified `.env` is in `.gitignore`
- [ ] Never committed secrets to git
- [ ] Using HTTPS/SSL in production
- [ ] Configured firewall rules
- [ ] Set `FLASK_DEBUG=0` in production
- [ ] Documented secret rotation schedule
- [ ] Tested application startup with .env

---

## Migration from Hardcoded Secrets

If you're migrating from the old version with hardcoded secrets:

### 1. Generate New Keys

**❌ Old (INSECURE):**
```python
app.config['SECRET_KEY'] = 'stemtubes-web-secret-key'  # Known to everyone!
```

**✅ New (SECURE):**
```bash
# Generate new key
python -c "import secrets; print(secrets.token_hex(32))"

# Add to .env
echo "FLASK_SECRET_KEY=<generated-key>" >> .env
```

### 2. Update Start Scripts

**❌ Old:**
```bash
ngrok http --url=definite-cockatoo-bold.ngrok-free.app 5011
```

**✅ New:**
```bash
# In .env
NGROK_URL=your-new-subdomain.ngrok-free.app

# In start script
ngrok http --url="$NGROK_URL" 5011
```

### 3. Restart and Test

```bash
# Stop old instance
./utils/deployment/stop_service.sh

# Load new environment
source .env

# Start with new config
./utils/deployment/start_service.sh

# Verify logs
tail -f logs/stemtube_app.log
```

---

## Additional Resources

- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [Flask Security Best Practices](https://flask.palletsprojects.com/en/2.3.x/security/)
- [12 Factor App: Config](https://12factor.net/config)

---

**Last Updated:** November 3, 2025
**Version:** 1.0
