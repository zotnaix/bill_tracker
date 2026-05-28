import { Capacitor } from '@capacitor/core'
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

const DB_NAME = 'bill_tracker'
const DB_VERSION = 1
const DB_STORAGE_KEY = 'bill-tracker.sqlite-db'
const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

const legacyStorageKeys = {
  theme: 'bill-tracker-theme',
  recurringBills: 'bill-tracker-recurring',
  savingsBills: 'bill-tracker-savings',
  paymentHistory: 'bill-tracker-history',
}

let sqlPromise
let browserDatabasePromise
let nativeBridgePromise
let nativeDatabasePromise

const isNativePlatform = () => {
  if (typeof window === 'undefined') {
    return false
  }

  return Capacitor.getPlatform() !== 'web'
}

const getSqlModule = () => {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => wasmUrl })
  }

  return sqlPromise
}

const openIndexedDb = () =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }

    const request = indexedDB.open('bill-tracker-storage', 1)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files')
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const loadLegacySnapshot = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }

  const legacySnapshot = {}
  let foundAny = false

  for (const [key, storageKey] of Object.entries(legacyStorageKeys)) {
    const storedValue = window.localStorage.getItem(storageKey)

    if (!storedValue) {
      continue
    }

    try {
      legacySnapshot[key] = JSON.parse(storedValue)
      foundAny = true
    } catch {
      // Ignore invalid legacy data and fall back to defaults.
    }
  }

  return foundAny ? legacySnapshot : null
}

const clearLegacySnapshot = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }

  for (const storageKey of Object.values(legacyStorageKeys)) {
    window.localStorage.removeItem(storageKey)
  }
}

const readStateRowsFromSqlJs = (database) => {
  const rows = database.exec('SELECT key, value FROM app_state')

  if (!rows.length) {
    return {}
  }

  return rows[0].values.reduce((accumulator, [key, value]) => {
    accumulator[key] = value
    return accumulator
  }, {})
}

const writeStateRowsToSqlJs = async (database, snapshot) => {
  const entries = Object.entries(snapshot).filter(([, value]) => value !== undefined)

  database.run('BEGIN')

  try {
    for (const [key, value] of entries) {
      database.run(
        `
          INSERT INTO app_state (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `,
        [key, JSON.stringify(value)],
      )
    }

    database.run('COMMIT')
  } catch (error) {
    database.run('ROLLBACK')
    throw error
  }

  await writeStoredDatabase(database.export())
}

const readStoredDatabase = async () => {
  const db = await openIndexedDb()

  if (!db) {
    return null
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readonly')
    const store = transaction.objectStore('files')
    const request = store.get(DB_STORAGE_KEY)

    request.onsuccess = async () => {
      const storedValue = request.result

      if (!storedValue) {
        resolve(null)
        return
      }

      if (storedValue instanceof Blob) {
        resolve(new Uint8Array(await storedValue.arrayBuffer()))
        return
      }

      if (storedValue instanceof ArrayBuffer) {
        resolve(new Uint8Array(storedValue))
        return
      }

      if (ArrayBuffer.isView(storedValue)) {
        resolve(new Uint8Array(storedValue.buffer))
        return
      }

      resolve(null)
    }

    request.onerror = () => reject(request.error)
  })
}

