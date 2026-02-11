const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const {
  registerValidator,
  loginValidator,
} = require("../validators/auth.validator");
const { handleValidationErrors } = require("../middlewares/validation");
const { authLimiter } = require("../middlewares/security");
const { requireAuth } = require("../middlewares/auth");

router.post(
  "/register",
  authLimiter,
  registerValidator,
  handleValidationErrors,
  authController.register,
);

router.post(
  "/login",
  authLimiter,
  loginValidator,
  handleValidationErrors,
  authController.login,
);

router.post("/logout", requireAuth, authController.logout);

router.get("/me", requireAuth, authController.getCurrentUser);

module.exports = router;
