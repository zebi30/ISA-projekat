const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");
const { v4: uuidv4 } = require("uuid");

const TMP_DIR = path.join(__dirname, "..", "uploads", "tmp");

fs.ensureDirSync(TMP_DIR);

// 200MB limit za video + npr. 10MB thumbnail
const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      await fs.ensureDir(TMP_DIR);
      cb(null, TMP_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: {
    fileSize: 210 * 1024 * 1024, // malo buffer (video max 200MB + overhead)
  },
  fileFilter: (req, file, cb) => {
    const isVideo = file.fieldname === "video";
    const isThumb = file.fieldname === "thumbnail";

    if (isVideo) {
      if (file.mimetype !== "video/mp4") return cb(new Error("Video mora biti mp4."));
      return cb(null, true);
    }

    if (isThumb) {
      if (!file.mimetype.startsWith("image/")) return cb(new Error("Thumbnail mora biti slika."));
      return cb(null, true);
    }

    cb(new Error("Nepoznat upload field."));
  },
});

module.exports = { upload, TMP_DIR };
