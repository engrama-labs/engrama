import express from 'express';
import cors from 'cors';
import { config, validateConfig } from './config';
import { errorHandler } from './middleware/errorHandler';
import { optionalAuth } from './middleware/auth';
import { generalRateLimit } from './middleware/rateLimit';
import { initializeVectorCollection } from './db';

// Import routes
import authRouter from './api/auth';
import rememberRouter from './api/remember';
import recallRouter from './api/recall';
import assemblePromptRouter from './api/assemblePrompt';
import memoriesRouter from './api/memories';
import graphRouter from './api/graph';
import analyticsRouter from './api/analytics';
import chatRouter from './api/chat';

// Validate configuration
validateConfig();

const app = express();

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In development, allow all localhost ports
    if (config.nodeEnv === 'development') {
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        return callback(null, true);
      }
    }
    
    // In production, use configured origin
    const allowedOrigins = config.cors.origin.split(',').map(o => o.trim());
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use(generalRateLimit);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Auth routes (public)
app.use('/api/auth', authRouter);

// API routes with optional auth (for backward compatibility and testing)
// In production, you may want to require authentication
app.use('/api/remember', optionalAuth, rememberRouter);
app.use('/api/recall', optionalAuth, recallRouter);
app.use('/api/assemble_prompt', optionalAuth, assemblePromptRouter);
app.use('/api/memories', optionalAuth, memoriesRouter);
app.use('/api/graph', optionalAuth, graphRouter);
app.use('/api/analytics', optionalAuth, analyticsRouter);
app.use('/api/chat', optionalAuth, chatRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Endpoint not found',
      path: req.path,
    },
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Initialize database and start server
async function startServer() {
  try {
    // Initialize vector collection
    console.log('Initializing vector database...');
    await initializeVectorCollection();
    console.log('Vector database initialized');
    
    // Start server
    app.listen(config.port, () => {
      console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🧠 Memory Engine Server                                ║
║                                                           ║
║   Status: Running                                        ║
║   Port: ${config.port}                                            ║
║   Environment: ${config.nodeEnv}                        ║
║                                                           ║
║   Endpoints:                                             ║
║   • POST /api/remember                                   ║
║   • POST /api/recall                                     ║
║   • POST /api/assemble_prompt                            ║
║   • GET  /api/memories                                   ║
║   • GET  /api/graph                                      ║
║   • GET  /api/analytics                                  ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;






