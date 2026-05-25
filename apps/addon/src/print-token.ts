import { loadConfig } from './env.js';
import { createInstallToken } from './token.js';

const config = loadConfig();
process.stdout.write(`${createInstallToken(config.installTokenSecret)}\n`);
