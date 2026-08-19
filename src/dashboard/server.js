const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const EventEmitter = require('events');
const config = require('../config');

class DashboardServer {
  constructor(botClient) {
    this.botClient = botClient;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PATCH']
      }
    });

    // Bridge for bot events
    this.emitter = new EventEmitter();
    if (this.botClient) {
      this.botClient.dashboardEmitter = this.emitter;
    }

    this.setupMiddlewares();
    this.setupSockets();
    this.setupRoutes();
  }

  setupMiddlewares() {
    this.app.use(cors());
    this.app.use(morgan('dev'));
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());
    this.app.use(
      session({
        secret: config.dashboard.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 days
      })
    );

    // Serve public static assets
    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  setupSockets() {
    this.io.on('connection', socket => {
      // Allow dashboard to join specific guild rooms for scoped real-time live events
      socket.on('joinGuild', guildId => {
        socket.join(`guild_${guildId}`);
      });

      socket.on('leaveGuild', guildId => {
        socket.leave(`guild_${guildId}`);
      });
    });

    // Forward bot events to WebSocket clients
    this.emitter.on('memberJoin', data => {
      this.io.to(`guild_${data.guildId}`).emit('memberJoin', data);
      this.io.emit('memberJoin', data);
    });

    this.emitter.on('memberLeave', data => {
      this.io.to(`guild_${data.guildId}`).emit('memberLeave', data);
      this.io.emit('memberLeave', data);
    });

    this.emitter.on('autoModExecution', data => {
      this.io.to(`guild_${data.guildId}`).emit('autoModExecution', data);
      this.io.emit('autoModExecution', data);
    });

    this.emitter.on('autoModRuleUpdated', data => {
      this.io.to(`guild_${data.guildId}`).emit('autoModRuleUpdated', data);
      this.io.emit('autoModRuleUpdated', data);
    });
  }

  setupRoutes() {
    const authRoutes = require('./routes/auth');
    const apiRoutes = require('./routes/api')(this.botClient, this.io);

    this.app.use('/auth', authRoutes);
    this.app.use('/api', apiRoutes);

    const pagesDir = path.join(__dirname, 'public', 'pages');

    // Multi-Page App (MPA) Routes
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(pagesDir, 'overview.html'));
    });

    this.app.get('/analytics', (req, res) => {
      res.sendFile(path.join(pagesDir, 'analytics.html'));
    });

    this.app.get('/leaderboard', (req, res) => {
      res.sendFile(path.join(pagesDir, 'leaderboard.html'));
    });

    this.app.get('/codes', (req, res) => {
      res.sendFile(path.join(pagesDir, 'codes.html'));
    });

    this.app.get('/safety', (req, res) => {
      res.sendFile(path.join(pagesDir, 'safety.html'));
    });

    this.app.get('/simulator', (req, res) => {
      res.sendFile(path.join(pagesDir, 'simulator.html'));
    });

    this.app.get('/settings', (req, res) => {
      res.sendFile(path.join(pagesDir, 'settings.html'));
    });

    // 404 Route for unknown paths
    this.app.use((req, res) => {
      res.status(404).sendFile(path.join(pagesDir, '404.html'));
    });
  }

  start(port = config.dashboard.port) {
    return new Promise((resolve, reject) => {
      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`\n❌ [Dashboard] Port ${port} is already in use by another running instance.`);
          console.error(`💡 Tip: Stop previous background processes or change PORT=${port + 1} in /home/mochi/.env\n`);
        }
        reject(err);
      });

      this.server.listen(port, () => {
        console.log(`[Dashboard] 🍡 Web Dashboard running at: ${config.dashboard.url}`);
        resolve(this.server);
      });
    });
  }
}

module.exports = DashboardServer;
