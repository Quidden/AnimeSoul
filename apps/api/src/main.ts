import { createApplication } from "./app.js";
import { readConfig } from "./config.js";
const config = readConfig();
const app = await createApplication(config);
await app.listen(config.API_PORT, config.API_HOST);
console.info(`AnimeSoul API listening on port ${config.API_PORT}`);
