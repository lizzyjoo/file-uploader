const router = require("express").Router();
require("dotenv").config();
const { cloudinaryUpload } = require("../config/cloudinary");
const passport = require("passport");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const { body, validationResult } = require("express-validator");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * -------------- CUSTOM MIDDLEWARE ----------------
 */

const uploadsDir = "uploads";
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const userDir = path.join(uploadsDir, req.user.id.toString());
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    cb(null, userDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// ensures if a user is authenticated or not
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  if (!req.isAuthenticated()) {
    return res.redirect("/log-in");
  }
  if (!req.user.is_member) {
    return res.redirect("/register");
  }
  next();
}

/**
 * -------------- POST ROUTES ----------------
 */

// login
router.post("/log-in", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) {
      return next(err);
    }

    if (!user) {
      return res.render("login", {
        user: null,
        error: info.message || "Invalid username or password",
      });
    }

    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      console.log("Login successful for user:", user.username);
      return res.redirect("/");
    });
  })(req, res, next);
});

// register: save new user info to db
router.post(
  "/register",
  [
    body("first_name")
      .notEmpty()
      .withMessage("First name is required.")
      .isAlphanumeric()
      .withMessage("First name must be alphanumeric."),
    body("last_name")
      .notEmpty()
      .withMessage("Last name is required.")
      .isAlphanumeric()
      .withMessage("Last name must be alphanumeric."),
    body("username")
      .notEmpty()
      .withMessage("Username is required.")
      .isAlphanumeric()
      .withMessage("Username must be alphanumeric."),
    body("password")
      .isLength({ min: 5 })
      .withMessage("Password must be at least 5 characters."),
    body("passwordConfirmation").custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error("Passwords do not match.");
      }
      return true;
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    try {
      const { first_name, last_name, username, password } = req.body;

      const existingUser = await prisma.user.findUnique({
        where: { username: username },
      });
      if (existingUser) {
        return res.status(400).json({ error: "Username is already taken." });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      await prisma.user.create({
        data: {
          first_name: first_name,
          last_name: last_name,
          username,
          password: hashedPassword,
        },
      });

      return res.redirect("/");
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  }
);

router.post(
  "/upload",
  ensureAuth,
  cloudinaryUpload.single("user-file"),
  async (req, res, next) => {
    try {
      console.log("Uploaded file:", req.file);

      if (!req.file) {
        return res.status(400).send("No file uploaded");
      }

      // Get folder ID from form if provided
      const folderId = req.body.folderId ? parseInt(req.body.folderId) : null;

      // Save file info to database with Cloudinary details
      const newFile = await prisma.file.create({
        data: {
          name: req.file.originalname,
          path: req.file.path, // Cloudinary URL
          cloudUrl: req.file.path, // Store separately for clarity
          cloudId: req.file.filename, // Cloudinary public ID
          size: req.file.size,
          mimeType: req.file.mimetype,
          userId: req.user.id,
          folderId: folderId,
        },
      });

      // Redirect back to folder or drive root
      if (folderId) {
        return res.redirect(`/drive/${folderId}`);
      } else {
        return res.redirect("/drive");
      }
    } catch (error) {
      console.error("Error saving file:", error);
      res.status(500).send("Error uploading file");
    }
  }
);

router.post("/add-folder", ensureAuth, async (req, res) => {
  const folderName = req.body.folderName;
  const parentId = req.body.parentId ? parseInt(req.body.parentId) : null;

  try {
    const newFolder = await prisma.folder.create({
      data: {
        name: folderName,
        userId: req.user.id,
        parentId: parentId, // Will be null for root folders
      },
    });

    // Redirect back to parent folder or drive root
    if (parentId) {
      return res.redirect(`/drive/${parentId}`);
    } else {
      return res.redirect("/drive");
    }
  } catch (error) {
    console.error("Error creating folder:", error);
    return res.status(500).send("Server error");
  }
});

router.post("/add-file", ensureAuth, async (req, res) => {
  const fileName = req.body.fileName;

  try {
    // For manual file creation, provide default values for required fields
    const newFile = await prisma.file.create({
      data: {
        name: fileName,
        path: `/placeholder/${fileName}`, // Placeholder path
        size: 0, // Default size
        userId: req.user.id,
      },
    });

    return res.redirect("/drive");
  } catch (error) {
    console.error("Error creating file:", error);
    res.status(500).send("Server error");
  }
});

router.post("/file/:fileId/delete", ensureAuth, async (req, res) => {
  const fileId = parseInt(req.params.fileId);

  if (isNaN(fileId)) {
    return res.status(400).send("Invalid file ID");
  }

  try {
    const file = await prisma.file.findUnique({
      where: {
        id: fileId,
        userId: req.user.id,
      },
    });

    if (!file) {
      return res.status(404).send("File not found");
    }

    // Delete from cloud if applicable
    if (file.cloudId) {
      try {
        const { cloudinary } = require("../config/cloudinary");
        await cloudinary.uploader.destroy(file.cloudId, {
          resource_type: "auto",
        });
      } catch (cloudError) {
        console.error("Error deleting from cloud:", cloudError);
      }
    } else if (file.path && fs.existsSync(file.path)) {
      // Delete local file
      fs.unlinkSync(file.path);
    }

    // Delete from database
    await prisma.file.delete({
      where: { id: fileId },
    });

    res.redirect(file.folderId ? `/drive/${file.folderId}` : "/drive");
  } catch (error) {
    console.error("Error deleting file:", error);
    res.status(500).send("Error deleting file");
  }
});

/**
 * -------------- GET ROUTES ----------------
 */

router.get("/", (req, res) => res.render("index", { user: req.user }));

router.get("/log-in", (req, res) =>
  res.render("login", { user: req.user, error: null })
);

router.get("/register", (req, res) =>
  res.render("register", { user: req.user })
);

router.get("/profile", (req, res) => {
  if (!req.user) {
    return res.redirect("/log-in");
  }
  res.render("profile", { user: req.user });
});

// fetch all files and folders
router.get("/drive", ensureAuth, async (req, res) => {
  try {
    // Get only ROOT folders (parentId is null)
    const folders = await prisma.folder.findMany({
      where: {
        userId: req.user.id,
        parentId: null, // Only root folders
      },
      orderBy: { createdAt: "desc" },
    });

    // Get only ROOT files (folderId is null)
    const files = await prisma.file.findMany({
      where: {
        userId: req.user.id,
        folderId: null, // Only root files
      },
      orderBy: { createdAt: "desc" },
    });

    res.render("drive", {
      user: req.user,
      folders: folders,
      files: files,
      currentFolder: null, // We're at root
    });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).send("Error loading drive");
  }
});

