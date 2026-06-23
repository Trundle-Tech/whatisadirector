import { initializeApp } from "firebase/app"
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth"
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore"

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyAhrZ_FxgfvYtFqeY7KoUUOYrUYYdfAna8",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "whatisadirector.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "whatisadirector",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "whatisadirector.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "452588711956",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:452588711956:web:0170dbf47be717da33f701",
}

export const firebaseApp = initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)
export const db = getFirestore(firebaseApp)

const googleProvider = new GoogleAuthProvider()

export function listenToAuthState(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback)
}

export async function signInWithEmail(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(auth, email, password)
  return credential.user
}

export async function signUpWithEmail(email: string, password: string) {
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  return credential.user
}

export async function signInWithGoogle() {
  const credential = await signInWithPopup(auth, googleProvider)
  return credential.user
}

export async function syncUserToFirestore(user: User) {
  const userDocRef = doc(db, "users", user.uid)
  const userSnap = await getDoc(userDocRef)
  if (!userSnap.exists()) {
    await setDoc(userDocRef, {
      uid: user.uid,
      email: user.email,
      name: user.displayName || user.email?.split("@")[0] || "New User",
      role: "Admin", // default to Admin for live user setup
      createdAt: new Date().toISOString(),
    })
  }
}

export async function signOutOfFirebase() {
  await signOut(auth)
}



