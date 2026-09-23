declare module "sql.js" {
  type SqlValue = number | string | Uint8Array | null;
  type Row = Record<string, SqlValue>;
  interface Statement {
    step(): boolean;
    getAsObject(): Row;
    free(): void;
  }
  interface Database {
    exec(sql: string): Array<{ columns: string[]; values: SqlValue[][] }>;
    prepare(sql: string): Statement;
    close(): void;
  }
  interface SqlStatic { Database: new (data?: Uint8Array) => Database }
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlStatic>;
}
