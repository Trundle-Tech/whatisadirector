# Firebase & Database Setup Documentation

This document records the database configuration and application registration for the **whatisadirector** project.

## Project Credentials

* **Project Name**: whatisadirector
* **Project ID**: see `VITE_FIREBASE_PROJECT_ID` env var
* **Project Number**: see `VITE_FIREBASE_MESSAGING_SENDER_ID` env var

## Database Status
* **Status**: Stood Up
* **Type**: Cloud Firestore
* **Details**: The database is provisioned and active, ready to store and retrieve application data.

## Web App Registration Configuration

Use the following configuration details to initialize the Firebase SDK within the client/renderer processes of the application:

```javascript
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
```

## Recommended Libraries
Depending on project needs, you can import additional SDK services:
* **Firestore (Database)**: `import { getFirestore } from "firebase/firestore";`
* **Authentication**: `import { getAuth } from "firebase/auth";`
* **Storage**: `import { getStorage } from "firebase/storage";`
