"use client";

import { IMAGE_RETENTION_DAYS, type ImageMediaType } from "./attachments";

/**
 * Attached images and text files, kept only in this browser (IndexedDB) for IMAGE_RETENTION_DAYS. The server never
 * stores their content, so this is the only copy: it is re-sent with follow-up questions, and deleted
 * when it expires, with its conversation, on sign-out and on account deletion. Every call fails
 * soft: without storage, the model is told the image is no longer available.
 */
export interface StoredImage {
  id: string;
  conversationId: string;
  mediaType: ImageMediaType;
  blob: Blob;
  savedAt: number;
}

export interface StoredFile {
  id: string;
  conversationId: string;
  kind: "text";
  name: string;
  text: string;
  savedAt: number;
}

type Stored = StoredImage | StoredFile;
const isStoredFile = (item: Stored): item is StoredFile => "kind" in item;

const DB_NAME = "beamling-images";
const STORE = "images";
const BY_CONVERSATION = "conversationId";
const BY_DATE = "savedAt";

let opening: Promise<IDBDatabase> | null = null;
// Images saved in this tab that are not in IndexedDB yet (or could not be written), so they still
// show and can be sent in a browser without IndexedDB. Written images are dropped from it.
const recent = new Map<string, Stored>();

function database(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex(BY_CONVERSATION, "conversationId");
      store.createIndex(BY_DATE, "savedAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T> | T, fallback: T): Promise<T> {
  try {
    const tx = (await database()).transaction(STORE, mode);
    // Listen before any work: a transaction can complete before an awaited result is read.
    const finished = done(tx);
    const [result] = await Promise.all([work(tx.objectStore(STORE)), finished]);
    return result;
  } catch {
    return fallback;
  }
}

/** Deletes every record a cursor over `source` visits. */
function deleteAll(source: IDBIndex, range: IDBKeyRange): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = source.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveImages(images: Stored[]): Promise<void> {
  for (const image of images) recent.set(image.id, image);
  const written = await run("readwrite", (store) => (images.forEach((image) => store.put(image)), true), false);
  if (written) for (const image of images) recent.delete(image.id);
}

const expiresBefore = () => Date.now() - IMAGE_RETENTION_DAYS * 86_400_000;

/** What is on this device and not expired, in the order asked. */
async function load(ids: string[]): Promise<Stored[]> {
  const missing = ids.filter((id) => !recent.has(id));
  const stored = new Map((missing.length ? await read(missing) : []).map((item) => [item.id, item]));
  const cutoff = expiresBefore();
  return ids.flatMap((id) => {
    const item = recent.get(id) ?? stored.get(id);
    return item && item.savedAt > cutoff ? [item] : [];
  });
}

/** The images that are on this device and not expired, in the order asked. */
export async function loadImages(ids: string[]): Promise<StoredImage[]> {
  return (await load(ids)).filter((item): item is StoredImage => !isStoredFile(item));
}

/** The text files that are on this device and not expired, in the order asked. */
export async function loadFiles(ids: string[]): Promise<StoredFile[]> {
  return (await load(ids)).filter(isStoredFile);
}

function read(ids: string[]): Promise<Stored[]> {
  return run(
    "readonly",
    (store) =>
      Promise.all(
        ids.map(
          (id) =>
            new Promise<Stored | undefined>((resolve) => {
              const request = store.get(id);
              request.onsuccess = () => resolve(request.result as Stored | undefined);
              request.onerror = () => resolve(undefined);
            }),
        ),
      ).then((found) => found.filter((item): item is Stored => !!item)),
    [],
  );
}

export function deleteConversationImages(conversationIds: string[]): Promise<void> {
  const gone = new Set(conversationIds);
  for (const image of recent.values()) if (gone.has(image.conversationId)) recent.delete(image.id);
  return run(
    "readwrite",
    (store) => Promise.all(conversationIds.map((id) => deleteAll(store.index(BY_CONVERSATION), IDBKeyRange.only(id)))).then(() => {}),
    undefined,
  );
}

/** Deletes expired images. Reads already ignore them; this frees the space. */
export function pruneImages(): Promise<void> {
  return run("readwrite", (store) => deleteAll(store.index(BY_DATE), IDBKeyRange.upperBound(expiresBefore())), undefined);
}

export function clearImages(): Promise<void> {
  recent.clear();
  return run("readwrite", (store) => void store.clear(), undefined);
}
