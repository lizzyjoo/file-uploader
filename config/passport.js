const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const prisma = require("../prisma");
const bcrypt = require("bcrypt");

passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const user = await prisma.user.findUnique({
        where: {
          username: username,
        },
      });

      // 2. check for if user doesn't exist
      if (!user) {
        return done(null, false, { message: "Incorrect Username" });
      }
      // 3. password validation
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return done(null, false, { message: "Incorrect password" });
      }
      return done(null, user);
    } catch (error) {
      return done(error);
    }
  })
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: id,
      },
    });
    // If user doesn't exist (was deleted), log them out
    if (!user) {
      return done(null, false);
    }
    done(null, user);
  } catch (err) {
    return done(err);
  }
});
