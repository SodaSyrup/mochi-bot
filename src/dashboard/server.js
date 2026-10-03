const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const session = require('express-session');
const morgan = require('morgan');

const { SocketGateway } = require('./realtime/socketGateway');
const { SqliteSessionStore } = require('./auth/sqliteSessionStore');
const { createAuthRoutes } = require('./routes/authRoutes');
const { createApiRouter } = require('./routes/api');
const { apiErrorHandler, apiNotFound } = require('./routes/errorMiddleware');
const { PluginRegistrationError } = require('../plugins/core/errors');
const { requireAuth } = require('./auth/requireAuth');
const { requireCapability } = require('./auth/requireCapability');

/**
 * Express + Socket.IO dashboard server. Owns HTTP middleware/session config,
 * mounts routes, and bridges application events to authorized guild rooms.
 * It does not contain business logic.
 */
class DashboardServer {
  constructor({ client = null, services = null, config, logger, sessionStore = null, contributions = null, capabilities = null }) {
    this.client = client;
    this.services = services;
    this.config = config;
    this.logger = logger || console;
    this.contributions = contributions;
    this.capabilities = capabilities;

    this.app = express();
    // Production traffic is terminated by the dashboard's reverse proxy.
    // Express must trust that single hop so req.secure reflects
    // X-Forwarded-Proto=https; otherwise express-session silently refuses to
    // emit the production-only Secure cookie and every OAuth callback loses
    // the session that contains its state value.
    if (config.app.isProduction) this.app.set('trust proxy', 1);
    this.server = http.createServer(this.app);

    this.sessionStore = sessionStore || new SqliteSessionStore({
      path: config.dashboard.sessionStorePath,
      ttlMs: config.dashboard.sessionTtlMs,
    });
    this.sessionMiddleware = session({
      name: config.dashboard.sessionCookieName,
      secret: config.dashboard.sessionSecret,
      store: this.sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.app.isProduction,
        maxAge: config.dashboard.sessionTtlMs,
      },
    });