const writeStoredDatabase = async (serializedDatabase) => {
  const db = await openIndexedDb()

  if (!db) {
    return
  }

  await new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite')
    const store = transaction.objectStore('files')
    const request = store.put(new Blob([serializedDatabase], { type: 'application/octet-stream' }), DB_STORAGE_KEY)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

const ensureBrowserDatabase = async () => {
  if (!browserDatabasePromise) {
    browserDatabasePromise = (async () => {
      const SQL = await getSqlModule()
      const storedDatabase = await readStoredDatabase()
      const database = storedDatabase ? new SQL.Database(storedDatabase) : new SQL.Database()

      database.exec(SQLITE_SCHEMA)
      database.run('INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)', [
        'schemaVersion',
        String(DB_VERSION),
      ])

      return database
    })()
  }

  return browserDatabasePromise
}

const readStateRowsFromNative = async (connection) => {
  const result = await connection.query('SELECT key, value FROM app_state')
  const values = result?.values ?? []

  return values.reduce((accumulator, row) => {
    accumulator[row.key] = row.value
    return accumulator
  }, {})
}

const ensureNativeBridge = async () => {
  if (!nativeBridgePromise) {
    nativeBridgePromise = (async () => {
      const [{ CapacitorSQLite, SQLiteConnection }] = await Promise.all([
        import('@capacitor-community/sqlite'),
      ])

      return new SQLiteConnection(CapacitorSQLite)
    })()
  }

  return nativeBridgePromise
}

const ensureNativeDatabase = async () => {
  if (!nativeDatabasePromise) {
    nativeDatabasePromise = (async () => {
      const sqlite = await ensureNativeBridge()
      const isConnectionOpen = await sqlite.isConnection(DB_NAME, false)
      const connection = isConnectionOpen.result
        ? await sqlite.retrieveConnection(DB_NAME, false)
        : await sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION)

      await connection.open()
      await connection.execute(SQLITE_SCHEMA)
      await connection.run(
        'INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)',
        ['schemaVersion', String(DB_VERSION)],
      )

      return connection
    })()
  }

  return nativeDatabasePromise
}

const writeStateRowsToNative = async (connection, snapshot) => {
  const entries = Object.entries(snapshot).filter(([, value]) => value !== undefined)

  await connection.beginTransaction()

  try {
    for (const [key, value] of entries) {
      await connection.run(
        `
          INSERT INTO app_state (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `,
        [key, JSON.stringify(value)],
      )
    }

    await connection.commitTransaction()
  } catch (error) {
    await connection.rollbackTransaction()
    throw error
  }
}

const loadSnapshot = async (defaults) => {
  const snapshot = { ...defaults }

  if (isNativePlatform()) {
    const connection = await ensureNativeDatabase()
    const rows = await readStateRowsFromNative(connection)

    for (const [key, rawValue] of Object.entries(rows)) {
      try {
        snapshot[key] = JSON.parse(rawValue)
      } catch {
        snapshot[key] = defaults[key]
      }
    }

    return snapshot
  }

  const database = await ensureBrowserDatabase()
  const rows = readStateRowsFromSqlJs(database)

  for (const [key, rawValue] of Object.entries(rows)) {
    try {
      snapshot[key] = JSON.parse(rawValue)
    } catch {
      snapshot[key] = defaults[key]
    }
  }

  if (Object.keys(rows).length === 0) {
    const legacySnapshot = loadLegacySnapshot()

    if (legacySnapshot) {
      for (const [key, value] of Object.entries(legacySnapshot)) {
        snapshot[key] = value
      }

      await writeStateRowsToSqlJs(database, snapshot)
      clearLegacySnapshot()
    }
  }

  return snapshot
}

const saveSnapshot = async (snapshot) => {
  if (isNativePlatform()) {
    const connection = await ensureNativeDatabase()
    await writeStateRowsToNative(connection, snapshot)
    return
  }

  const database = await ensureBrowserDatabase()
  await writeStateRowsToSqlJs(database, snapshot)
}

export const loadAppSnapshot = async (defaults) => loadSnapshot(defaults)

export const saveAppSnapshot = async (snapshot) => saveSnapshot(snapshot)

export const getDatabaseInfo = async () => {
  if (isNativePlatform()) {
    const connection = await ensureNativeDatabase()

    let url = null
    try {
      // some plugin versions expose getUrl on the connection
      // fall back to sqlite.getNCDatabasePath if needed
      if (typeof connection.getUrl === 'function') {
        const res = await connection.getUrl()
        url = res?.url ?? res
      } else if (typeof connection.getNCDatabasePath === 'function') {
        const res = await connection.getNCDatabasePath('', DB_NAME)
        url = res?.path ?? res
      }
    } catch (e) {
      url = null
    }

    const tablesRaw = await connection.query("SELECT name FROM sqlite_master WHERE type='table'")
    const tables = (tablesRaw?.values ?? []).map((r) => r.name ?? r[0])

    return { platform: 'native', url, tables }
  }

  const database = await ensureBrowserDatabase()
  const rows = database.exec("SELECT name FROM sqlite_master WHERE type='table'")
  const tables = rows.length ? rows[0].values.map((r) => r[0]) : []

  return { platform: 'web', tables }
}