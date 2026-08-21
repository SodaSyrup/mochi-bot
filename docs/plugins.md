# Built-in plugins

Mochi uses an explicit built-in plugin catalog. A plugin groups feature commands, Discord event handlers, services, dashboard routes and pages, realtime mappings, migrations, and lifecycle hooks.

Mochi does not scan writable directories, install plugins at runtime, or load third-party plugin code.

## Catalog

The initial catalog contains:

- `utility`
- `invites`
- `invite-logs`
- `safety`
- `honeypot`

Disable built-in plugins globally with a comma-separated `DISABLED_PLUGINS` value, for example:

```dotenv
DISABLED_PLUGINS=honeypot,safety
```

Dependencies are strict. For example, disabling `invites` while `invite-logs` is enabled is a startup error. The dashboard also provides per-guild enable/disable controls for built-in plugins.

## Manifest and lifecycle

A plugin manifest contains an ID, name, version, API version, dependency list, and a `register(context)` function. Contributions are registered through scoped `services`, `commands`, `discordEvents`, `dashboardApi`, `pages`, and `realtime` registries.

Plugin IDs and command names must be unique. Missing or circular dependencies fail startup.

At startup Mochi validates every manifest, checks dependencies, registers contributions, runs enabled plugin migrations, and starts plugins in dependency order. During shutdown it stops successfully started plugins in reverse order, detaches their listeners, and continues cleanup if a stop hook fails.

## Plugin migrations

Plugin migrations are namespaced by plugin ID and recorded in `plugin_schema_migrations`. They run in ascending version order, and each migration plus its record is committed in one transaction. There are no automatic down migrations.

Disabled plugins do not run migrations, and their existing tables are never removed. See [Deployment and operations](operations.md#migrations) for the production migration policy.
