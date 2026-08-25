const express = require('express');

function createPermissionGroupRoutes({ permissionGroupService }) {
  const router = express.Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    res.json(await permissionGroupService.dashboard(req.params.guildId));
  });

  router.post('/', async (req, res) => {
    const group = await permissionGroupService.create(req.params.guildId, req.body || {});
    res.status(201).json({ success: true, group });
  });

  router.patch('/:groupId', async (req, res) => {
    const group = await permissionGroupService.update(req.params.guildId, req.params.groupId, req.body || {});
    res.json({ success: true, group });
  });

  router.post('/:groupId/sync', async (req, res) => {
    const group = await permissionGroupService.sync(req.params.guildId, req.params.groupId);
    res.json({ success: true, group });
  });

  router.delete('/:groupId', async (req, res) => {
    await permissionGroupService.delete(req.params.guildId, req.params.groupId);
    res.json({ success: true });
  });

  return router;
}

module.exports = { createPermissionGroupRoutes };