    const corsOptions = config.app.isProduction
      ? { origin: [config.dashboard.url], credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] }
      : { origin: true, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] };

    this.io = new Server(this.server, { cors: corsOptions });

    this.setupMiddlewares();

    // Socket gateway subscribes to application events and authorizes rooms
    // using the server-side session. Never trusts client-supplied guild ids.
    this.socketGateway = new SocketGateway({
      io: this.io,
      eventBus: this.services?.eventBus,
      guildAccess: this.services?.guildAccess,
      logger: this.logger,
      contributions: this.contributions,
      pluginSettings: this.services?.pluginSettings,
      sessionStore: this.sessionStore,
    });

    this.setupRoutes();
  }

  setupMiddlewares() {
    if (process.env.NODE_ENV !== 'test') {
      this.app.use(morgan('dev'));
    }
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(this.sessionMiddleware);

    // Share the same session store with Socket.IO so sockets can read the
    // authenticated Express session for room authorization.
    this.io.engine.use(this.sessionMiddleware);

    // HTML pages are served through named routes so page-level authorization
    // cannot be bypassed through /pages/*.html. CSS and JavaScript remain public.
    this.app.use('/pages', (req, res) => res.status(404).send('Not found'));
    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  setupRoutes() {
    const authRoutes = createAuthRoutes({
      oauthClient: this.services?.oauthClient,
      config: this.config,
      logger: this.logger,
      invalidateSession: (sid) => this.socketGateway?.invalidateSession(sid),
    });
    const apiRoutes = createApiRouter({
      client: this.client,
      config: this.config,
      services: this.services,
      contributions: this.contributions,
      capabilities: this.capabilities,
    });

    this.app.use('/auth', authRoutes);
    this.app.use('/api', apiRoutes);

    const pagesDir = path.join(__dirname, 'public', 'pages');
    const page = (file) => (_req, res) => res.sendFile(file);
    this.app.get('/', page(path.join(pagesDir, 'landing.html')));
    const pageAccess = (access) => {
      if (!access || access.kind === 'public') return [];
      if (access.kind === 'capability') return [requireAuth, requireCapability(access.capability, this.capabilities)];
      return [requireAuth];
    };

    const pageContributions = this.contributions?.getPageContributions?.() || [];
    if (this.contributions) {
      for (const descriptor of pageContributions) {
        if (typeof descriptor.render === 'function') {
          this.app.get(descriptor.path, ...pageAccess(descriptor.access), descriptor.render);
          continue;
        }
        const pluginRoot = descriptor.sourceRoot ? path.resolve(descriptor.sourceRoot) : null;
        const builtinRoot = path.resolve(__dirname, '../plugins/builtins');
        const isBuiltin = pluginRoot && isWithin(builtinRoot, pluginRoot);
        const candidateRoot = pluginRoot && fsExists(path.join(pluginRoot, descriptor.file))
          ? pluginRoot
          : (!pluginRoot || isBuiltin) ? pagesDir : pluginRoot;
        const resolved = path.resolve(candidateRoot, descriptor.file);
        if (!isWithin(candidateRoot, resolved)) {
          throw new PluginRegistrationError(`Dashboard page "${descriptor.id}" resolves outside its approved package root.`, {
            pluginId: descriptor.pluginId,
          });
        }
        this.app.get(descriptor.path, ...pageAccess(descriptor.access), page(resolved));
      }
    } else {
      // Compatibility path for direct DashboardServer construction without a
      // plugin registry; normal application startup uses page contributions.
      this.app.get('/dashboard', page(path.join(pagesDir, 'overview.html')));
      this.app.get('/analytics', page(path.join(pagesDir, 'analytics.html')));
      this.app.get('/leaderboard', page(path.join(pagesDir, 'leaderboard.html')));
      this.app.get('/codes', page(path.join(pagesDir, 'codes.html')));
      this.app.get('/safety', page(path.join(pagesDir, 'safety.html')));
      this.app.get('/honeypot', page(path.join(pagesDir, 'honeypot.html')));
      this.app.get('/settings', page(path.join(pagesDir, 'settings.html')));
    }
    this.app.get('/plugins', page(path.join(pagesDir, 'plugins.html')));

    // Plugin-owned static files are mounted only from declared package roots.
    // This lets an external plugin ship its own CSS/JS/images without copying
    // assets into the host dashboard directory.
    for (const asset of this.contributions?.getAssetContributions?.() || []) {
      const root = path.resolve(asset.sourceRoot || process.cwd(), asset.root);
      if (!fsExists(root) || (asset.sourceRoot && !isWithin(asset.sourceRoot, root))) {
        throw new PluginRegistrationError(`Dashboard asset "${asset.id}" has an invalid root.`, { pluginId: asset.pluginId });
      }
      this.app.use(asset.mountPath || `/plugins/${asset.pluginId}/assets`, express.static(root, { fallthrough: false }));
    }

    // JSON 404 for unknown API endpoints, HTML 404 for everything else.
    this.app.use('/api', apiNotFound);
    this.app.use((req, res) => res.status(404).sendFile(path.join(pagesDir, '404.html')));

    // Centralized error handling (AppError -> predictable JSON).
    this.app.use(apiErrorHandler);
  }

  start(port = this.config.dashboard.port) {
    return new Promise((resolve, reject) => {
      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`\n❌ [Dashboard] Port ${port} is already in use by another running instance.`);
          console.error(`💡 Tip: Stop previous background processes or change PORT=${port + 1} in .env\n`);
        }
        reject(err);
      });

      this.server.listen(port, () => {
        console.log(`[Dashboard] 🍡 Web Dashboard running at: ${this.config.dashboard.url}`);
        resolve(this.server);
      });
    });
  }

  stop() {
    this.socketGateway?.stop?.();
    this.io.close();
    this.sessionStore?.close?.();
    if (!this.server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

const fsExists = (target) => {
  try { require('fs').statSync(target); return true; } catch { return false; }
};
const isWithin = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

module.exports = DashboardServer;
