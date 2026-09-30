import Dexie, { Table } from 'dexie';
import { ProjectT } from './WenPadTypes';

export class WenPadDexie extends Dexie {
  projects!: Table<ProjectT>;

  constructor() {
    super('WenPadDB');
    this.version(1).stores({
      projects: '++id, name, layers',
    });
    this.version(2).stores({
      projects: '++id, name, owner, lastModified',
    });
  }
}

export const db = new WenPadDexie();
