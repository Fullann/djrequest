const { body, param, query } = require('express-validator');

const createEventValidator = [
  body('name')
    .trim()
    .notEmpty().withMessage('Le nom de l\'événement est requis')
    .isLength({ min: 3, max: 100 }).withMessage('Le nom doit contenir entre 3 et 100 caractères')
];

const eventIdValidator = [
  param('eventId')
    .notEmpty().withMessage('ID événement requis')
    .isUUID().withMessage('ID événement invalide')
];

const updateRateLimitValidator = [
  ...eventIdValidator,
  body('max')
    .isInt({ min: 1, max: 50 }).withMessage('Max doit être entre 1 et 50'),
  body('window')
    .isInt({ min: 1, max: 120 }).withMessage('Window doit être entre 1 et 120 minutes')
];

const toggleVotesValidator = [
  ...eventIdValidator,
  body('enabled')
    .isBoolean().withMessage('enabled doit être un booléen')
];

const spotifySearchValidator = [
  query('q')
    .trim()
    .notEmpty().withMessage('Query de recherche requise')
    .isLength({ min: 2, max: 100 }).withMessage('Query doit contenir entre 2 et 100 caractères'),
  query('eventId')
    .notEmpty().withMessage('EventId requis')
    .isUUID().withMessage('EventId invalide')
];

module.exports = {
  createEventValidator,
  eventIdValidator,
  updateRateLimitValidator,
  toggleVotesValidator,
  spotifySearchValidator
};
