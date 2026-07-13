#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "启动智路哨兵车主安全平台 V2.0：http://localhost:8787"
node server.js
