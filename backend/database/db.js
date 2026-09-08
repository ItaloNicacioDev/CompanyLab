/**
 * db.js
 *
 * Ponto único de acesso ao banco SQLite do CompanyLab.
 *
 * Driver: better-sqlite3
 *
 * A API pública continua compatível com o backend existente:
 *   initDatabase()
 *   getDb()
 *   closeDatabase()
 *   run()
 *   get()
 *   all()
 *   execScript()
 *   resolveDbPath()
 */

const path = require("path");
const fs = require("fs");

const Database = require("better-sqlite3");

const EventBus = require("../../core/events/EventBus");
const { EVENT_TYPES } = require("../../core/events/eventTypes");
const defaultConfig = require("../../config/default.json");

let dbInstance = null;
let readyPromise = null;

/**
 * Resolve o caminho do banco.
 *
 * Electron:
 *   %APPDATA%\CompanyLab\companylab.db
 *
 * Fora do Electron:
 *   ./data/companylab.db
 */
function resolveDbPath() {
  const filename =
    defaultConfig?.database?.filename || "companylab.db";

  try {
    const { app } = require("electron");

    if (app && app.isReady()) {
      const userDataDir = app.getPath("userData");
      return path.join(userDataDir, filename);
    }
  } catch (err) {
    // Fallback para execução fora do Electron.
  }

  const fallbackDir = path.join(
    __dirname,
    "..",
    "..",
    "data"
  );

  if (!fs.existsSync(fallbackDir)) {
    fs.mkdirSync(fallbackDir, {
      recursive: true,
    });
  }

  return path.join(fallbackDir, filename);
}

/**
 * Abre o banco SQLite.
 *
 * better-sqlite3 é síncrono, portanto não existe motivo
 * para embrulhar new Database() em Promise.
 */
function openConnection() {
  const dbPath = resolveDbPath();

  console.log("[db.js] DB PATH:", dbPath);

  const dir = path.dirname(dbPath);

  console.log("[db.js] DB DIR:", dir);

  try {
    if (!fs.existsSync(dir)) {
      console.log("[db.js] Criando diretório:", dir);

      fs.mkdirSync(dir, {
        recursive: true,
      });
    }

    console.log(
      "[db.js] Diretório existe:",
      fs.existsSync(dir)
    );

    console.log("[db.js] Criando conexão better-sqlite3...");

    const db = new Database(dbPath);

    console.log("[db.js] Database criado com sucesso.");

    console.log("[db.js] Ativando foreign_keys...");

    db.pragma("foreign_keys = ON");

    console.log("[db.js] foreign_keys ativado.");

    console.log(
      `[db.js] Banco de dados aberto em: ${dbPath}`
    );

    return db;
  } catch (err) {
    console.error("[db.js] ERRO AO ABRIR SQLITE:");
    console.error(err);

    throw new Error(
      `[db.js] Falha ao abrir o banco em ${dbPath}: ${err.message}`
    );
  }
}

/**
 * INSERT / UPDATE / DELETE / DDL
 *
 * Mantém compatibilidade com sqlite3:
 * {
 *   lastID,
 *   changes
 * }
 */
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const info = dbInstance
        .prepare(sql)
        .run(params);

      resolve({
        lastID: info.lastInsertRowid,
        changes: info.changes,
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Consulta uma única linha.
 */
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const row = dbInstance
        .prepare(sql)
        .get(params);

      resolve(row);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Consulta várias linhas.
 */
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const rows = dbInstance
        .prepare(sql)
        .all(params);

      resolve(rows);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Executa múltiplos statements SQL.
 */
function execScript(sql) {
  return new Promise((resolve, reject) => {
    try {
      dbInstance.exec(sql);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Cria a tabela de controle das migrations.
 */
async function ensureMigrationsTable() {
  console.log(
    "[db.js] Criando/verificando schema_migrations..."
  );

  await run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log(
    "[db.js] schema_migrations OK"
  );
}

/**
 * Executa migrations pendentes.
 */
async function runMigrations() {
  const migrationsDir =
    defaultConfig?.database?.migrationsDir ||
    path.join(
      __dirname,
      "..",
      "..",
      "database",
      "migrations"
    );

  console.log(
    "[db.js] Diretório de migrations:",
    migrationsDir
  );

  if (!fs.existsSync(migrationsDir)) {
    console.warn(
      "[db.js] Diretório de migrations não existe:",
      migrationsDir
    );

    return;
  }

  await ensureMigrationsTable();

  console.log(
    "[db.js] Lendo migrations aplicadas..."
  );

  const applied = await all(
    "SELECT filename FROM schema_migrations"
  );

  const appliedSet = new Set(
    applied.map((row) => row.filename)
  );

  console.log(
    "[db.js] Migrations já aplicadas:",
    applied.length
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  console.log(
    "[db.js] Migrations encontradas:",
    files.length
  );

  for (const filename of files) {
    if (appliedSet.has(filename)) {
      console.log(
        `[db.js] Migration já aplicada: ${filename}`
      );

      continue;
    }

    const fullPath = path.join(
      migrationsDir,
      filename
    );

    console.log(
      `[db.js] Lendo migration: ${filename}`
    );

    const sql = fs.readFileSync(
      fullPath,
      "utf8"
    );

    console.log(
      `[db.js] Aplicando migration: ${filename}`
    );

    await execScript(sql);

    await run(
      "INSERT INTO schema_migrations (filename) VALUES (?)",
      [filename]
    );

    console.log(
      `[db.js] Migration concluída: ${filename}`
    );
  }

  console.log(
    "[db.js] Todas as migrations concluídas."
  );
}

/**
 * Inicializa o banco.
 */
function initDatabase() {
  if (readyPromise) {
    return readyPromise;
  }

  readyPromise = (async () => {
    console.log(
      "[db.js] ===== INIT DATABASE ====="
    );

    console.log(
      "[db.js] 1. Abrindo conexão..."
    );

    dbInstance = openConnection();

    console.log(
      "[db.js] 2. Conexão aberta."
    );

    console.log(
      "[db.js] 3. Executando migrations..."
    );

    await runMigrations();

    console.log(
      "[db.js] 4. Migrations concluídas."
    );

    const dbPath = resolveDbPath();

    console.log(
      "[db.js] 5. Emitindo DATABASE_READY..."
    );

    EventBus.emitEvent(
      EVENT_TYPES.DATABASE_READY,
      {
        path: dbPath,
      }
    );

    console.log(
      "[db.js] 6. DATABASE READY."
    );

    console.log(
      "[db.js] ===== DATABASE PRONTO ====="
    );

    return dbInstance;
  })();

  return readyPromise;
}

/**
 * Retorna a conexão ativa.
 */
function getDb() {
  if (!dbInstance) {
    throw new Error(
      "[db.js] getDb() chamado antes de initDatabase() terminar."
    );
  }

  return dbInstance;
}

/**
 * Fecha o banco.
 */
function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (!dbInstance) {
      resolve();
      return;
    }

    try {
      console.log(
        "[db.js] Fechando banco..."
      );

      dbInstance.close();

      dbInstance = null;
      readyPromise = null;

      console.log(
        "[db.js] Banco fechado."
      );

      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  initDatabase,
  getDb,
  closeDatabase,
  run,
  get,
  all,
  execScript,
  resolveDbPath,
};