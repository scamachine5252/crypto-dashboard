#!/usr/bin/env bash
# Hetzner CCX13 — one-time server setup script
# Run as root on a fresh Ubuntu 24.04 LTS instance
# Usage: bash server-setup.sh <your-domain.com>

set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 <domain>"
  exit 1
fi

echo "==> Installing Node.js 20 LTS"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "==> Installing Redis"
apt-get install -y redis-server
systemctl enable redis-server --now
# Bind Redis to localhost only (security)
sed -i 's/^bind .*/bind 127.0.0.1/' /etc/redis/redis.conf
systemctl restart redis-server
systemctl is-active --quiet redis-server || { echo "ERROR: Redis failed to start after config change"; exit 1; }

echo "==> Installing PM2"
npm install -g pm2

echo "==> Installing nginx + Certbot"
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Creating deploy user"
id -u deploy &>/dev/null || useradd -m -s /bin/bash deploy
mkdir -p /home/deploy/.ssh
# Copy authorized_keys from root if available
[[ -f /root/.ssh/authorized_keys ]] && cp /root/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys 2>/dev/null || true

echo "==> Creating app directory"
mkdir -p /app
chown deploy:deploy /app

echo "==> Writing nginx config for $DOMAIN"
cat > /etc/nginx/sites-available/crypto-dashboard <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/crypto-dashboard /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Obtaining SSL certificate for $DOMAIN"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@"$DOMAIN" --redirect

echo "==> Allowing deploy user to reload PM2 without password"
echo "deploy ALL=(ALL) NOPASSWD: /usr/bin/pm2, /usr/local/bin/pm2" >> /etc/sudoers.d/deploy-pm2

echo ""
echo "==> Done! Next steps:"
echo "  1. Add HETZNER_IP=$( hostname -I | awk '{print $1}') to GitHub repository secrets"
echo "  2. Add SSH_PRIVATE_KEY (deploy user's private key) to GitHub repository secrets"
echo "  3. Clone the repo: su - deploy && git clone <repo-url> /app/crypto-dashboard"
echo "  4. Create /app/crypto-dashboard/.env.local with all required env vars"
echo "  5. cd /app/crypto-dashboard && npm ci && npm run build && pm2 start ecosystem.config.js"
echo "  6. pm2 save && pm2 startup"
