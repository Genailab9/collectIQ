import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { COLLECTIQ_STATE_ENTITIES } from './collectiq-state-entities';

/**
 * TypeORM CLI datasource (PRD §17). Run from `backend/`:
 * `npm run migration:run` — requires `TYPEORM_SYNC=false` in production; migrations must be backward-compatible only.
 */
export default new DataSource({
  type: 'sqlite',
  database: join(process.cwd(), 'data', 'collectiq-state.db'),
  entities: COLLECTIQ_STATE_ENTITIES,
  migrations: [join(__dirname, '..', 'migrations', '*.{ts,js}')],
  synchronize: false,
});
