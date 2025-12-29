import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import routes from './routes/index.js';
import errorHandler from './middleware/errorHandler.js';
import './services/cronService.js';

const app = express();

// Trust proxy for deployment behind reverse proxy (Render, Heroku, etc.)
app.set('trust proxy', 1);

// Security Headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Compression
app.use(compression());

// Rate Limiting - with validation disabled for proxy environments
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { success: false, message: 'Quá nhiều request, vui lòng thử lại sau' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false } // Disable X-Forwarded-For validation
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 login attempts per hour
  message: { success: false, message: 'Quá nhiều lần đăng nhập thất bại, vui lòng thử lại sau 1 giờ' },
  validate: { xForwardedForHeader: false }
});

app.use('/api', limiter);
app.use('/api/auth/login', authLimiter);

// CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3001', 'http://localhost:8080'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    // Allow all origins in production or check allowedOrigins
    if (process.env.NODE_ENV === 'production' || allowedOrigins.some(o => origin.startsWith(o.replace(/:\d+$/, '')))) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Parse JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Routes
app.use('/api', routes);

// Health check
app.get('/', (req, res) => {
  res.json({ 
    message: 'LMS API Server',
    version: '3.0.0',
    status: 'running',
    env: process.env.NODE_ENV || 'development'
  });
});

// Error handler
app.use(errorHandler);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 API Server: http://localhost:${PORT}`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
});
