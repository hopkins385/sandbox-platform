#!/usr/bin/env node
import { logger } from "@sandbox/logger";

// Config import runs env validation and exits early on fatal misconfiguration
import "./config.js";

import { startServer } from "./server.js";

logger.info(`[agent-worker] Starting agent worker...`);
startServer();
