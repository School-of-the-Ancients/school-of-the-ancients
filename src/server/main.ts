import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSchoolRepository } from './repository.ts';
import { SchoolService } from './school-service.ts';
import { providerFromEnvironment } from './providers.ts';
import { createSchoolServer } from './http.ts';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const port = Number(process.env.SCHOOL_PORT ?? 8792);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('SCHOOL_PORT must be an integer from 1024 to 65535.');
const provider = providerFromEnvironment();
const repository = new FileSchoolRepository(process.env.SCHOOL_DATA_DIR ?? resolve(root, '.school-data'));
let service: SchoolService;
try { service = new SchoolService(repository, provider); } catch (error) { repository.close(); throw error; }
const server = createSchoolServer({ service, publicDirectory: resolve(root, 'public') });
let stopping = false;
function stop() { if (stopping) return; stopping = true; service.close(); server.close(); server.closeIdleConnections(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
server.on('error', (error) => { service.close(); console.error(error instanceof Error ? error.message : 'School could not start.'); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => { console.log(`School of the Ancients: http://127.0.0.1:${port}/`); console.log(service.provider.status().label); });
