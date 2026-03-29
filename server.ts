import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the config to get the project ID
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "firebase-applet-config.json"), "utf8"));

// Initialize Firebase Admin
// In this environment, we can usually initialize with just the projectId
// if the environment provides the default credentials.
admin.initializeApp({
  projectId: firebaseConfig.projectId,
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.post("/api/admin/delete-user", async (req, res) => {
    const { uid } = req.body;
    const authHeader = req.headers.authorization;
    
    if (!uid) {
      return res.status(400).json({ error: "UID is required" });
    }

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: No token provided" });
    }
    
    const idToken = authHeader.split("Bearer ")[1];

    try {
      // 1. Verify the admin's ID token
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      
      // 2. Check if the user is an admin in Firestore
      const db = admin.firestore(firebaseConfig.firestoreDatabaseId);
      const adminDoc = await db.collection("users").doc(decodedToken.uid).get();
      
      if (!adminDoc.exists || adminDoc.data()?.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
      }

      // 3. Delete from Firebase Authentication
      await admin.auth().deleteUser(uid);
      
      // 4. Delete from Firestore
      await db.collection("users").doc(uid).delete();

      res.json({ success: true, message: "User deleted from Auth and Firestore" });
    } catch (error: any) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
