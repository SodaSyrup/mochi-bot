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

/**
 * Express + Socket.IO dashboard server. Owns HTTP middleware/session config,
 * mounts routes, and bridges application events to authorized guild rooms.
 * It does not contain business logic.
 */
class DashboardServer {
  constructor({ client = null, services = null, config, logger, sessionStore = null }) {
    this.client = client;
    this.services = services;
    this.config = config;
    this.logger = logger || console;

    this.app = express();
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

    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  setupRoutes() {
    const authRoutes = createAuthRoutes({
      oauthClient: this.services?.oauthClient,
      config: this.config,
      logger: this.logger,
    });
    const apiRoutes = createApiRouter({
      client: this.client,
      config: this.config,
      services: this.services,
    });

    this.app.use('/auth', authRoutes);
    this.app.use('/api', apiRoutes);

    const pagesDir = path.join(__dirname, 'public', 'pages');
    const page = (file) => (req, res) => res.sendFile(path.join(pagesDir, file));

    this.app.get('/', page('overview.html'));
    this.app.get('/analytics', page('analytics.html'));
    this.app.get('/leaderboard', page('leaderboard.html'));
    this.app.get('/codes', page('codes.html'));
    this.app.get('/safety', page('safety.html'));
    this.app.get('/honeypot', page('honeypot.html'));
    this.app.get('/settings', page('settings.html'));

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
    this.io.close();
    this.sessionStore?.close?.();
    if (!this.server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

module.exports = DashboardServer;
