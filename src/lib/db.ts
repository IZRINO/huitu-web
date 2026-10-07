import type { PrintRecord } from '../types'
import { dataUrlToBlob } from './format'

const NAME = 'huitu-prints'
const STORE = 'prints'
const IMAGES = 'images'
const MAX = 80
const MAX_BYTES = 256 * 1024 * 1024
let connection: Promise<IDBDatabase> | undefined

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

async function thumbnail(blob: Blob): Promise<string> {
  const image = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, 160 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法生成历史缩略图')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/webp', 0.75)
  } finally { image.close() }
}

async function migrateLegacy(db: IDBDatabase): Promise<void> {
  // Migrate one original at a time; keep each original until its replacement commits.
  const keys = await requestValue(db.transaction(STORE).objectStore(STORE).getAllKeys())
  for (const key of keys) {
    const legacy = await requestValue(db.transaction(STORE).objectStore(STORE).get(key)) as PrintRecord & { dataUrl?: string }
    if (!legacy?.dataUrl) continue
    let blob: Blob | undefined
    let preview: string
    try {
      blob = dataUrlToBlob(legacy.dataUrl)
      preview = await thumbnail(blob)
    } catch {
      const canvas = document.createElement('canvas')
      canvas.width = 1; canvas.height = 1
      preview = canvas.toDataURL('image/png')
    }
    const record = { ...legacy, thumbnail: preview, bytes: blob?.size ?? new Blob([legacy.dataUrl]).size }
    delete record.dataUrl
    const tx = db.transaction([STORE, IMAGES], 'readwrite')
    const current = tx.objectStore(STORE).get(key)
    current.onsuccess = () => {
      if (!current.result?.dataUrl) return
      tx.objectStore(STORE).put(record)
      // Keep undecodable originals outside the metadata list so they remain removable.
      tx.objectStore(IMAGES).put(blob ? { id: record.id, blob } : { id: record.id, dataUrl: legacy.dataUrl })
    }
    await txDone(tx)
  }
}

function openDb(): Promise<IDBDatabase> {
  if (connection) return connection
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false
    const req = indexedDB.open(NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
      if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES, { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      if (blocked) { db.close(); return }
      db.onversionchange = () => { db.close(); connection = undefined }
      migrateLegacy(db).then(() => resolve(db), error => { db.close(); connection = undefined; reject(error) })
    }
    req.onerror = () => { connection = undefined; reject(req.error) }
    req.onblocked = () => { blocked = true; connection = undefined; reject(new Error('请关闭旧版本页面后重试历史记录升级')) }
  })
  return connection
}

export async function listPrints(): Promise<PrintRecord[]> {
  const db = await openDb()
  const rows = await requestValue(db.transaction(STORE).objectStore(STORE).index('createdAt').getAll()) as PrintRecord[]
  return rows.reverse()
}

export async function getPrint(id: string): Promise<Blob | null> {
  const db = await openDb()
  const image = await requestValue(db.transaction(IMAGES).objectStore(IMAGES).get(id)) as { blob?: Blob } | undefined
  return image?.blob || null
}

export async function putPrints(records: PrintRecord[], blobs: Blob[]): Promise<PrintRecord[]> {
  if (records.length !== blobs.length) throw new Error('历史记录与图片数量不一致')
  const prepared = await Promise.all(records.map(async (record, index) => ({ ...record, thumbnail: await thumbnail(blobs[index]), bytes: blobs[index].size })))
  const db = await openDb()
  const tx = db.transaction([STORE, IMAGES], 'readwrite')
  const done = txDone(tx)
  const store = tx.objectStore(STORE)
  const images = tx.objectStore(IMAGES)
  for (const [index, record] of prepared.entries()) {
    store.put(record)
    images.put({ id: record.id, blob: blobs[index] })
  }
  const all = store.index('createdAt').getAll()
  all.onsuccess = () => {
    const rows = all.result as PrintRecord[]
    let bytes = rows.reduce((sum, row) => sum + (row.bytes || 0), 0)
    let count = rows.length
    for (const row of rows) {
      if (count <= MAX && bytes <= MAX_BYTES) break
      store.delete(row.id); images.delete(row.id)
      count--; bytes -= row.bytes || 0
    }
  }
  await done
  return prepared
}

export async function deletePrint(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([STORE, IMAGES], 'readwrite')
  tx.objectStore(STORE).delete(id)
  tx.objectStore(IMAGES).delete(id)
  await txDone(tx)
}

export async function clearPrints(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([STORE, IMAGES], 'readwrite')
  tx.objectStore(STORE).clear()
  tx.objectStore(IMAGES).clear()
  await txDone(tx)
}
