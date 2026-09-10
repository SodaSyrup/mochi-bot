import { definePlugin } from '../../../src/plugins/sdk';

export default definePlugin({
  manifest: {
    id: 'external-fixture',
    name: 'External Fixture',
    version: '1.0.0',
    apiVersion: 1,
    requires: [],
  },
  register(context) {
    context.services.provide?.({
      key: 'external-fixture.value',
      eager: true,
      create: () => ({ ready: true }),
    });
    context.pages.register({ id: 'external-fixture', path: '/external-fixture', file: 'index.html' });
    context.assets.register({ id: 'external-fixture-assets', root: './assets', mountPath: '/plugins/external-fixture/assets' });
  },
});
