// SQLite Storage Adapter
// Native platform storage using Capacitor SQLite plugin

import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';
import { IStorageAdapter } from './IStorageAdapter';

const DB_NAME = 'flowmate_storage';
const TABLE_NAME = 'key_value_store';

export class SqliteAdapter implements IStorageAdapter {
    private sqlite: SQLiteConnection;
    private db: SQLiteDBConnection | null = null;
    private initialized = false;

    constructor() {
        this.sqlite = new SQLiteConnection(CapacitorSQLite);
    }

    private async init(): Promise<void> {
        if (this.initialized) return;

        try {
            // Check connection consistency (Android requirement)
            const retCC = await this.sqlite.checkConnectionsConsistency();
            const isConn = (await this.sqlite.isConnection(DB_NAME, false)).result;

            if (retCC.result && isConn) {
                this.db = await this.sqlite.retrieveConnection(DB_NAME, false);
            } else {
                this.db = await this.sqlite.createConnection(
                    DB_NAME,
                    false,
                    'no-encryption',
                    1,
                    false
                );
            }

            await this.db.open();

            // Create table if not exists
            const createTableQuery = `
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
      `;
            await this.db.execute(createTableQuery);

            this.initialized = true;
            console.log('[SqliteAdapter] Initialized successfully');
        } catch (error) {
            console.error('[SqliteAdapter] Initialization failed:', error);
            throw error;
        }
    }

    async getItem(key: string): Promise<string | null> {
        await this.init();
        if (!this.db) return null;

        try {
            const result = await this.db.query(
                `SELECT value FROM ${TABLE_NAME} WHERE key = ?`,
                [key]
            );
            if (result.values && result.values.length > 0) {
                return result.values[0].value;
            }
            return null;
        } catch (error) {
            console.error('[SqliteAdapter] getItem failed:', error);
            return null;
        }
    }

    async setItem(key: string, value: string): Promise<void> {
        await this.init();
        if (!this.db) return;

        try {
            await this.db.run(
                `INSERT OR REPLACE INTO ${TABLE_NAME} (key, value, updated_at) VALUES (?, ?, strftime('%s', 'now'))`,
                [key, value]
            );
        } catch (error) {
            console.error('[SqliteAdapter] setItem failed:', error);
        }
    }

    async removeItem(key: string): Promise<void> {
        await this.init();
        if (!this.db) return;

        try {
            await this.db.run(
                `DELETE FROM ${TABLE_NAME} WHERE key = ?`,
                [key]
            );
        } catch (error) {
            console.error('[SqliteAdapter] removeItem failed:', error);
        }
    }

    async clear(): Promise<void> {
        await this.init();
        if (!this.db) return;

        try {
            await this.db.run(`DELETE FROM ${TABLE_NAME}`);
        } catch (error) {
            console.error('[SqliteAdapter] clear failed:', error);
        }
    }

    async isReady(): Promise<boolean> {
        try {
            await this.init();
            return this.initialized && this.db !== null;
        } catch {
            return false;
        }
    }
}
