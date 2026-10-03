#!/usr/bin/env bash
set -euo pipefail
# A release is one authenticated manifest + one serialized host transaction.
# The former backup/up-only command could bypass both provenance and the journal.
echo '请使用 Deploy Production workflow；旧 deploy-production.sh 入口已停用。' >&2
echo '新入口验证 main CI 候选清单，再在单一主机锁内执行完整发布并保存阶段记录。' >&2
exit 64
