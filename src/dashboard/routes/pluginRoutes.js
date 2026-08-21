const express = require('express');
const { ValidationError } = require('../errors');

function createPluginRoutes({ pluginSettings }) {
  const router = express.Router({ mergeParams: true });

  router.get('/', (req, res) => {
    res.json({ plugins: pluginSettings.list(req.params.guildId) });
  });

  router.patch('/:pluginId', (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') {
      throw new ValidationError('enabled must be a boolean.');
    }
    const plugin = pluginSettings.setEnabled(
      req.params.guildId,
      req.params.pluginId,
      req.body.enabled
    );
    res.json({ success: true, plugin });
  });

  return router;
}

module.exports = { createPluginRoutes };
