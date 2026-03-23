#!/bin/sh
# Used as SSH_ASKPASS when MILADY_VPS_PASSWORD is set (no sshpass needed).
printf '%s\n' "${DEPLOY_SSH_PASSWORD:-}"
