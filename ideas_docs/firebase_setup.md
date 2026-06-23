# Firebase & Database Setup Documentation

This document records the database configuration and application registration for the **whatisadirector** project.

## Project Credentials

* **Project Name**: whatisadirector
* **Project ID**: whatisadirector
* **Project Number**: 452588711956

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
  apiKey: "AIzaSyAhrZ_FxgfvYtFqeY7KoUUOYrUYYdfAna8",
  authDomain: "whatisadirector.firebaseapp.com",
  projectId: "whatisadirector",
  storageBucket: "whatisadirector.firebasestorage.app",
  messagingSenderId: "452588711956",
  appId: "1:452588711956:web:0170dbf47be717da33f701"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
```

## Recommended Libraries
Depending on project needs, you can import additional SDK services:
* **Firestore (Database)**: `import { getFirestore } from "firebase/firestore";`
* **Authentication**: `import { getAuth } from "firebase/auth";`
* **Storage**: `import { getStorage } from "firebase/storage";`
