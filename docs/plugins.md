# Plugin-first runtime

Mochi discovers built-ins from their `mochi.plugin.json` manifests and can load
external plugin packages without changes to the host source tree. Set
`MOCHI_PLUGIN_PATHS` to a comma-separated list of package directories or
manifest files. Discovery is deterministic. It uses manifest `order`, then the
plugin ID. Mochi rejects duplicate IDs and validates entrypoint containment. It
stops startup for missing or invalid packages. Plugins load at startup.
Installation and package manager rules remain deployment tasks.

A plugin owns its commands, Discord event handlers, services, dashboard routes,
pages and assets, real-time mappings, capabilities, jobs, migrations, and
lifecycle hooks. The host owns process startup, shared platform adapters,
authentication and sessions, and contribution mounting.

## Catalog

The initial catalog contains:

- `utility`
- `invites`
- `invite-logs`
- `safety`
- `honeypot`
- `global-bans`
- `permission-groups`

Disable built-in plugins globally with a comma-separated `DISABLED_PLUGINS` value. For example:

```dotenv
DISABLED_PLUGINS=honeypot,safety
```

Dependencies are strict. For example, disabling `invites` while `invite-logs` is
enabled causes a startup error. The dashboard also provides per-server enable
and disable controls for built-in plugins.

Global installation and server policy are separate. A globally installed plugin
is available to every server unless its manifest sets `defaultEnabled: false`. A
server setting overrides that default when `guildConfigurable` is true.
Application configuration and disabled dependencies always take precedence. A
plugin with `guildConfigurable: false` follows its declared default and cannot be
changed in the dashboard.

## Manifest and lifecycle

A plugin manifest contains an ID, name, version, API version, and optional
`entry`, `requires`, `defaultEnabled`, and `guildConfigurable` fields. The
entrypoint can import the public SDK from `mochi-bot/plugin-api` (or the local
`src/plugins/sdk` during development):

```ts
import { definePlugin } from 'mochi-bot/plugin-api';

export default definePlugin({
  manifest: { id: 'weather', name: 'Weather', version: '1.0.0', apiVersion: 1 },
  register(context) {
    context.services.provide?.({
      key: 'weather.service', eager: true,
      create: ({ services, config }) => createWeatherService(services, config),
    });
    context.pages.register({ id: 'weather', path: '/weather', file: 'index.html' });
  },
});
```

Contributions are registered through the scoped `services`, `commands`,
`discordEvents`, `dashboardApi`, `pages`, `assets`, `realtime`, `capabilities`,
and `jobs` registries. Service providers are resolved by the sealed host
container, with dependency-cycle detection and eager initialization. Dashboard
clients can use `/api/ui-manifest` to find plugin pages and assets.

Plugin IDs and command names must be unique. Missing or circular dependencies fail startup.

Registration may be asynchronous. The host waits for each plugin before it
exposes its contributions. At startup, Mochi validates every manifest, checks
dependencies, registers contributions, runs enabled plugin migrations, and
starts plugins in dependency order.

Migration callbacks must be synchronous because Bun SQLite transactions are
synchronous. Mochi rejects an accidental thenable and does not write a
migration record. During shutdown, Mochi stops started plugins in reverse order,
detaches their listeners, and continues cleanup if a stop hook fails.

## Plugin migrations

Plugin migrations use the plugin ID as their namespace and are recorded in
`plugin_schema_migrations`. They run in ascending version order. Each migration
and its record are committed in one transaction. Mochi does not run down
migrations.

Disabled plugins do not run migrations. Mochi does not remove their existing
tables. See [Deployment and operations](operations.md#migrations) for the
production migration policy.
