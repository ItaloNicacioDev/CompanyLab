/**
 * db.js
 *
 * Ponto único de acesso ao banco SQLite do CompanyLab.
 *
 * Responsabilidades:
 *  1. Abrir/criar o arquivo .db no lugar certo (pasta de dados do usuário
 *     quando empacotado como app instalado; ./data quando rodando em dev).
 *  2. Expor run/get/all em Promises. Motor: `better-sqlite3`, que é
 *     síncrono por natureza — aqui embrulhamos cada chamada numa Promise
 *     resolvida/rejeitada na hora, só pra manter a MESMA assinatura
 *     assíncrona que o resto do backend (repositories, IPC handlers)
 *     já espera. Ninguém fora deste arquivo precisa saber que o driver
 *     trocou.
 *  3. Rodar as migrations em database/migrations/*.sql automaticamente
 *     no boot, uma única vez cada, registrando o que já rodou numa
 *     tabela schema_migrations.
 *
 * Todo outro módulo do backend (repositories, IPC handlers, etc.) deve
 * importar ESTE arquivo em vez de abrir sua própria conexão sqlite3.
 * Múltiplas conexões concorrentes no mesmo arquivo SQLite é a receita
 * clássica pra "database is locked".
 *
 * Nota de migração (sqlite3 -> better-sqlite3):
 * O driver antigo (`sqlite3`) foi trocado por `better-sqlite3` porque
 * o primeiro não publica binários pré-compilados em dia com versões
 * recentes de Node/Electron, obrigando a compilar na máquina do usuário
 * (exige Visual Studio Build Tools no Windows). `better-sqlite3` tem
 * prebuilds mais atualizados e é mais rápido por ser síncrono. A API
 * pública exportada aqui (run/get/all/execScript/initDatabase/getDb/
 * closeDatabase/resolveDbPath) NÃO mudou — só o que acontece por dentro.
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
    try {
      const db = new Database(dbPath);
      db.pragma("foreign_keys = ON");
      console.log(`[db.js] Banco de dados aberto em: ${dbPath}`);
      resolve(db);
    } catch (err) {
      reject(
        new Error(`[db.js] Falha ao abrir o banco em ${dbPath}: ${err.message}`)
      );
    }
  });
}

/**
 * Promisifica um INSERT/UPDATE/DELETE/DDL.
 * Mantém o formato antigo `{ lastID, changes }` (o driver antigo usava
 * `lastID`; better-sqlite3 chama isso de `lastInsertRowid` — traduzimos
 * aqui pra ninguém que já lê `result.lastID` por aí precisar mudar).
 */
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const info = dbInstance.prepare(sql).run(params);
      resolve({ lastID: info.lastInsertRowid, changes: info.changes });
    } catch (err) {
      reject(err);
    }
  });
}

/** Promisifica uma consulta de uma linha só. */
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const row = dbInstance.prepare(sql).get(params);
      // sqlite3 antigo resolvia `undefined` quando não achava linha;
      // better-sqlite3 já faz o mesmo, então o contrato se mantém.
      resolve(row);
    } catch (err) {
      reject(err);
    }
  });
}

/** Promisifica uma consulta de várias linhas. */
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const rows = dbInstance.prepare(sql).all(params);
      resolve(rows);
    } catch (err) {
      reject(err);
    }
  });
}

/** Roda uma sequência de statements SQL (usado pelas migrations). */
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
    try {
      dbInstance.close();
      dbInstance = null;
      readyPromise = null;
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