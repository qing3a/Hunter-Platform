"""Add /view/ location block to nginx vhost config (proxy to Node API)."""
import re

CONFIG = '/www/server/panel/vhost/nginx/html_qing3.top.conf'

with open(CONFIG, 'r') as f:
    content = f.read()

# Remove any prior /view/ block (in case re-running)
content = re.sub(
    r'    # View pages[\s\S]*?proxy_set_header Host[^\n]*\n[ \t]*\}\n',
    '',
    content,
)

marker = '    include /www/server/panel/vhost/nginx/well-known/hunter-platform-api.conf;'
idx = content.find(marker)
if idx == -1:
    print('ERROR: marker not found')
    exit(1)

DOLLAR = chr(36)
block = (
    '\n\n'
    '    # View pages (one-time-use resume links) - proxy to Node API\n'
    '    location ^~ /view/ {\n'
    '        proxy_pass http://127.0.0.1:3000;\n'
    '        proxy_http_version 1.1;\n'
    f'        proxy_set_header Host {DOLLAR}host;\n'
    '    }\n'
)
content = content[:idx + len(marker)] + block + content[idx + len(marker):]

with open(CONFIG, 'w') as f:
    f.write(content)
print('OK: /view/ block inserted')
