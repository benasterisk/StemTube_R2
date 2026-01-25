# SSH Configuration for Migration

## Goal

Make it easy to connect to your old production machine by setting up an SSH alias.

## Method 1: ~/.ssh/config (Recommended)

This lets you connect with `ssh old-prod` instead of typing the full address.

### 1. Create/Edit the SSH config file

```bash
nano ~/.ssh/config
```

### 2. Add this configuration

```
# Old StemTube production machine
Host old-prod
    HostName 192.168.1.100         # Replace with the real IP or hostname
    User root                       # Replace with your username
    Port 22                         # Change if SSH is not on port 22
    IdentityFile ~/.ssh/id_rsa      # Path to your private key (optional)
    ServerAliveInterval 60          # Keep the connection alive
    ServerAliveCountMax 3
```

### 3. Save and fix permissions

```bash
# Save the file (Ctrl+X, then Y, then Enter in nano)

# Fix permissions (important)
chmod 600 ~/.ssh/config
```

### 4. Test the connection

```bash
# Connect using the alias
ssh old-prod

# If it works, you can now use:
# - ssh old-prod
# - rsync -avh old-prod:/path/to/file ./
# - scp old-prod:/path/to/file ./
```

### 5. Update the migration script

Once the alias is set, edit `migrate_from_old_prod.sh`:

```bash
# Change this line:
OLD_PROD_HOST="user@old-prod-server.com"

# To:
OLD_PROD_HOST="old-prod"
```

That is it.

---

## Method 2: SSH Keys (if not configured yet)

If you cannot connect with a key yet, follow these steps:

### 1. Generate a key pair (if you do not have one)

```bash
# Generate a new RSA key
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"

# Press Enter to accept default location
# (Optional) Enter a passphrase for extra security
```

### 2. Copy your public key to the old machine

```bash
# Automatic method (recommended)
ssh-copy-id user@old-prod-server.com

# OR manual method
cat ~/.ssh/id_rsa.pub | ssh user@old-prod-server.com "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

### 3. Test passwordless login

```bash
ssh user@old-prod-server.com
# Should connect without asking for a password
```

---

## Method 3: Password login (less secure)

If you prefer a password, you can use `sshpass`:

### Install

```bash
# Ubuntu/Debian
sudo apt-get install sshpass

# macOS
brew install hudochenkov/sshpass/sshpass
```

### Use in the script

**Warning:** Storing passwords in plain text is risky.

```bash
# Create a protected password file
echo "YourPassword" > ~/.ssh/old_prod_password
chmod 600 ~/.ssh/old_prod_password

# Use in rsync commands
sshpass -f ~/.ssh/old_prod_password rsync -avh \
  user@old-prod:/path/to/file ./
```

---

## Configuration Examples by Environment

### Example 1: Local server on the same network

```
Host old-prod
    HostName 192.168.1.100
    User stemtube
    Port 22
```

### Example 2: Remote server with domain

```
Host old-prod
    HostName stemtube-prod.mydomain.com
    User ubuntu
    Port 22
    IdentityFile ~/.ssh/id_rsa
```

### Example 3: Server behind a jump host (bastion)

```
Host old-prod
    HostName 10.0.1.50
    User root
    Port 22
    ProxyJump bastion-server.com
```

### Example 4: Server with custom SSH port

```
Host old-prod
    HostName prod.example.com
    User admin
    Port 2222                    # SSH on a different port
    IdentityFile ~/.ssh/prod_key
```

---

## Troubleshooting

### Error: "Permission denied (publickey)"

**Cause:** Your public key is not authorized on the server.

**Fix:**
```bash
# Verify your key is loaded
ssh-add -l

# Add your key if needed
ssh-add ~/.ssh/id_rsa

# Re-copy the key to the server
ssh-copy-id -i ~/.ssh/id_rsa.pub user@old-prod-server.com
```

### Error: "Connection timeout"

**Cause:** The server is unreachable or a firewall is blocking.

**Fix:**
```bash
# Test network connectivity
ping old-prod-server.com

# Test if SSH port is open
telnet old-prod-server.com 22
# OR
nc -zv old-prod-server.com 22

# If timeout, check:
# 1. The server is up
# 2. Firewall allows port 22
# 3. IP/hostname is correct
```

### Error: "Host key verification failed"

**Cause:** The server SSH signature changed.

**Fix:**
```bash
# Remove the old signature
ssh-keygen -R old-prod-server.com

# OR edit manually
nano ~/.ssh/known_hosts
# Delete the matching line

# Reconnect and accept the new signature
ssh user@old-prod-server.com
```

### Error: "Bad owner or permissions on ~/.ssh/config"

**Cause:** Config file permissions are too open.

**Fix:**
```bash
chmod 600 ~/.ssh/config
chmod 700 ~/.ssh
```

---

## Useful Commands

### Test SSH connection with verbose output

```bash
ssh -v user@old-prod-server.com
# Shows full connection details
```

### List available SSH keys

```bash
ls -la ~/.ssh/
# You should see: id_rsa (private) and id_rsa.pub (public)
```

### Check SSH configuration

```bash
ssh -G old-prod
# Shows the full config that will be used
```

### Copy a file quickly

```bash
# With scp
scp old-prod:/path/source /path/destination

# With rsync (better for large files)
rsync -avh --progress old-prod:/path/source /path/destination
```

---

## Pre-Migration Checklist

- [ ] I can connect to the old machine: `ssh old-prod`
- [ ] I configured the SSH alias in `~/.ssh/config`
- [ ] I tested `rsync` with a small file
- [ ] I verified available disk space on the new machine
- [ ] I updated `OLD_PROD_HOST` in `migrate_from_old_prod.sh`
- [ ] I verified the app is stopped
- [ ] I backed up current data (just in case)

Once all items are done, run:
```bash
./migrate_from_old_prod.sh
```

---

**Pro tip:** After migration is validated, consider disabling SSH access to the old machine for security.

```bash
# On the old machine
sudo systemctl stop ssh
sudo systemctl disable ssh
```
