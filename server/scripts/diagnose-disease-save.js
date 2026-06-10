/**
 * One-off diagnostic: reproduce saveDiseaseDetection createDocument failures.
 * Run: node scripts/diagnose-disease-save.js
 */
import '../src/loadEnv.js';
import { Client, Databases, ID } from 'node-appwrite';
import { getAppwriteIds, assertDiseaseCollectionConfig } from '../src/config/appwrite.js';

function logAppwriteError(label, error) {
  console.error(`\n=== ${label} ===`);
  console.error('message:', error?.message);
  console.error('code:', error?.code);
  console.error('type:', error?.type);
  console.error('response:', error?.response);
  if (error?.response) {
    try {
      console.error('response (JSON):', JSON.stringify(error.response, null, 2));
    } catch {
      /* ignore */
    }
  }
  console.error('stack:', error?.stack);
}

async function listCollectionAttributes(client, databaseId, collectionId) {
  const databases = new Databases(client);
  try {
    const col = await databases.getCollection(databaseId, collectionId);
    console.log('\n=== Collection metadata ===');
    console.log('collection $id:', col.$id);
    console.log('collection name:', col.name);
    console.log('databaseId:', databaseId);

    const attrs = await databases.listAttributes(databaseId, collectionId);
    console.log('\n=== Attributes in Appwrite (actual) ===');
    for (const a of attrs.attributes || []) {
      console.log(`  - ${a.key} (${a.type}) required=${a.required} status=${a.status}`);
    }
    return (attrs.attributes || []).map((a) => a.key);
  } catch (error) {
    logAppwriteError('getCollection/listAttributes failed', error);
    return null;
  }
}

async function tryCreate(client, databaseId, collectionId, label, data) {
  const databases = new Databases(client);
  const docId = ID.unique();
  console.log(`\n=== Attempt: ${label} ===`);
  console.log('documentId:', docId);
  console.log('fields:', Object.keys(data).sort().join(', '));
  console.log('payload:', JSON.stringify(data, null, 2));
  try {
    const doc = await databases.createDocument(databaseId, collectionId, docId, data);
    console.log('SUCCESS — created document:', doc.$id);
    try {
      await databases.deleteDocument(databaseId, collectionId, doc.$id);
      console.log('(test document deleted)');
    } catch {
      /* ignore */
    }
    return { ok: true };
  } catch (error) {
    logAppwriteError(`createDocument FAILED (${label})`, error);
    return { ok: false, error };
  }
}

async function main() {
  const { endpoint, projectId, databaseId } = getAppwriteIds();
  const collectionId = assertDiseaseCollectionConfig();
  const apiKey = process.env.APPWRITE_API_KEY?.trim();

  console.log('=== Config ===');
  console.log('APPWRITE_ENDPOINT:', endpoint);
  console.log('APPWRITE_PROJECT_ID:', projectId);
  console.log('APPWRITE_DATABASE_ID:', databaseId);
  console.log('APPWRITE_DISEASE_COLLECTION_ID:', collectionId);

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);

  const actualAttrs = await listCollectionAttributes(client, databaseId, collectionId);

  const minimal = {
    image_id: 'diag00000000000000000000001',
    image_path: '/api/files/diag00000000000000000000001/view',
    original_filename: 'diagnose-test.jpg',
    uploaded_at: new Date().toISOString(),
    detection_type: 'disease',
  };

  const schemaKeys = [
    'image_id', 'image_path', 'original_filename', 'uploaded_at', 'detection_type',
    'disease_name', 'scientific_name', 'eppo_code', 'confidence_score',
    'plant_name', 'plant_scientific_name', 'symptoms', 'disease_description',
    'disease_category', 'recommendations', 'related_images', 'alternate_results',
    'plantnet_status', 'identification_notes', 'raw_api_response',
  ];

  if (actualAttrs) {
    console.log('\n=== Schema vs Appwrite attribute check ===');
    for (const key of schemaKeys) {
      const exists = actualAttrs.includes(key);
      console.log(`  ${key}: ${exists ? 'EXISTS' : 'MISSING IN APPWRITE'}`);
    }
    const extraInAppwrite = actualAttrs.filter((k) => !schemaKeys.includes(k));
    if (extraInAppwrite.length) {
      console.log('  Extra in Appwrite (not in schema file):', extraInAppwrite.join(', '));
    }
  }

  await tryCreate(client, databaseId, collectionId, 'minimal (core only)', minimal);

  const withStatus = {
    ...minimal,
    plantnet_status: 'no_match',
    identification_notes: 'Diagnostic test — no disease match',
  };
  await tryCreate(client, databaseId, collectionId, 'core + plantnet_status', withStatus);

  const onlyExisting = {
    detection_type: 'disease',
    disease_name: 'Diagnostic test',
    scientific_name: 'Test sp.',
    confidence_score: 0.5,
    plant_name: 'Test plant',
    symptoms: JSON.stringify(['test symptom']),
    disease_description: 'Diagnostic only',
    disease_category: 'test',
    recommendations: JSON.stringify({ prevention: [], treatment: [], monitoring: [] }),
    raw_api_response: '{}',
  };
  await tryCreate(client, databaseId, collectionId, 'only Appwrite-existing attrs', onlyExisting);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