// Add this route AFTER the /drive route but BEFORE module.exports

router.get("/drive/:folderId", ensureAuth, async (req, res) => {
  const folderId = parseInt(req.params.folderId);

  try {
    // Get the current folder
    const currentFolder = await prisma.folder.findUnique({
      where: {
        id: folderId,
        userId: req.user.id,
      },
    });

    if (!currentFolder) {
      return res.status(404).send("Folder not found");
    }

    // Get subfolders in this folder
    const folders = await prisma.folder.findMany({
      where: {
        parentId: folderId,
        userId: req.user.id,
      },
      orderBy: { createdAt: "desc" },
    });

    // Get files in this folder
    const files = await prisma.file.findMany({
      where: {
        folderId: folderId,
        userId: req.user.id,
      },
      orderBy: { createdAt: "desc" },
    });

    // For now, just render the same drive template
    // You can create a separate folder-view template later
    res.render("drive", {
      user: req.user,
      folders: folders,
      files: files,
      currentFolder: currentFolder,
    });
  } catch (error) {
    console.error("Error loading folder:", error);
    res.status(500).send("Error loading folder");
  }
});

router.get("/file/:fileId", ensureAuth, async (req, res) => {
  const fileId = parseInt(req.params.fileId);

  // Check if fileId is valid
  if (isNaN(fileId)) {
    return res.status(400).send("Invalid file ID");
  }

  try {
    const file = await prisma.file.findUnique({
      where: {
        id: fileId,
        userId: req.user.id,
      },
      include: {
        folder: true,
      },
    });

    if (!file) {
      return res.status(404).send("File not found");
    }

    res.render("file-details", {
      user: req.user,
      file: file,
    });
  } catch (error) {
    console.error("Error loading file:", error);
    res.status(500).send("Error loading file");
  }
});

// Download file
router.get("/file/:fileId/download", ensureAuth, async (req, res) => {
  const fileId = parseInt(req.params.fileId);
  console.log("Download requested for file ID:", fileId);
  console.log("Raw params:", req.params);

  // Check if fileId is valid
  if (isNaN(fileId)) {
    console.log("Invalid file ID:", req.params.fileId);
    return res.status(400).send("Invalid file ID");
  }

  try {
    const file = await prisma.file.findUnique({
      where: {
        id: fileId,
        userId: req.user.id,
      },
    });

    if (!file) {
      console.log("File not found in database");
      return res.status(404).send("File not found");
    }

    console.log("File found:", {
      name: file.name,
      path: file.path,
      cloudUrl: file.cloudUrl,
    });

    // Check if it's a cloud file
    if (file.cloudUrl || (file.path && file.path.includes("cloudinary"))) {
      console.log("Cloud file detected, redirecting...");
      const fileUrl = file.cloudUrl || file.path;

      // For Cloudinary, add fl_attachment to force download
      let downloadUrl = fileUrl;
      if (fileUrl.includes("cloudinary.com") && fileUrl.includes("/upload/")) {
        downloadUrl = fileUrl.replace("/upload/", "/upload/fl_attachment/");
      }

      return res.redirect(downloadUrl);
    } else {
      // Local file
      console.log("Local file detected");
      if (!fs.existsSync(file.path)) {
        console.log("File not found at:", file.path);
        return res.status(404).send("File not found on server");
      }

      return res.download(file.path, file.name);
    }
  } catch (error) {
    console.error("Error in download route:", error);
    res.status(500).send("Error downloading file");
  }
});

// Add this debug route to check your files
router.get("/debug/files", ensureAuth, async (req, res) => {
  try {
    const files = await prisma.file.findMany({
      where: { userId: req.user.id },
      select: {
        id: true,
        name: true,
        path: true,
        cloudUrl: true,
        createdAt: true,
      },
    });

    res.json({
      totalFiles: files.length,
      files: files,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/log-out", (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

module.exports = router;
