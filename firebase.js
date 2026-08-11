const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function initFirebase() {
  if (getApps().length > 0) {
    return getFirestore();
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json';
  const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);

  if (fs.existsSync(resolvedPath)) {
    const serviceAccount = require(resolvedPath);
    initializeApp({
      credential: cert(serviceAccount)
    });
    console.log('Firebase initialized successfully using serviceAccountKey.json');
  } else if (process.env.FIREBASE_CONFIG_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
    initializeApp({
      credential: cert(serviceAccount)
    });
    console.log('Firebase initialized using FIREBASE_CONFIG_JSON env var');
  } else {
    console.warn('\n⚠️ WARNING: Firebase credentials file not found!');
    console.warn(`Please place your Firebase Service Account JSON at '${serviceAccountPath}' or set FIREBASE_CONFIG_JSON env variable.`);
    console.warn('Falling back to default initialization.\n');
    initializeApp();
  }

  return getFirestore();
}

const db = initFirebase();

module.exports = {
  db,
  FieldValue
};
