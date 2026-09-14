#!/usr/bin/env bash
# One-time setup: create the labels the overnight runner uses. Safe to re-run.
set -euo pipefail

gh label create agent-ready   --color 0E8A16 --description "Ready for an overnight agent" --force
gh label create agent-running --color FBCA04 --description "An overnight agent is working on it" --force
gh label create agent-pr-open --color 1D76DB --description "Agent PR passed check but could not merge" --force
gh label create agent-failed  --color D93F0B --description "Agent could not finish; needs a human" --force

echo "Labels ready."
