const express = require("express");
const multer = require("multer");
const bodyParser = require("body-parser");
const cors = require("cors");
const firebaseAdmin = require("firebase-admin");
const fs = require("fs").promises; // Gunakan fs.promises untuk operasi async

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const serviceAccount = require("./serviceAccountKey.json");

firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount),
  storageBucket: "nutripal-4bd4e.appspot.com",
});

const bucket = firebaseAdmin.storage().bucket();
const db = firebaseAdmin.firestore();
const upload = multer({ dest: "temp/" });

// Middleware untuk validasi UID
async function validateFirebaseUser(req, res, next) {
  const { uid } = req.body;
  if (!uid) return res.status(400).json({ message: "UID is required" });

  try {
    const user = await firebaseAdmin.auth().getUser(uid);
    if (!user) return res.status(403).json({ message: "Unauthorized access" });

    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ message: "Error validating user", error });
  }
}

// Fungsi untuk upload file ke Firebase Storage
async function uploadToFirebase(file) {
  const destination = `profile-pictures/${Date.now()}-${file.originalname}`;
  try {
    const [uploadedFile] = await bucket.upload(file.path, {
      destination,
      metadata: { contentType: file.mimetype },
    });

    await fs.unlink(file.path); // Hapus file lokal
    return `https://storage.googleapis.com/${bucket.name}/${uploadedFile.name}`;
  } catch (error) {
    await fs.unlink(file.path); // Pastikan file selalu dihapus
    throw new Error("Failed to upload file");
  }
}

// Fungsi untuk menghapus file di Firebase Storage
async function deleteFromFirebase(url) {
  const filename = url.split("/").pop(); // Ekstrak nama file
  const file = bucket.file(`profile-pictures/${filename}`);
  try {
    await file.delete();
    console.log(`File ${filename} deleted successfully.`);
  } catch (error) {
    console.error(`Error deleting file ${filename}:`, error);
    throw error;
  }
}

// Endpoint: Ambil profil
app.get("/profile/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const doc = await db.collection("profiles").doc(uid).get();

    if (!doc.exists) return res.status(404).json({ message: "Profile not found" });

    res.json(doc.data());
  } catch (error) {
    res.status(500).json({ message: "Error fetching profile", error });
  }
});

// Endpoint: Buat profil
app.post("/profile", upload.single("profilePicture"), validateFirebaseUser, async (req, res) => {
  try {
    const { uid, name, gender, lifestyle } = req.body;

    let profilePicture = null;
    if (req.file) profilePicture = await uploadToFirebase(req.file);

    const profile = { uid, name, gender, lifestyle, profilePicture };
    await db.collection("profiles").doc(uid).set(profile);

    res.status(201).json({ message: "Profile created successfully", profile });
  } catch (error) {
    res.status(500).json({ message: "Error creating profile", error });
  }
});

// Endpoint: Update profil
app.put("/profile/:uid", upload.single("profilePicture"), async (req, res) => {
  try {
    const { uid } = req.params;
    const { name, gender, lifestyle } = req.body;

    const doc = await db.collection("profiles").doc(uid).get();
    if (!doc.exists) return res.status(404).json({ message: "Profile not found" });

    const currentProfile = doc.data();
    let profilePicture = currentProfile.profilePicture;

    if (req.file) {
      if (profilePicture) await deleteFromFirebase(profilePicture);
      profilePicture = await uploadToFirebase(req.file);
    }

    const updatedProfile = { ...currentProfile, name, gender, lifestyle, profilePicture };
    await db.collection("profiles").doc(uid).set(updatedProfile);

    res.json({ message: "Profile updated successfully", profile: updatedProfile });
  } catch (error) {
    res.status(500).json({ message: "Error updating profile", error });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
