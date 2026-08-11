import { Client, Storage, Databases, ID, Permission, Role, Query } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const required = [
  'APPWRITE_ENDPOINT',
  'APPWRITE_PROJECT_ID',
  'APPWRITE_API_KEY',
  'APPWRITE_BUCKET_ID',
  'APPWRITE_DATABASE_ID',
  'APPWRITE_COLLECTION_ID',
];

function getEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function assertAppwriteConfig() {
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Appwrite is not configured. Set these in server/.env: ${missing.join(', ')}`
    );
  }
}

let clientInstance = null;

export function getAppwriteClient() {
  if (!clientInstance) {
    assertAppwriteConfig();
    clientInstance = new Client()
      .setEndpoint(getEnv('APPWRITE_ENDPOINT'))
      .setProject(getEnv('APPWRITE_PROJECT_ID'))
      .setKey(getEnv('APPWRITE_API_KEY'));
  }
  return clientInstance;
}

export function getStorage() {
  return new Storage(getAppwriteClient());
}

export function getDatabases() {
  return new Databases(getAppwriteClient());
}

export function getAppwriteIds() {
  return {
    bucketId: getEnv('APPWRITE_BUCKET_ID'),
    databaseId: getEnv('APPWRITE_DATABASE_ID'),
    collectionId: getEnv('APPWRITE_COLLECTION_ID'),
    diseaseCollectionId: process.env.APPWRITE_DISEASE_COLLECTION_ID?.trim() || '',
    projectId: getEnv('APPWRITE_PROJECT_ID'),
    endpoint: getEnv('APPWRITE_ENDPOINT').replace(/\/$/, ''),
  };
}

export function assertDiseaseCollectionConfig() {
  assertAppwriteConfig();
  const diseaseCollectionId = process.env.APPWRITE_DISEASE_COLLECTION_ID?.trim();
  if (!diseaseCollectionId) {
    throw new Error(
      'Disease detection is not configured. Create the disease_detections collection in Appwrite and set APPWRITE_DISEASE_COLLECTION_ID in server/.env (see server/src/schemas/disease-detections.collection.json).'
    );
  }
  return diseaseCollectionId;
}

/** Direct Appwrite URL (server-side only — browsers get 401 without a session). */
export function buildPublicFileUrl(fileId) {
  const { endpoint, bucketId, projectId } = getAppwriteIds();
  return `${endpoint}/storage/buckets/${bucketId}/files/${fileId}/view?project=${projectId}`;
}

/** Browser-safe URL via this app's storage proxy. */
export function buildClientFileViewUrl(fileId) {
  return `/api/files/${encodeURIComponent(fileId)}/view`;
}

/** Browser-safe preview URL via this app's storage proxy. */
export function buildClientFilePreviewUrl(fileId, width = 480, height = 360) {
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    quality: '82',
  });
  return `/api/files/${encodeURIComponent(fileId)}/preview?${params}`;
}

/** @deprecated Use buildClientFilePreviewUrl for API responses */
export function buildPreviewUrl(fileId, width = 960, height = 720) {
  return buildClientFilePreviewUrl(fileId, width, height);
}

/** Prefer proxy URLs in JSON sent to the frontend. */
export function buildImageUrlsForClient(fileId) {
  return {
    image_url: buildClientFileViewUrl(fileId),
    preview_url: buildClientFilePreviewUrl(fileId),
  };
}

function deriveTitleFromFilename(filename = '') {
  const base = filename.replace(/\.[^.]+$/, '').trim();
  return base || 'Unknown Species';
}

/** Pull Appwrite file id from a stored storage URL when image_id is missing. */
export function extractFileIdFromStorageUrl(url = '') {
  const match = String(url).match(/\/files\/([a-zA-Z0-9]+)\/(?:view|preview|download)/);
  return match ? match[1] : null;
}

export const GALLERY_LIMIT = 10;
const GALLERY_SCAN_BATCH = 25;
const GALLERY_MAX_SCAN = 200;

export async function uploadImageToStorage(buffer, originalFilename, mimeType) {
  const storage = getStorage();
  const { bucketId } = getAppwriteIds();
  const fileId = ID.unique();

  const file = await storage.createFile(
    bucketId,
    fileId,
    InputFile.fromBuffer(buffer, originalFilename),
    [Permission.read(Role.any())]
  );

  const urls = buildImageUrlsForClient(file.$id);
  return {
    fileId: file.$id,
    imageUrl: urls.image_url,
    previewUrl: urls.preview_url,
  };
}

/**
 * Normalize PlantNet confidence to 0–1 (v2 API uses 0–1; legacy values may be 0–100).
 */
function normalizeConfidenceScore(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n > 1) return Math.round((n / 100) * 10000) / 10000;
  if (n < 0) return 0;
  return n;
}

/**
 * Map PlantNet identification result onto Appwrite document attributes.
 */
function applyIdentificationToPayload(payload, identification) {
  if (!identification) return;

  payload.plantnet_status = identification.status || 'unknown';

  const scientificName =
    identification.scientific_name?.trim?.() ||
    identification.scientific_name ||
    identification.raw_best_match?.trim?.() ||
    '';

  const confidence = normalizeConfidenceScore(
    identification.confidence_score ?? identification.confidence
  );

  if (identification.status === 'success') {
    if (scientificName) payload.scientific_name = scientificName;
    if (confidence != null) {
      payload.confidence = confidence;
      payload.confidence_score = confidence;
    }
    if (identification.family) payload.family = identification.family;
    if (identification.genus) payload.genus = identification.genus;
    if (identification.common_names?.length) {
      payload.common_names = JSON.stringify(identification.common_names);
    }
    if (identification.related_images?.length) {
      payload.plantnet_result_images = JSON.stringify(identification.related_images);
    }
    if (identification.identification_notes) {
      payload.identification_notes = identification.identification_notes;
    }
  } else {
    if (confidence != null) {
      payload.confidence = confidence;
      payload.confidence_score = confidence;
    }
    if (identification.message) {
      payload.identification_notes = identification.message;
    }
  }
}

function pickPayloadFields(source, keys) {
  const out = {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      out[key] = source[key];
    }
  }
  return out;
}

const CORE_DOC_KEYS = ['image_id', 'image_url', 'original_filename', 'uploaded_at'];
const USER_DOC_KEYS = ['plant_title', 'location'];
const PLANTNET_DOC_KEYS = [
  'plantnet_status',
  'scientific_name',
  'common_names',
  'family',
  'genus',
  'confidence',
  'confidence_score',
  'plantnet_result_images',
  'identification_notes',
];

const PLANTNET_ESSENTIAL_KEYS = ['plantnet_status', 'scientific_name', 'confidence', 'confidence_score'];

export async function saveImageMetadata({
  imageId,
  imageUrl,
  originalFilename,
  plantTitle,
  location,
  identification,
}) {
  const databases = getDatabases();
  const { databaseId, collectionId } = getAppwriteIds();

  const fullPayload = {
    image_id: imageId,
    image_url: imageUrl,
    original_filename: originalFilename,
    uploaded_at: new Date().toISOString(),
  };

  if (plantTitle) fullPayload.plant_title = plantTitle;
  if (location) fullPayload.location = location;
  applyIdentificationToPayload(fullPayload, identification);

  const plantNetOnly = {
    ...pickPayloadFields(fullPayload, CORE_DOC_KEYS),
    ...pickPayloadFields(fullPayload, PLANTNET_DOC_KEYS),
  };

  const identificationEssentials = {
    ...pickPayloadFields(fullPayload, CORE_DOC_KEYS),
    ...pickPayloadFields(fullPayload, PLANTNET_ESSENTIAL_KEYS),
  };

  const userOnly = {
    ...pickPayloadFields(fullPayload, CORE_DOC_KEYS),
    ...pickPayloadFields(fullPayload, USER_DOC_KEYS),
  };

  const minimalPayload = pickPayloadFields(fullPayload, CORE_DOC_KEYS);

  if (identification?.status === 'success') {
    console.log('[appwrite] Plant identification fields for plant_images:', {
      scientific_name: fullPayload.scientific_name || null,
      confidence: fullPayload.confidence ?? null,
      plantnet_status: fullPayload.plantnet_status,
    });
  }

  const attempts = [
    { label: 'full', data: fullPayload },
    { label: 'core+identification', data: identificationEssentials },
    { label: 'core+plantnet', data: plantNetOnly },
    { label: 'core+user', data: userOnly },
    { label: 'minimal', data: minimalPayload },
  ];

  let lastError;
  const documentId = ID.unique();

  for (const { label, data } of attempts) {
    try {
      const doc = await databases.createDocument(databaseId, collectionId, documentId, data);
      if (label !== 'full') {
        console.warn(`[appwrite] Saved document using "${label}" payload (some attributes may be missing in Console)`);
      }
      return doc;
    } catch (error) {
      lastError = error;
      console.warn(`[appwrite] Create attempt "${label}" failed:`, error?.message || error);
    }
  }

  throw lastError || new Error('Failed to save image metadata to Appwrite.');
}

export async function getPlantDocumentById(documentId) {
  const databases = getDatabases();
  const { databaseId, collectionId } = getAppwriteIds();

  const doc = await databases.getDocument(databaseId, collectionId, documentId);
  const normalized = normalizePlantDocument(doc);
  if (normalized.error) return null;
  return normalized;
}

function normalizePlantDocument(doc) {
  let imageId = doc?.image_id?.trim?.() || doc?.image_id || '';
  if (!imageId && doc?.image_url) {
    imageId = extractFileIdFromStorageUrl(doc.image_url) || '';
  }
  if (!imageId) {
    return { error: 'missing image_id', documentId: doc?.$id };
  }

  const clientUrls = buildImageUrlsForClient(imageId);
  if (!clientUrls.image_url?.trim() || !clientUrls.preview_url?.trim()) {
    return { error: 'missing image_url', documentId: doc?.$id };
  }

  return {
    document_id: doc.$id,
    image_id: imageId,
    image_url: clientUrls.image_url,
    preview_url: clientUrls.preview_url,
    original_filename: doc.original_filename || '',
    uploaded_at: doc.uploaded_at || null,
    plant_title: doc.plant_title || deriveTitleFromFilename(doc.original_filename),
    location: doc.location || '',
    scientific_name: doc.scientific_name || '',
    common_names: doc.common_names || '',
    family: doc.family || '',
    genus: doc.genus || '',
    confidence: doc.confidence ?? doc.confidence_score ?? null,
    confidence_score: doc.confidence_score ?? doc.confidence ?? null,
    plantnet_status: doc.plantnet_status || '',
    plantnet_result_images: doc.plantnet_result_images || '',
    identification_notes: doc.identification_notes || '',
  };
}

/** Verify a storage file exists; cache results per request to avoid duplicate API calls. */
async function storageFileExists(fileId, cache = new Map()) {
  const id = fileId?.trim?.() || fileId;
  if (!id) return false;
  if (cache.has(id)) return cache.get(id);

  const storage = getStorage();
  const { bucketId } = getAppwriteIds();

  try {
    await storage.getFile(bucketId, id);
    cache.set(id, true);
    return true;
  } catch (error) {
    cache.set(id, false);
    const message = error?.response?.message || error?.message || '';
    const notFound = error?.code === 404 || /not found/i.test(message);
    if (notFound) {
      console.warn(`[gallery] Appwrite storage file missing: ${id}`);
    } else {
      console.warn(`[gallery] Could not verify storage file ${id}:`, message);
    }
    return false;
  }
}

async function fetchDocumentsPage({ limit = GALLERY_SCAN_BATCH, offset = 0, orderField = '$createdAt' }) {
  const databases = getDatabases();
  const { databaseId, collectionId } = getAppwriteIds();

  const queries = [Query.orderDesc(orderField), Query.limit(limit), Query.offset(offset)];

  try {
    return await databases.listDocuments(databaseId, collectionId, queries);
  } catch (orderError) {
    if (orderField === '$createdAt') {
      console.warn('[appwrite] $createdAt query failed, falling back to uploaded_at:', orderError?.message);
      return fetchDocumentsPage({ limit, offset, orderField: 'uploaded_at' });
    }
    if (orderField === 'uploaded_at') {
      return databases.listDocuments(databaseId, collectionId, [
        Query.limit(limit),
        Query.offset(offset),
      ]);
    }
    throw orderError;
  }
}

export async function listPlantImages(limit = GALLERY_LIMIT) {
  const fileCache = new Map();
  const images = [];
  const skipped = [];
  let offset = 0;

  while (images.length < limit && offset < GALLERY_MAX_SCAN) {
    const response = await fetchDocumentsPage({
      limit: GALLERY_SCAN_BATCH,
      offset,
    });
    const docs = response.documents || [];
    if (!docs.length) break;

    for (const doc of docs) {
      if (images.length >= limit) break;

      try {
        const normalized = normalizePlantDocument(doc);
        if (normalized.error) {
          skipped.push({ document_id: doc.$id, reason: normalized.error });
          console.warn(`[gallery] Skipped document ${doc.$id}: ${normalized.error}`);
          continue;
        }

        const exists = await storageFileExists(normalized.image_id, fileCache);
        if (!exists) {
          skipped.push({
            document_id: doc.$id,
            image_id: normalized.image_id,
            reason: 'storage_file_missing',
          });
          console.warn(
            `[gallery] Excluded document ${doc.$id}: file ${normalized.image_id} not in Appwrite Storage`
          );
          continue;
        }

        images.push(normalized);
      } catch (err) {
        skipped.push({
          document_id: doc.$id,
          reason: err?.message || 'normalization failed',
        });
        console.warn(`[gallery] Skipped document ${doc.$id}:`, err?.message || err);
      }
    }

    offset += docs.length;
    if (docs.length < GALLERY_SCAN_BATCH) break;
  }

  return { images, skipped, limit };
}

export async function deleteStorageFile(fileId) {
  const storage = getStorage();
  const { bucketId } = getAppwriteIds();
  await storage.deleteFile(bucketId, fileId);
}

function applyDiseaseToPayload(payload, detection) {
  if (!detection) return;

  payload.plantnet_status = detection.status || 'unknown';
  payload.detection_type = 'disease';

  if (detection.disease_name) payload.disease_name = detection.disease_name;
  if (detection.scientific_name) payload.scientific_name = detection.scientific_name;
  if (detection.eppo_code) payload.eppo_code = detection.eppo_code;
  if (detection.confidence_score != null) payload.confidence_score = detection.confidence_score;
  if (detection.plant_name) payload.plant_name = detection.plant_name;
  if (detection.plant_scientific_name) payload.plant_scientific_name = detection.plant_scientific_name;
  if (detection.disease_description) payload.disease_description = detection.disease_description;
  if (detection.disease_category) payload.disease_category = detection.disease_category;

  if (detection.symptoms?.length) {
    payload.symptoms = JSON.stringify(detection.symptoms);
  }
  if (detection.recommendations) {
    payload.recommendations = JSON.stringify(detection.recommendations);
  }
  if (detection.related_images?.length) {
    payload.related_images = JSON.stringify(detection.related_images);
  }
  if (detection.alternate_results?.length) {
    payload.alternate_results = JSON.stringify(detection.alternate_results);
  }
  if (detection.raw_api_response) {
    try {
      payload.raw_api_response = JSON.stringify(detection.raw_api_response).slice(0, 16384);
    } catch {
      /* ignore serialization errors */
    }
  }

  if (detection.status === 'success') {
    if (detection.identification_notes) {
      payload.identification_notes = detection.identification_notes;
    }
  } else if (detection.message) {
    payload.identification_notes = detection.message;
  }
}

const DISEASE_CORE_KEYS = ['image_id', 'image_path', 'original_filename', 'uploaded_at', 'detection_type'];
const DISEASE_RESULT_KEYS = [
  'plantnet_status',
  'disease_name',
  'scientific_name',
  'eppo_code',
  'confidence_score',
  'plant_name',
  'plant_scientific_name',
  'symptoms',
  'disease_description',
  'disease_category',
  'recommendations',
  'related_images',
  'alternate_results',
  'identification_notes',
];
const DISEASE_RAW_KEY = 'raw_api_response';

export async function saveDiseaseDetection({
  imageId,
  imagePath,
  originalFilename,
  detection,
}) {
  const databases = getDatabases();
  const { databaseId } = getAppwriteIds();
  const collectionId = assertDiseaseCollectionConfig();

  const fullPayload = {
    image_id: imageId,
    image_path: imagePath,
    original_filename: originalFilename,
    uploaded_at: new Date().toISOString(),
    detection_type: 'disease',
  };

  applyDiseaseToPayload(fullPayload, detection);

  const resultOnly = {
    ...pickPayloadFields(fullPayload, DISEASE_CORE_KEYS),
    ...pickPayloadFields(fullPayload, DISEASE_RESULT_KEYS),
  };

  const minimalPayload = pickPayloadFields(fullPayload, DISEASE_CORE_KEYS);

  const withRaw = {
    ...pickPayloadFields(fullPayload, [...DISEASE_CORE_KEYS, ...DISEASE_RESULT_KEYS, DISEASE_RAW_KEY]),
  };

  const attempts = [
    { label: 'full+raw', data: withRaw },
    { label: 'full', data: fullPayload },
    { label: 'core+results', data: resultOnly },
    { label: 'minimal', data: minimalPayload },
  ];

  let lastError;
  const documentId = ID.unique();

  console.log('[appwrite] saveDiseaseDetection target:', {
    databaseId,
    collectionId,
    documentId,
    attemptCount: attempts.length,
  });

  for (const { label, data } of attempts) {
    try {
      console.log(`[appwrite] Disease create attempt "${label}" fields:`, Object.keys(data).sort());
      const doc = await databases.createDocument(databaseId, collectionId, documentId, data);
      if (label !== 'full+raw' && label !== 'full') {
        console.warn(`[appwrite] Saved disease document using "${label}" payload`);
      }
      return doc;
    } catch (error) {
      lastError = error;
      console.error(`[appwrite] Disease create attempt "${label}" FAILED`, {
        message: error?.message,
        code: error?.code,
        type: error?.type,
        response: error?.response,
        fieldsSent: Object.keys(data).sort(),
        payloadPreview: JSON.stringify(data).slice(0, 500),
      });
      if (error?.response) {
        try {
          console.error(
            `[appwrite] Disease create attempt "${label}" response JSON:`,
            JSON.stringify(error.response, null, 2)
          );
        } catch {
          /* ignore */
        }
      }
    }
  }

  throw lastError || new Error('Failed to save disease detection to Appwrite.');
}

export async function getDiseaseDocumentById(documentId) {
  const databases = getDatabases();
  const { databaseId } = getAppwriteIds();
  const collectionId = assertDiseaseCollectionConfig();

  const doc = await databases.getDocument(databaseId, collectionId, documentId);
  return normalizeDiseaseDocument(doc);
}

function normalizeDiseaseDocument(doc) {
  let imageId = doc?.image_id?.trim?.() || doc?.image_id || '';
  if (!imageId && doc?.image_path) {
    imageId = extractFileIdFromStorageUrl(doc.image_path) || '';
  }
  if (!imageId) {
    return null;
  }

  const clientUrls = buildImageUrlsForClient(imageId);
  if (!clientUrls.image_url?.trim() || !clientUrls.preview_url?.trim()) {
    return null;
  }

  return {
    document_id: doc.$id,
    image_id: imageId,
    image_path: doc.image_path || clientUrls.image_url,
    image_url: clientUrls.image_url,
    preview_url: clientUrls.preview_url,
    original_filename: doc.original_filename || '',
    uploaded_at: doc.uploaded_at || null,
    detection_type: doc.detection_type || 'disease',
    disease_name: doc.disease_name || '',
    scientific_name: doc.scientific_name || '',
    eppo_code: doc.eppo_code || '',
    confidence_score: doc.confidence_score ?? null,
    plant_name: doc.plant_name || '',
    plant_scientific_name: doc.plant_scientific_name || '',
    symptoms: doc.symptoms || '',
    disease_description: doc.disease_description || '',
    disease_category: doc.disease_category || '',
    recommendations: doc.recommendations || '',
    related_images: doc.related_images || '',
    alternate_results: doc.alternate_results || '',
    plantnet_status: doc.plantnet_status || '',
    identification_notes: doc.identification_notes || '',
    raw_api_response: doc.raw_api_response || '',
  };
}

export { ID };
