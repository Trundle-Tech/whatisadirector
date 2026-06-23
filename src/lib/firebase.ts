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
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "firebase/firestore"

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
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

export async function syncUserToFirestore(user: User, name?: string, department?: string) {
  const userDocRef = doc(db, "users", user.uid)
  const userSnap = await getDoc(userDocRef)
  if (!userSnap.exists()) {
    const isNick = user.email === "nicklynch@bonusthoughts.com"
    await setDoc(userDocRef, {
      uid: user.uid,
      email: user.email,
      name: name || user.displayName || user.email?.split("@")[0] || "New User",
      role: isNick ? "Admin" : "Viewer",
      department: department || "Operations",
      createdAt: new Date().toISOString(),
    })
  }
}

export function listenToUserProfile(uid: string, callback: (profile: any) => void) {
  const userDocRef = doc(db, "users", uid)
  return onSnapshot(userDocRef, (docSnap) => {
    if (docSnap.exists()) {
      callback(docSnap.data())
    } else {
      callback(null)
    }
  })
}

export async function signOutOfFirebase() {
  await signOut(auth)
}



