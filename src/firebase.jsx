import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, query, limitToLast } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBMLMxhPZY3yAHdlmibvF5FY-386KbmuZU",
  authDomain: "fumeguard-ai.firebaseapp.com",
  databaseURL: "https://fumeguard-ai-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "fumeguard-ai",
  storageBucket: "fumeguard-ai.firebasestorage.app",
  messagingSenderId: "61531012723",
  appId: "1:61531012723:web:c8489b2d86d39481207406",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, onValue, query, limitToLast };