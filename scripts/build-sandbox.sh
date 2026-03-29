#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG="${SANDBOX_IMAGE_TAG:-sandbox-platform-sandbox:latest}"

echo "[build-sandbox] Building image: ${IMAGE_TAG}"
docker build \
  -f "${REPO_ROOT}/docker/sandbox-image/Dockerfile" \
  -t "${IMAGE_TAG}" \
  "${REPO_ROOT}"
echo "[build-sandbox] Done: ${IMAGE_TAG}"
