/**
 * db.js
 *
 * Ponto único de acesso ao banco SQLite do CompanyLab.
 *
 * Responsabilidades:
 *  1. Abrir/criar o arquivo .db no lugar certo (pasta de dados do usuário
 *     quando empacotado como app instalado; ./data quando rodando em dev).
 *  2. Expor run/get/all em Promises (o driver `sqlite3` é 100% baseado
 *     em callback — ninguém deveria escrever callback aninhado em 2026).
 *  3. Rodar as migrations em database/migrations/*.sql automaticamente
 *     no boot, uma única vez cada, registrando o que já rodou numa
 *     tabela schema_migrations.
 *
 * Todo outro módulo do backend (repositories, IPC handlers, etc.) deve
 * importar ESTE arquivo em vez de abrir sua própria conexão sqlite3.
 * Múltiplas conexões concorrentes no mesmo arquivo SQLite é a receita
 * clássica pra "database is locked".
 */

const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const EventBus = require("../../core/events/EventBus");
const { EVENT_TYPES } = require("../../core/events/eventTypes");

const defaultConfig = require("../../config/default.json");

let dbInstance = null;
let readyPromise = null;

/**
 * Resolve onde o arquivo .db deve morar.
 *
 * - App empacotado/instalado: pasta de dados do usuário do Windows
 *   (ex: C:\Users\<user>\AppData\Roaming\CompanyLab), via Electron `app`.
 * - Rodando fora do Electron (testes, scripts) ou se o módulo `electron`
 *   não estiver disponível: cai para ./data na raiz do projeto.
 */
function resolveDbPath() {
  const filename = defaultConfig?.database?.filename || "companylab.db";

  try {
    // require('electron') só funciona dentro do processo principal do
    // Electron. Em contexto de teste/script puro isso lança, e caímos
    // no fallback abaixo — de propósito.
    const { app } = require("electron");
    const userDataDir = app.getPath("userData");
    return path.join(userDataDir, filename);
  } catch (_err) {
    const fallbackDir = path.join(__dirname, "..", "..", "data");
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
    return path.join(fallbackDir, filename);
  }
}

/** Abre (ou cria) o arquivo sqlite e ativa foreign keys. */
function openConnection() {
  const dbPath = resolveDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        return reject(
          new Error(`[db.js] Falha ao abrir o banco em ${dbPath}: ${err.message}`)
        );
      }
      db.run("PRAGMA foreign_keys = ON", (pragmaErr) => {
        if (pragmaErr) return reject(pragmaErr);
        console.log(`[db.js] Banco de dados aberto em: ${dbPath}`);
        resolve(db);
      });
    });
  });
}

/** Promisifica db.run (INSERT/UPDATE/DELETE/DDL). */
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbInstance.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      // `this` aqui é o Statement do sqlite3 — não dá pra usar arrow function.
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/** Promisifica db.get (uma linha). */
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbInstance.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

/** Promisifica db.all (várias linhas). */
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbInstance.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/** Roda uma sequência de statements SQL dentro de uma transação. */
function execScript(sql) {
  return new Promise((resolve, reject) => {
    dbInstance.exec(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * Garante que a tabela de controle de migrations existe.
 * Ela não faz parte de 001_initial.sql de propósito: o controle de
 * migrations tem que existir ANTES de rodar qualquer migration.
 */
async function ensureMigrationsTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/** Lê e roda, em ordem alfabética, todo .sql em database/migrations que ainda não rodou. */
async function runMigrations() {
  const migrationsDir =
    defaultConfig?.database?.migrationsDir ||
    path.join(__dirname, "..", "..", "database", "migrations");

  await ensureMigrationsTable();

  const applied = await all("SELECT filename FROM schema_migrations");
  const appliedSet = new Set(applied.map((row) => row.filename));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 001_initial.sql, 002_..., etc.

  for (const filename of files) {
    if (appliedSet.has(filename)) continue;

    const fullPath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(fullPath, "utf8");

    console.log(`[db.js] Aplicando migration: ${filename}`);
    await execScript(sql);
    await run("INSERT INTO schema_migrations (filename) VALUES (?)", [filename]);
  }

  if (files.length === 0) {
    console.warn(`[db.js] Nenhuma migration encontrada em ${migrationsDir}`);
  }
}

/**
 * Inicializa o banco: abre conexão + roda migrations pendentes.
 * Idempotente e seguro pra chamar mais de uma vez — devolve sempre
 * a mesma Promise depois da primeira chamada.
 */
function initDatabase() {
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    dbInstance = await openConnection();
    await runMigrations();
    EventBus.emitEvent(EVENT_TYPES.DATABASE_READY, { path: resolveDbPath() });
    return dbInstance;
  })();

  return readyPromise;
}

/** Retorna a conexão ativa. Lança erro claro se chamada antes do initDatabase(). */
function getDb() {
  if (!dbInstance) {
    throw new Error(
      "[db.js] getDb() chamado antes de initDatabase() terminar. " +
        "Chame `await initDatabase()` uma vez no boot do main.js primeiro."
    );
  }
  return dbInstance;
}

/** Fecha a conexão de forma limpa (usado no shutdown do app). */
function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (!dbInstance) return resolve();
    dbInstance.close((err) => {
      if (err) return reject(err);
      dbInstance = null;
      readyPromise = null;
      resolve();
    });
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