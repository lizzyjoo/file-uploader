const express = require("express");
const session = require("express-session");
const { PrismaSessionStore } = require("@quixo3/prisma-session-store");
// const pool = require("./config/database");
const passport = require("passport");
const routes = require("./routes/index");

console.log("Routes loaded:", !!routes);
console.log("Routes type:", typeof routes);

const path = require("path");
const { Cookie } = require("express-session");

/**
 * -------------- GENERAL SETUP ----------------
 */

// Gives us access to variables set in the .env file via `process.env.VARIABLE_NAME` syntax
require("dotenv").config();

const app = express();
const prisma = require("./prisma");

// ADD THIS - Global request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.method === "POST") {
    console.log("POST Body:", req.body);
  }
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/**
 * -------------- UPLOADS SETUP ----------------
 */

/**
 * -------------- VIEWS SETUP ----------------
 */

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

/**
 * -------------- STYLES SETUP ----------------
 */

app.use(express.static(path.join(__dirname, "public")));

/**
 * -------------- SESSION SETUP ----------------
 */

app.use(
  session({
    store: new PrismaSessionStore(prisma, {
      checkPeriod: 2 * 60 * 1000, //ms
      dbRecordIdIsSessionId: true,
      dbRecordIdFunction: undefined,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }, // a day
  })
);

/**
 * -------------- PASSPORT AUTHENTICATION ----------------
 *
 */

require("./config/passport");
app.use(passport.initialize()); // refresh passport middleware every route refresh
app.use(passport.session()); // enable session support

/**
 * -------------- ROUTES ----------------
 */

// Your existing routes
console.log("About to add routes middleware...");
app.use("/", routes);
console.log("Routes middleware added");

/**
 * -------------- SERVER ----------------
 */

// Server listens on http://localhost:3000

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
