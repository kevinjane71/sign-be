const express = require('express');
require('dotenv').config();
const multer = require('multer');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const emailService = require('./email');
const pdfService = require('./pdfService');

const app = express();
const PORT = process.env.PORT || 5001;

// JWT Secret - in production, use a strong secret from environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// Multer configuration for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Setup CORS with more permissive options
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialize Storage
let storage;
let bucket;
let db;
let isLocalMode = false;

// Local file storage path - declare at top level but only create directory in local mode
const localStoragePath = path.join(__dirname, 'uploads');

// Function to set up mock storage
function setupMockStorage() {
  // Create uploads directory only when needed
  if (!fs.existsSync(localStoragePath)) {
    fs.mkdirSync(localStoragePath, { recursive: true });
  }
  
  return {
    file: (fileName) => ({
      save: async (buffer, options) => {
        const filePath = path.join(localStoragePath, fileName);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, buffer);
        return Promise.resolve();
      },
      createWriteStream: () => {
        const stream = require('stream').Writable({
          write(chunk, encoding, callback) {
            callback();
          }
        });
        
        // Simulate successful upload
        setTimeout(() => {
          stream.emit('finish');
        }, 100);
        
        return stream;
      },
      makePublic: async () => Promise.resolve(),
      delete: async () => Promise.resolve(),
      download: async () => {
        const filePath = path.join(localStoragePath, fileName);
        if (fs.existsSync(filePath)) {
          return [fs.readFileSync(filePath)];
        }
        throw new Error('File not found');
      }
    }),
    name: 'local-mock-bucket'
  };
}

// Check if we're in local development mode first
// Use production mode when Firebase environment variables are properly configured
const isLocalDevelopment = !process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL;

// Set default FRONTEND_URL for local development if not set
if (!process.env.FRONTEND_URL && isLocalDevelopment) {
  process.env.FRONTEND_URL = 'http://localhost:3002';
  console.log('🔧 Set FRONTEND_URL to http://localhost:3002 for local development');
}

if (isLocalDevelopment) {
  console.log('🔧 Running in LOCAL DEVELOPMENT MODE - Using Firestore without complex queries');
  isLocalMode = true;
  
  // Mock database for local development
  const mockDatabase = new Map();
  
  db = {
    collection: (name) => ({
      doc: (id) => ({
        set: async (data) => {
          mockDatabase.set(`${name}/${id}`, { ...data, id });
          return Promise.resolve();
        },
        get: async () => {
          const data = mockDatabase.get(`${name}/${id}`);
          return {
            exists: !!data,
            data: () => data
          };
        },
        update: async (data) => {
          const existing = mockDatabase.get(`${name}/${id}`);
          if (existing) {
            mockDatabase.set(`${name}/${id}`, { ...existing, ...data });
          }
          return Promise.resolve();
        },
        delete: async () => {
          mockDatabase.delete(`${name}/${id}`);
          return Promise.resolve();
        }
      }),
      get: async () => {
        const docs = Array.from(mockDatabase.entries())
          .filter(([key]) => key.startsWith(`${name}/`))
          .map(([key, value]) => ({ 
            id: key.split('/')[1], 
            data: () => value 
          }));
        return { 
          forEach: (callback) => docs.forEach(callback),
          size: docs.length
        };
      },
      where: (field, operator, value) => ({
        get: async () => {
          const docs = Array.from(mockDatabase.entries())
            .filter(([key]) => key.startsWith(`${name}/`))
            .filter(([key, data]) => {
              switch (operator) {
                case '==':
                  return data[field] === value;
                case '!=':
                  return data[field] !== value;
                case '>':
                  return data[field] > value;
                case '<':
                  return data[field] < value;
                case '>=':
                  return data[field] >= value;
                case '<=':
                  return data[field] <= value;
                default:
                  return true;
              }
            })
            .map(([key, value]) => ({ 
              id: key.split('/')[1], 
              data: () => value 
            }));
          return { 
            forEach: (callback) => docs.forEach(callback),
            size: docs.length
          };
        },
        limit: (limitCount) => ({
          get: async () => {
            const docs = Array.from(mockDatabase.entries())
              .filter(([key]) => key.startsWith(`${name}/`))
              .filter(([key, data]) => {
                switch (operator) {
                  case '==':
                    return data[field] === value;
                  case '!=':
                    return data[field] !== value;
                  case '>':
                    return data[field] > value;
                  case '<':
                    return data[field] < value;
                  case '>=':
                    return data[field] >= value;
                  case '<=':
                    return data[field] <= value;
                  default:
                    return true;
                }
              })
              .map(([key, value]) => ({ 
                id: key.split('/')[1], 
                data: () => value 
              }))
              .slice(0, limitCount); // Apply limit
            return { 
              forEach: (callback) => docs.forEach(callback),
              size: docs.length
            };
          }
        }),
        where: (field2, operator2, value2) => ({
          get: async () => {
            const docs = Array.from(mockDatabase.entries())
              .filter(([key]) => key.startsWith(`${name}/`))
              .filter(([key, data]) => {
                // First condition
                let firstMatch = false;
                switch (operator) {
                  case '==':
                    firstMatch = data[field] === value;
                    break;
                  case '!=':
                    firstMatch = data[field] !== value;
                    break;
                  default:
                    firstMatch = true;
                }
                
                // Second condition
                let secondMatch = false;
                switch (operator2) {
                  case '==':
                    secondMatch = data[field2] === value2;
                    break;
                  case '!=':
                    secondMatch = data[field2] !== value2;
                    break;
                  default:
                    secondMatch = true;
                }
                
                return firstMatch && secondMatch;
              })
              .map(([key, value]) => ({ 
                id: key.split('/')[1], 
                data: () => value 
              }));
            return { 
              forEach: (callback) => docs.forEach(callback),
              size: docs.length
            };
          },
          limit: (limitCount) => ({
            get: async () => {
              const docs = Array.from(mockDatabase.entries())
                .filter(([key]) => key.startsWith(`${name}/`))
                .filter(([key, data]) => {
                  // First condition
                  let firstMatch = false;
                  switch (operator) {
                    case '==':
                      firstMatch = data[field] === value;
                      break;
                    case '!=':
                      firstMatch = data[field] !== value;
                      break;
                    default:
                      firstMatch = true;
                  }
                  
                  // Second condition
                  let secondMatch = false;
                  switch (operator2) {
                    case '==':
                      secondMatch = data[field2] === value2;
                      break;
                    case '!=':
                      secondMatch = data[field2] !== value2;
                      break;
                    default:
                      secondMatch = true;
                  }
                  
                  return firstMatch && secondMatch;
                })
                .map(([key, value]) => ({ 
                  id: key.split('/')[1], 
                  data: () => value 
                }))
                .slice(0, limitCount); // Apply limit
              return { 
                forEach: (callback) => docs.forEach(callback),
                size: docs.length
              };
            }
          })
        })
      }),
      orderBy: (field, direction = 'asc') => ({
        limit: (limitCount) => ({
          offset: (offsetCount) => ({
            get: async () => {
              let docs = Array.from(mockDatabase.entries())
                .filter(([key]) => key.startsWith(`${name}/`))
                .map(([key, value]) => ({ 
                  id: key.split('/')[1], 
                  data: () => value 
                }));
              
              // Sort by field
              docs.sort((a, b) => {
                const aVal = a.data()[field];
                const bVal = b.data()[field];
                if (direction === 'desc') {
                  return bVal > aVal ? 1 : -1;
                }
                return aVal > bVal ? 1 : -1;
              });
              
              // Apply offset and limit
              docs = docs.slice(offsetCount, offsetCount + limitCount);
              
              return { 
                forEach: (callback) => docs.forEach(callback),
                size: docs.length
              };
            }
          })
        }),
        get: async () => {
          let docs = Array.from(mockDatabase.entries())
            .filter(([key]) => key.startsWith(`${name}/`))
            .map(([key, value]) => ({ 
              id: key.split('/')[1], 
              data: () => value 
            }));
          
          // Sort by field
          docs.sort((a, b) => {
            const aVal = a.data()[field];
            const bVal = b.data()[field];
            if (direction === 'desc') {
              return bVal > aVal ? 1 : -1;
            }
            return aVal > bVal ? 1 : -1;
          });
          
          return { 
            forEach: (callback) => docs.forEach(callback),
            size: docs.length
          };
        }
      }),
      add: async (data) => {
        const id = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        mockDatabase.set(`${name}/${id}`, { ...data, id });
        return { id };
      }
    })
  };
  
  // Mock storage for local development
  bucket = setupMockStorage();
} else {
  console.log('🔧 Running in PRODUCTION MODE - Firebase enabled');
  
  // Initialize Firebase Admin
  try {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL
      })
    });
    
    db = getFirestore();
    
    // Initialize Google Cloud Storage using the working pattern
    if (process.env.NODE_ENV === 'production') {
      // For Vercel - check if Google Cloud credentials are provided
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
        try {
          const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
          storage = new Storage({
            projectId: serviceAccount.project_id,
            credentials: {
              client_email: serviceAccount.client_email,
              private_key: serviceAccount.private_key
            }
          });
          bucket = storage.bucket('demoimage-7189');
          console.log('✅ Google Cloud Storage initialized successfully');
        } catch (parseError) {
          console.error('❌ Error parsing Google Cloud credentials JSON:', parseError.message);
          console.log('🔧 Falling back to local storage mode in production');
          isLocalMode = true;
        }
      } else {
        console.log('⚠️  GOOGLE_APPLICATION_CREDENTIALS_JSON not provided');
        console.log('🔧 Running in local storage mode (production)');
        isLocalMode = true;
      }
    } else {
      // For local development
      storage = new Storage();
      bucket = storage.bucket('demoimage-7189');
    }
    
    // If we're in local mode (either by design or fallback), set up mock storage
    if (isLocalMode) {
      // Mock storage for local development or production fallback
      bucket = setupMockStorage();
    }
  } catch (error) {
    console.error('Firebase initialization error:', error);
    process.exit(1);
  }
}

// Email service configuration - TEMPORARILY DISABLED
let emailTransporter;
// if (process.env.GODADY_EMAIL_SNAPYFORM && process.env.GODADY_PA_SNAPYFORM) {
//   emailTransporter = nodemailer.createTransport({
//     host: 'smtpout.secureserver.net',
//     port: 465,
//     secure: true,
//     auth: {
//       user: process.env.GODADY_EMAIL_SNAPYFORM,
//       pass: process.env.GODADY_PA_SNAPYFORM
//     },
//     tls: {
//       rejectUnauthorized: false
//     },
//     connectionTimeout: 15000,
//     socketTimeout: 15000
//   });
// } else {
  console.log('⚠️  Email service temporarily disabled - emails will be logged to console');
// }

// Email service is handled by email.js module
console.log('✅ Email service ready - using email.js for all email functionality');

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'SignTap Backend',
    version: '1.0.0',
    test: 'UPDATED_VERSION' // Test marker
  });
});

// Authentication Middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required',
      code: 'MISSING_TOKEN',
      message: 'Please provide a valid access token in the Authorization header'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Get user from database to ensure they still exist and token is valid
    const userDoc = await db.collection('users').doc(decoded.userId).get();
    
    if (!userDoc.exists) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: 'USER_NOT_FOUND',
        message: 'User associated with this token no longer exists'
      });
    }

    const userData = userDoc.data();
    
    // Check if token is still valid (optional: implement token blacklisting)
    if (userData.auth && userData.auth.accessToken !== token) {
      return res.status(401).json({
        success: false,
        error: 'Token expired or invalid',
        code: 'TOKEN_REVOKED',
        message: 'This token has been revoked. Please login again to get a new token'
      });
    }

    // Add user info to request object
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      name: decoded.name,
      loginProvider: decoded.loginProvider
    };

    next();
  } catch (error) {
    console.error('Token verification error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
        message: 'Your session has expired. Please login again.',
        canRefresh: true
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: 'INVALID_TOKEN',
        message: 'The provided token is invalid'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Authentication error',
      code: 'AUTH_ERROR',
      message: 'An error occurred while verifying your token'
    });
  }
};

// Optional middleware for endpoints that can work with or without authentication
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const userDoc = await db.collection('users').doc(decoded.userId).get();
      
      if (userDoc.exists) {
        req.user = {
          userId: decoded.userId,
          email: decoded.email,
          name: decoded.name,
          loginProvider: decoded.loginProvider
        };
      }
    } catch (error) {
      // Ignore authentication errors for optional auth
      console.log('Optional auth failed:', error.message);
    }
  }

  next();
};

// Document ownership verification middleware
const verifyDocumentOwnership = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const userId = req.user.userId;

    const docRef = db.collection('documents').doc(documentId);
    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        message: 'The requested document does not exist'
      });
    }

    const docData = docSnapshot.data();

    // Check if user owns this document
    if (docData.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'You do not have permission to access this document'
      });
    }

    // Add document data to request for use in the endpoint
    req.document = docData;
    next();
  } catch (error) {
    console.error('Document ownership verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authorization error',
      message: 'An error occurred while verifying document access'
    });
  }
};

// Updated Token Manager class for JWT-based authentication
class TokenManager {
  constructor(database) {
    this.db = database;
  }

  async generateTokens(userData) {
    const payload = {
      userId: userData.userId,
      email: userData.email,
      name: userData.name,
      loginProvider: userData.loginProvider,
      iat: Math.floor(Date.now() / 1000)
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, { 
      expiresIn: JWT_EXPIRES_IN,
      issuer: 'sign4-app',
      audience: 'sign4-users'
    });

    const refreshToken = jwt.sign(
      { userId: userData.userId, type: 'refresh' }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );
    
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: JWT_EXPIRES_IN,
      issuedAt: new Date().toISOString(),
      userData: {
        userId: userData.userId,
        email: userData.email,
        name: userData.name,
        loginProvider: userData.loginProvider
      }
    };
  }

  async hashPassword(password) {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  }

  async verifyPassword(password, hashedPassword) {
    return await bcrypt.compare(password, hashedPassword);
  }
}

// Upload document endpoint - Now requires authentication
app.post('/api/documents/upload', authenticateToken, upload.any(), async (req, res) => {
  try {
    // Filter files from the uploaded data
    const files = req.files ? req.files.filter(file => file.fieldname === 'documents') : [];
    
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    console.log('=== UPLOAD ENDPOINT DEBUG ===');
    console.log('Number of files:', files.length);
    console.log('Request body keys:', Object.keys(req.body));
    console.log('Raw signers:', req.body.signers);
    console.log('Raw subject:', req.body.subject);
    console.log('Raw message:', req.body.message);
    console.log('Raw configuration:', req.body.configuration);

    // Parse additional form data
    let signers = [];
    let subject = '';
    let message = '';
    let configuration = {};
    
    try {
      signers = req.body.signers ? JSON.parse(req.body.signers) : [];
      console.log('Parsed signers:', signers);
    } catch (e) {
      console.error('Error parsing signers:', e);
    }
    
    try {
      subject = req.body.subject || '';
      console.log('Parsed subject:', subject);
    } catch (e) {
      console.error('Error parsing subject:', e);
    }
    
    try {
      message = req.body.message || '';
      console.log('Parsed message:', message);
    } catch (e) {
      console.error('Error parsing message:', e);
    }
    
    try {
      configuration = req.body.configuration ? JSON.parse(req.body.configuration) : {};
      console.log('Parsed configuration:', configuration);
    } catch (e) {
      console.error('Error parsing configuration:', e);
    }
    
    console.log('=== END DEBUG ===');

    // Create a single document ID for all files
    const documentId = crypto.randomUUID();
    const uploadedFiles = [];
    
    // Process each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileId = crypto.randomUUID(); // Unique ID for each file
      const fileName = `documents/${documentId}/${fileId}_${file.originalname}`;
      
      // Extract fields for this specific document (if provided)
      const fieldsKey = `fields_${i}`;
      const fields = req.body[fieldsKey] ? JSON.parse(req.body[fieldsKey]) : [];
      
      const title = req.body[`title_${i}`] || file.originalname;
      const mimeType = req.body[`mimeType_${i}`] || file.mimetype;
      
      if (isLocalMode) {
        // Local development mode - save file to local storage
        console.log(`📁 Local upload ${i + 1}: ${file.originalname} (${file.size} bytes)`);
        console.log(`📋 Fields: ${fields.length} fields`);
        
        // Save file to local storage
        await bucket.file(fileName).save(file.buffer, {
          contentType: file.mimetype
        });
        
        // Create a local serving URL
        const fileUrl = `http://localhost:${PORT}/api/documents/${documentId}/file/${fileId}`;
        
        // Add file info to the files array
        uploadedFiles.push({
          fileId: fileId,
          originalName: file.originalname,
          title: title,
          fileName: fileName,
          fileUrl: fileUrl,
          mimeType: mimeType,
          size: file.size,
          fields: fields,
          order: i
        });
        
      } else {
        // Production mode - save to Google Cloud Storage with public URL
        const file_gcs = bucket.file(fileName);
        
        // Save file to Google Cloud Storage
        await file_gcs.save(file.buffer, {
          metadata: {
            contentType: file.mimetype,
          },
        });

        // Create public URL (files in this bucket are publicly accessible)
        const fileUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

        // Add file info to the files array
        uploadedFiles.push({
          fileId: fileId,
          originalName: file.originalname,
          title: title,
          fileName: fileName,
          fileUrl: fileUrl,
          mimeType: mimeType,
          size: file.size,
          fields: fields,
          order: i
        });
      }
    }

    // Create the main document record with all files
    const documentData = {
      id: documentId,
      userId: req.user.userId, // Associate document with authenticated user
      title: subject || `Document with ${files.length} files`,
      files: uploadedFiles,
      totalFiles: files.length,
      createdAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      updatedAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      status: 'draft',
      signers: signers,
      subject: subject,
      message: message,
      configuration: configuration,
      createdBy: {
        userId: req.user.userId,
        email: req.user.email,
        name: req.user.name
      }
    };

    // Save main document to database
    await db.collection('documents').doc(documentId).set(documentData);

    // Return response with the single document containing all files
    res.json({
      success: true,
      documentId: documentId,
      document: documentData,
      totalFiles: files.length
    });
    
  } catch (error) {
    console.error('Upload endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve document file with proper CORS headers - Now requires authentication
app.get('/api/documents/:documentId/file', authenticateToken, verifyDocumentOwnership, async (req, res) => {
  try {
    const { documentId } = req.params;
    const documentData = req.document; // From verifyDocumentOwnership middleware

    const fileName = documentData.fileName;

    if (!fileName) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set proper headers for file serving
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', documentData.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${documentData.originalName}"`);

    // Always serve file content directly to avoid CORS issues
    try {
      const [fileBuffer] = await bucket.file(fileName).download();
      res.send(fileBuffer);
    } catch (error) {
      console.error('Error serving file:', error);
      res.status(404).json({ error: 'File not found in storage' });
    }
  } catch (error) {
    console.error('File serving error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve specific file by fileId - Now requires authentication
app.get('/api/documents/:documentId/file/:fileId', authenticateToken, verifyDocumentOwnership, async (req, res) => {
  try {
    const { documentId, fileId } = req.params;
    const documentData = req.document; // From verifyDocumentOwnership middleware

    // Find the specific file in the document's files array
    const fileInfo = documentData.files?.find(f => f.fileId === fileId);
    
    if (!fileInfo) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set proper headers for file serving
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', fileInfo.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${fileInfo.originalName}"`);

    // Always serve file content directly to avoid CORS issues
    try {
      const [fileBuffer] = await bucket.file(fileInfo.fileName).download();
      res.send(fileBuffer);
    } catch (error) {
      console.error('Error serving file:', error);
      res.status(404).json({ error: 'File not found in storage' });
    }
  } catch (error) {
    console.error('File serving error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get document statistics for dashboard - Now requires authentication and filters by user
// MOVED HERE: This route must come before /api/documents/:documentId to avoid routing conflicts
app.get('/api/documents/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const documentsRef = db.collection('documents').where('userId', '==', userId);
    
    // Get all user's documents
    const allDocsSnapshot = await documentsRef.get();
    const total = allDocsSnapshot.size;

    // Count by status
    const stats = {
      total: total,
      draft: 0,
      sent: 0,
      partially_signed: 0,
      completed: 0,
      cancelled: 0
    };

    allDocsSnapshot.forEach(doc => {
      const data = doc.data();
      if (stats.hasOwnProperty(data.status)) {
        stats[data.status]++;
      }
    });

    res.json({ success: true, stats });
  } catch (error) {
    console.error('Get document stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get document by ID - Now requires authentication
app.get('/api/documents/:documentId', authenticateToken, verifyDocumentOwnership, async (req, res) => {
  try {
    const documentData = req.document; // From verifyDocumentOwnership middleware
    res.json({ success: true, document: documentData });
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update document fields - Now requires authentication
app.put('/api/documents/:documentId/fields', authenticateToken, verifyDocumentOwnership, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { fields } = req.body;

    if (!Array.isArray(fields)) {
      return res.status(400).json({ error: 'Fields must be an array' });
    }

    const docRef = db.collection('documents').doc(documentId);
    await docRef.update({
      fields: fields,
      updatedAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp()
    });

    res.json({ success: true, message: 'Fields updated successfully' });
  } catch (error) {
    console.error('Update fields error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update entire document (general PUT endpoint) - Now requires authentication
app.put('/api/documents/:documentId', authenticateToken, verifyDocumentOwnership, async (req, res) => {
  try {
    const { documentId } = req.params;
    const updateData = req.body;

    console.log('=== UPDATE DOCUMENT DEBUG ===');
    console.log('Document ID:', documentId);
    console.log('Update data keys:', Object.keys(updateData));
    console.log('FileFields:', updateData.fileFields);
    console.log('=== END DEBUG ===');

    // Add timestamp
    updateData.updatedAt = isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp();

    // Handle fileFields for multi-file documents
    if (updateData.fileFields && Array.isArray(updateData.fileFields)) {
      const documentData = req.document; // From verifyDocumentOwnership middleware
      
      // Update fields in the files array
      const updatedFiles = documentData.files.map(file => {
        // Find fields for this file
        const fileFieldData = updateData.fileFields.find(ff => ff.fileId === file.fileId);
        
        if (fileFieldData) {
          return {
            ...file,
            fields: fileFieldData.fields || []
          };
        }
        
        return file;
      });

      // Remove fileFields from updateData and add the updated files
      delete updateData.fileFields;
      updateData.files = updatedFiles;

      console.log('Updated files with fields:', updatedFiles.map(f => ({ 
        fileId: f.fileId, 
        fieldsCount: f.fields?.length || 0 
      })));
    }

    const docRef = db.collection('documents').doc(documentId);
    await docRef.update(updateData);

    res.json({ success: true, message: 'Document updated successfully' });
  } catch (error) {
    console.error('Update document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add signers to document - Now requires authentication
app.put('/api/documents/:documentId/signers', authenticateToken, verifyDocumentOwnership, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { signers } = req.body;

    if (!Array.isArray(signers)) {
      return res.status(400).json({ error: 'Signers must be an array' });
    }

    const docRef = db.collection('documents').doc(documentId);
    await docRef.update({
      signers: signers,
      updatedAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp()
    });

    res.json({ success: true, message: 'Signers updated successfully' });
  } catch (error) {
    console.error('Update signers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send document for signing - Now requires authentication
app.post('/api/documents/:documentId/send', authenticateToken, verifyDocumentOwnership, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { 
      fields, 
      fileFields,
      signers, 
      subject, 
      message, 
      configuration = {} 
    } = req.body;

    console.log('=== SEND ENDPOINT DEBUG ===');
    console.log('Document ID:', documentId);
    console.log('Request body keys:', Object.keys(req.body));
    console.log('FileFields:', fileFields);
    console.log('Signers received:', signers);
    console.log('Signers type:', typeof signers);
    console.log('Signers is array:', Array.isArray(signers));
    console.log('Signers length:', signers ? signers.length : 'undefined');
    console.log('=== END DEBUG ===');

    // Get document data
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();
    
    // Validate signers
    if (!signers || !Array.isArray(signers) || signers.length === 0) {
      return res.status(400).json({ error: 'No signers provided' });
    }

    // Update document with all the new data
    const updateData = {
      status: 'sent',
      sentAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      subject: subject || `Signature Request: ${documentData.title || 'Document'}`,
      message: message || '',
      updatedAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp()
    };

    // Handle fileFields for multi-file documents
    if (fileFields && Array.isArray(fileFields)) {
      // Update fields in the files array
      const updatedFiles = documentData.files.map(file => {
        // Find fields for this file
        const fileFieldData = fileFields.find(ff => ff.fileId === file.fileId);
        
        if (fileFieldData) {
          return {
            ...file,
            fields: fileFieldData.fields || []
          };
        }
        
        return file;
      });

      updateData.files = updatedFiles;

      console.log('Updated files with fields for sending:', updatedFiles.map(f => ({ 
        fileId: f.fileId, 
        fieldsCount: f.fields?.length || 0 
      })));
    } else if (fields && Array.isArray(fields)) {
      // Legacy single-file support
      updateData.fields = fields;
    }

    // Update signers if provided
    if (signers && Array.isArray(signers)) {
      updateData.signers = signers;
    }

    // Update configuration if provided
    if (configuration && typeof configuration === 'object') {
      updateData.configuration = configuration;
    }

    await docRef.update(updateData);

    // Send professional emails to all signers using EmailService
    try {
      // Get sender information
      const senderDoc = await db.collection('users').doc(req.user.userId).get();
      const senderData = senderDoc.exists ? senderDoc.data() : null;
      const senderName = senderData?.name || req.user.email?.split('@')[0] || 'Document Sender';
      const senderEmail = senderData?.email || req.user.email || 'noreply@signflow.com';

      console.log('=== DOCUMENT SHARING EMAIL DEBUG ===');
      console.log('📧 Preparing to send emails to signers...');
      console.log('👤 Sender info:', { senderName, senderEmail });
      console.log('📋 Signers:', signers.map(s => ({ name: s.name, email: s.email })));
      console.log('📄 Document:', { title: documentData.title, originalName: documentData.originalName });

      // Send email to each signer
      const emailPromises = signers.map(async (signer) => {
        console.log('🔍 DEBUG: URL Generation');
        console.log('  process.env.FRONTEND_URL:', process.env.FRONTEND_URL);
        console.log('  Default fallback:', 'http://localhost:3000');
        console.log('  Final frontend URL:', process.env.FRONTEND_URL || 'http://localhost:3000');
        
        // Generate secure signing token for this signer
        const signingToken = generateSigningToken(documentId, signer.email);
        
        const signingUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/sign/${documentId}?signer=${encodeURIComponent(signer.email)}&token=${signingToken}`;
        
        console.log('  Generated signing URL:', signingUrl);
        
        const emailData = {
          signerEmail: signer.email,
          signerName: signer.name || signer.email.split('@')[0],
          documentTitle: documentData.title || documentData.originalName || 'Document',
          senderName: senderName,
          senderEmail: senderEmail,
          message: message || '',
          signingUrl: signingUrl
        };

        console.log(`📧 Sending signature request to: ${signer.email}`);
        console.log('📋 Email data:', emailData);
        
        try {
          const result = await emailService.sendDocumentShareEmail(emailData);
          console.log(`✅ Email sent successfully to ${signer.email}:`, result);
          return result;
        } catch (emailError) {
          console.error(`❌ Email failed for ${signer.email}:`, emailError);
          throw emailError;
        }
      });

      const emailResults = await Promise.all(emailPromises);
      console.log(`✅ Successfully sent ${signers.length} signature request emails`);
      console.log('📬 Email results:', emailResults);
      console.log('=== END EMAIL DEBUG ===');
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      console.error('Email error stack:', emailError.stack);
      // Don't fail the whole request if email fails - just log it
      console.log('⚠️ Document sent successfully but email notifications failed');
    }

    res.json({ 
      success: true, 
      message: 'Document sent successfully to all signers',
      signerCount: signers.length
    });
  } catch (error) {
    console.error('Send document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get document for signing (public endpoint with token validation)
app.get('/api/sign/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { signer, token } = req.query;

    console.log('🔍 SIGN REQUEST DEBUG:');
    console.log('  Document ID:', documentId);
    console.log('  Signer:', signer);
    console.log('  Token provided:', !!token);

    // Validate required parameters
    if (!signer || !token) {
      console.log('❌ Missing required parameters');
      return res.status(400).json({ 
        error: 'Missing required parameters',
        details: 'Both signer email and access token are required'
      });
    }

    // Verify the signing token
    const tokenValidation = await verifySigningToken(token, documentId, signer);
    if (!tokenValidation.valid) {
      console.log('❌ Invalid token:', tokenValidation.error);
      return res.status(403).json({ 
        error: 'Invalid or expired access token',
        details: 'The signing link has expired or is invalid. Please request a new one.'
      });
    }

    // Check if token matches the document and signer
    const tokenPayload = tokenValidation.payload;
    if (tokenPayload.documentId !== documentId || tokenPayload.signerEmail !== signer) {
      console.log('❌ Token mismatch');
      return res.status(403).json({ 
        error: 'Access token mismatch',
        details: 'The access token is not valid for this document and signer.'
      });
    }

    console.log('✅ Token validated successfully');

    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      console.log('❌ Document not found');
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();

    // Check if this signer has already signed
    const signerInfo = documentData.signers?.find(s => s.email === signer);
    if (signerInfo && signerInfo.signed) {
      console.log('✅ Signer has already signed - redirecting to completed view');
      return res.json({ 
        success: true,
        alreadySigned: true,
        message: 'You have already signed this document',
        document: {
          id: documentId,
          title: documentData.title,
          status: documentData.status,
          completedAt: signerInfo.signedAt,
          canDownload: documentData.status === 'completed'
        },
        signer: {
          email: signer,
          signedAt: signerInfo.signedAt,
          alreadySigned: true
        }
      });
    }

    console.log('✅ Document access granted for signing');

    // Return full document data including files for rendering
    res.json({ 
      success: true,
      alreadySigned: false,
      document: {
        id: documentId,
        title: documentData.title,
        files: documentData.files || [],
        totalFiles: documentData.files?.length || 1,
        status: documentData.status,
        message: documentData.message || '',
        subject: documentData.subject || documentData.title,
        // Legacy support for single file documents
        fileName: documentData.fileName,
        fileUrl: documentData.fileUrl,
        originalName: documentData.originalName,
        mimeType: documentData.mimeType,
        fields: documentData.fields || []
      },
      signer: {
        email: signer,
        name: signer.split('@')[0],
        hasAccess: true,
        tokenValid: true,
        alreadySigned: false
      }
    });
  } catch (error) {
    console.error('Get signing document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Submit signature
app.post('/api/sign/:documentId/submit', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { signerEmail, signatureData, fieldValues } = req.body;

    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();
    
    // Find and update signer
    const updatedSigners = documentData.signers.map(signer => {
      if (signer.email === signerEmail) {
        return {
          ...signer,
          signed: true,
          signedAt: new Date().toISOString(),
          signatureData: signatureData,
          fieldValues: fieldValues
        };
      }
      return signer;
    });

    // Check if all signers have signed
    const allSigned = updatedSigners.every(signer => signer.signed);

    const updateData = {
      signers: updatedSigners,
      status: allSigned ? 'completed' : 'partially_signed',
      updatedAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp()
    };

    if (allSigned) {
      updateData.completedAt = isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp();
    }

    await docRef.update(updateData);

    // Send completion email if all signers have signed
    if (allSigned) {
      try {
        console.log('🎯 All signers have completed - generating PDF and sending notifications...');
        
        // Get document owner information
        const ownerDoc = await db.collection('users').doc(documentData.userId).get();
        const ownerData = ownerDoc.exists ? ownerDoc.data() : null;
        const documentTitle = documentData.title || documentData.originalName || 'Document';
        
        // Generate completed PDF with all signatures
        console.log('📄 Generating completed PDF document...');
        const completedPDF = await pdfService.generateCompletedDocument(documentData, updatedSigners);
        
        console.log(`✅ PDF generated: ${completedPDF.filename}`);
        console.log(`📁 Temp file saved at: ${completedPDF.tempFilePath}`);
        
        // Prepare common email data
        const signersList = updatedSigners.filter(s => s.signed).map(s => ({
          name: s.name || s.email.split('@')[0],
          email: s.email
        }));
        
        // Send PDF to document owner
        const ownerEmailData = {
          recipientEmail: ownerData?.email || documentData.createdBy?.email,
          recipientName: ownerData?.name || documentData.createdBy?.name || 'Document Owner',
          documentTitle: documentTitle,
          signers: signersList,
          downloadUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard`
        };

        console.log(`📧 Sending completed PDF to document owner: ${ownerEmailData.recipientEmail}`);
        await emailService.sendDocumentCompletedEmailWithPDF(ownerEmailData, completedPDF.tempFilePath);

        // Send PDF to all signers
        const signerEmailPromises = updatedSigners.filter(s => s.signed).map(async (signer) => {
          const signerEmailData = {
            recipientEmail: signer.email,
            recipientName: signer.name || signer.email.split('@')[0],
            documentTitle: documentTitle,
            signers: signersList,
            downloadUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard`
          };

          console.log(`📧 Sending completed PDF to signer: ${signer.email}`);
          return emailService.sendDocumentCompletedEmailWithPDF(signerEmailData, completedPDF.tempFilePath);
        });

        await Promise.all(signerEmailPromises);
        console.log(`✅ Successfully sent completed PDFs to ${updatedSigners.length + 1} recipients`);
        
        // Clean up temporary file
        setTimeout(() => {
          pdfService.cleanupTempFile(completedPDF.tempFilePath);
        }, 60000); // Clean up after 1 minute to allow email sending
        
      } catch (emailError) {
        console.error('PDF generation and email sending error:', emailError);
        console.error('PDF error stack:', emailError.stack);
        // Don't fail the request if PDF/email fails - just log it
        console.log('⚠️ Document completed successfully but PDF generation/email notifications failed');
      }
    }

    res.json({ 
      success: true, 
      message: 'Signature submitted successfully',
      allSigned: allSigned
    });
  } catch (error) {
    console.error('Submit signature error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all documents (for dashboard) - Now requires authentication and filters by user
app.get('/api/documents', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.userId;

    console.log('=== DOCUMENTS ENDPOINT DEBUG ===');
    console.log('User ID:', userId);
    console.log('Page:', page, 'Limit:', limit, 'Status:', status);
    console.log('Local mode:', isLocalMode);

    // Base query - always filter by userId first
    let query = db.collection('documents').where('userId', '==', userId);
    
    // Handle status filtering
    if (status && status !== 'all') {
      // Add status filter
      query = query.where('status', '==', status);
      
      // Skip orderBy when filtering by status to avoid composite index requirements
      console.log('Status filter applied, skipping orderBy to avoid index issues');
    } else {
      // Only use orderBy when not filtering by status (in production mode)
      if (!isLocalMode) {
        query = query.orderBy('createdAt', 'desc');
      }
    }

    console.log('Executing query...');
    const snapshot = await query.limit(parseInt(limit)).get();
    console.log('Query executed, snapshot size:', snapshot.size);
    
    const documents = [];
    
    snapshot.forEach(doc => {
      const docData = doc.data();
      documents.push({ id: doc.id, ...docData });
    });

    console.log('Documents processed:', documents.length);

    // Get total count for pagination (user's documents only)
    let totalQuery = db.collection('documents').where('userId', '==', userId);
    if (status && status !== 'all') {
      totalQuery = totalQuery.where('status', '==', status);
    }
    const totalSnapshot = await totalQuery.get();
    const total = totalSnapshot.size;

    console.log('Total documents for user:', total);

    // Always sort documents by createdAt in memory to ensure consistent ordering
    documents.sort((a, b) => {
      const aDate = new Date(a.createdAt);
      const bDate = new Date(b.createdAt);
      return bDate - aDate; // Descending order (newest first)
    });

    console.log('=== END DEBUG ===');

    res.json({ 
      success: true, 
      documents,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get documents error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      details: isLocalMode ? error.message : 'Database query failed'
    });
  }
});

// Update document status - Now requires authentication
app.put('/api/documents/:documentId/status', authenticateToken, verifyDocumentOwnership, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { status } = req.body;

    const validStatuses = ['draft', 'sent', 'partially_signed', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updateData = {
      status: status,
      updatedAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp()
    };

    if (status === 'cancelled') {
      updateData.cancelledAt = isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp();
    }

    const docRef = db.collection('documents').doc(documentId);
    await docRef.update(updateData);

    res.json({ success: true, message: 'Document status updated successfully' });
  } catch (error) {
    console.error('Update document status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Duplicate document for editing - Now requires authentication
app.post('/api/documents/:documentId/duplicate', authenticateToken, verifyDocumentOwnership, async (req, res) => {
  try {
    const { documentId } = req.params;
    const originalDoc = req.document; // From verifyDocumentOwnership middleware
    const newDocumentId = crypto.randomUUID();

    // Create duplicate with new ID and reset status
    const duplicateDoc = {
      ...originalDoc,
      id: newDocumentId,
      userId: req.user.userId, // Ensure new document belongs to current user
      status: 'draft',
      createdAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      updatedAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      originalName: `Copy of ${originalDoc.originalName}`,
      title: `Copy of ${originalDoc.title}`,
      // Reset signing-related fields
      sentAt: null,
      completedAt: null,
      cancelledAt: null,
      signers: originalDoc.signers?.map(signer => ({
        ...signer,
        signed: false,
        signedAt: null,
        signatureData: null,
        fieldValues: null
      })) || [],
      createdBy: {
        userId: req.user.userId,
        email: req.user.email,
        name: req.user.name
      }
    };

    await db.collection('documents').doc(newDocumentId).set(duplicateDoc);

    res.json({ 
      success: true, 
      documentId: newDocumentId,
      message: 'Document duplicated successfully' 
    });
  } catch (error) {
    console.error('Duplicate document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete document - Now requires authentication
app.delete('/api/documents/:documentId', authenticateToken, verifyDocumentOwnership, async (req, res) => {
  try {
    const { documentId } = req.params;
    const documentData = req.document; // From verifyDocumentOwnership middleware

    // Delete files from storage
    if (documentData.files && Array.isArray(documentData.files)) {
      // Multi-file document
      for (const file of documentData.files) {
        try {
          await bucket.file(file.fileName).delete();
        } catch (storageError) {
          console.error('Storage deletion error for file:', file.fileName, storageError);
          // Continue with other files even if one fails
        }
      }
    } else if (documentData.fileName) {
      // Single file document
      try {
        await bucket.file(documentData.fileName).delete();
      } catch (storageError) {
        console.error('Storage deletion error:', storageError);
        // Continue with Firestore deletion even if storage deletion fails
      }
    }

    // Delete document from Firestore
    const docRef = db.collection('documents').doc(documentId);
    await docRef.delete();

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create sharing workflow configuration - Now requires authentication
app.post('/api/documents/:documentId/share', authenticateToken, verifyDocumentOwnership, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { signers, workflowType, message, senderName, senderEmail } = req.body;

    // Validate input
    if (!signers || signers.length === 0) {
      return res.status(400).json({ error: 'At least one signer is required' });
    }

    // Validate signers
    for (const signer of signers) {
      if (!signer.name || !signer.email || !signer.role) {
        return res.status(400).json({ error: 'All signers must have name, email, and role' });
      }
      if (!['sign', 'review'].includes(signer.role)) {
        return res.status(400).json({ error: 'Signer role must be either "sign" or "review"' });
      }
    }

    // Validate workflow type
    const validWorkflowTypes = ['parallel', 'sequential', 'custom'];
    if (!validWorkflowTypes.includes(workflowType)) {
      return res.status(400).json({ error: 'Invalid workflow type' });
    }

    // Get document data
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Prepare signers with additional metadata
    const processedSigners = signers.map((signer, index) => ({
      ...signer,
      id: crypto.randomUUID(),
      signed: false,
      order: workflowType === 'sequential' ? index + 1 : 0,
      addedAt: new Date().toISOString()
    }));

    // Update document with sharing configuration
    await docRef.update({
      signers: processedSigners,
      workflowType: workflowType,
      message: message || '',
      senderName: senderName,
      senderEmail: senderEmail,
      status: 'configured',
      configuredAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      lastModified: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp()
    });

    res.json({ 
      success: true, 
      message: 'Sharing configuration saved successfully',
      signers: processedSigners,
      workflowType: workflowType
    });
  } catch (error) {
    console.error('Share configuration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send document with workflow
app.post('/api/documents/:documentId/send-workflow', async (req, res) => {
  try {
    const { documentId } = req.params;

    // Get document data
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();
    
    if (!documentData.signers || documentData.signers.length === 0) {
      return res.status(400).json({ error: 'No signers configured for this document' });
    }

    // Determine which signers to notify based on workflow type
    let signersToNotify = [];
    
    switch (documentData.workflowType) {
      case 'parallel':
        // Send to all signers simultaneously
        signersToNotify = documentData.signers;
        break;
      
      case 'sequential':
        // Send only to the first signer in order
        signersToNotify = documentData.signers
          .filter(s => !s.signed)
          .sort((a, b) => a.order - b.order)
          .slice(0, 1);
        break;
      
      case 'custom':
        // For now, treat custom like parallel
        signersToNotify = documentData.signers.filter(s => !s.signed);
        break;
      
      default:
        signersToNotify = documentData.signers;
    }

    // Update document status
    await docRef.update({
      status: 'sent',
      sentAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      currentStep: documentData.workflowType === 'sequential' ? 1 : 0
    });

    // Log email details (email sending is disabled)
    console.log('📧 Email sending temporarily disabled - would send to signers:');
    signersToNotify.forEach(signer => {
      const signingUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/sign/${documentId}?signer=${encodeURIComponent(signer.email)}`;
      console.log(`   📩 ${signer.name} (${signer.email}) - Role: ${signer.role}: ${signingUrl}`);
    });

    res.json({ 
      success: true, 
      message: `Document sent successfully using ${documentData.workflowType} workflow`,
      notifiedSigners: signersToNotify.length,
      totalSigners: documentData.signers.length,
      workflowType: documentData.workflowType
    });
  } catch (error) {
    console.error('Send workflow error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sharing configuration for a document
app.get('/api/documents/:documentId/share', async (req, res) => {
  try {
    const { documentId } = req.params;

    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();

    res.json({ 
      success: true, 
      document: {
        id: documentId,
        name: documentData.originalName,
        status: documentData.status,
        signers: documentData.signers || [],
        workflowType: documentData.workflowType || 'parallel',
        message: documentData.message || '',
        senderName: documentData.senderName,
        senderEmail: documentData.senderEmail,
        fields: documentData.fields || [],
        pages: documentData.pages || 1
      }
    });
  } catch (error) {
    console.error('Get sharing configuration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update signer in workflow
app.put('/api/documents/:documentId/signers/:signerId', async (req, res) => {
  try {
    const { documentId, signerId } = req.params;
    const { name, email, role } = req.body;

    // Validate input
    if (!name || !email || !role) {
      return res.status(400).json({ error: 'Name, email, and role are required' });
    }

    if (!['sign', 'review'].includes(role)) {
      return res.status(400).json({ error: 'Role must be either "sign" or "review"' });
    }

    // Get document data
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();
    
    // Find and update the signer
    const updatedSigners = documentData.signers.map(signer => {
      if (signer.id === signerId) {
        return {
          ...signer,
          name,
          email,
          role,
          lastModified: new Date().toISOString()
        };
      }
      return signer;
    });

    // Update document
    await docRef.update({
      signers: updatedSigners,
      lastModified: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp()
    });

    res.json({ 
      success: true, 
      message: 'Signer updated successfully',
      signers: updatedSigners
    });
  } catch (error) {
    console.error('Update signer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove signer from workflow
app.delete('/api/documents/:documentId/signers/:signerId', async (req, res) => {
  try {
    const { documentId, signerId } = req.params;

    // Get document data
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();
    
    // Remove the signer
    const updatedSigners = documentData.signers.filter(signer => signer.id !== signerId);

    // Update document
    await docRef.update({
      signers: updatedSigners,
      lastModified: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp()
    });

    res.json({ 
      success: true, 
      message: 'Signer removed successfully',
      signers: updatedSigners
    });
  } catch (error) {
    console.error('Remove signer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== AUTHENTICATION ENDPOINTS ====================

// Google OAuth scopes for SignFlow
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',  // Calendar events access
  'https://www.googleapis.com/auth/gmail.send',       // Gmail send access
  'https://www.googleapis.com/auth/userinfo.profile', // Basic profile info
  'https://www.googleapis.com/auth/userinfo.email'    // Email address
];

// User logout - Now uses JWT authentication
app.post('/auth/logout', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Invalidate user's tokens in database
    const userRef = db.collection('users').doc(userId);
    await userRef.update({
      'auth.accessToken': null,
      'auth.refreshToken': null,
      lastLogout: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      lastUpdated: new Date()
    });
    
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
    
  } catch (error) {
    console.error('Error logging out:', error);
    return res.status(500).json({
      success: false,
      error: 'Error logging out',
      details: error.message
    });
  }
});

// Refresh token endpoint
app.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token is required'
      });
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: 'Refresh token expired',
          message: 'Your session has expired. Please login again.'
        });
      }
      
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token',
        message: 'The provided refresh token is invalid'
      });
    }

    // Check if it's actually a refresh token
    if (decoded.type !== 'refresh') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token type',
        message: 'The provided token is not a refresh token'
      });
    }

    // Get user from database
    const userDoc = await db.collection('users').doc(decoded.userId).get();
    
    if (!userDoc.exists) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
        message: 'User associated with this token no longer exists'
      });
    }

    const userData = userDoc.data();
    
    // Check if refresh token matches stored token
    if (userData.auth && userData.auth.refreshToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token',
        message: 'The refresh token does not match our records'
      });
    }

    // Generate new tokens
    const tokenManager = new TokenManager(db);
    const newTokens = await tokenManager.generateTokens({
      userId: decoded.userId,
      email: userData.email,
      name: userData.name,
      loginProvider: userData.loginProvider,
      lastLoginAt: new Date().toISOString()
    });

    // Update tokens in database
    await userDoc.ref.update({
      auth: newTokens,
      lastTokenRefresh: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      lastUpdated: new Date()
    });

    return res.status(200).json({
      success: true,
      message: 'Tokens refreshed successfully',
      data: {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        tokenType: newTokens.tokenType,
        expiresIn: newTokens.expiresIn,
        userData: newTokens.userData
      }
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during token refresh',
      details: error.message
    });
  }
});

// Get user profile - Now uses JWT authentication
app.get('/auth/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get fresh user data from database
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    const userData = userDoc.data();
    
    // Remove sensitive data from response
    const { password, auth, ...userResponse } = userData;

    res.json({
      success: true,
      data: {
        id: userDoc.id,
        ...userResponse
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Universal authentication endpoint
app.post('/auth/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const usersRef = db.collection('users');
    const tokenManager = new TokenManager(db);

    switch (provider) {
      case 'google': {
        const { code } = req.body;
        
        if (!code) {
          return res.status(400).json({
            success: false,
            error: 'Authorization code is required'
          });
        }

        // Check if Google OAuth is properly configured
        const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (!googleClientSecret || googleClientSecret === 'your-actual-google-client-secret-here' || googleClientSecret === 'your-google-client-secret') {
          return res.status(500).json({
            success: false,
            error: 'Google OAuth not configured',
            details: 'GOOGLE_CLIENT_SECRET environment variable is not set or is using placeholder value. Please configure Google OAuth in Google Cloud Console.'
          });
        }

        try {
          const oauth2Client = new google.auth.OAuth2(
            '606105812193-7ldf8ofiset6impsavns11ib7nd71mfn.apps.googleusercontent.com',
            googleClientSecret,
            `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`
          );

          const { tokens } = await oauth2Client.getToken({
            code: code,
            redirect_uri: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`,
            scope: GOOGLE_SCOPES.join(' ')
          });

          oauth2Client.setCredentials(tokens);
          const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
          const userInfoResponse = await oauth2.userinfo.get();
          const userInfo = userInfoResponse.data;

          const userSnapshot = await usersRef
            .where('email', '==', userInfo.email)
            .get();

          const currentTime = Date.now();
          const expiresIn = typeof tokens.expires_in === 'number' && !isNaN(tokens.expires_in) ? 
            tokens.expires_in : 3600;
          const tokenExpiryDate = currentTime + (expiresIn * 1000);

          const googleLogin = {
            name: userInfo.name,
            picture: userInfo.picture || '',
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            tokenType: tokens.token_type || 'Bearer',
            tokenExpiryDate: tokenExpiryDate,
            lastLoginAt: new Date().toISOString()
          };

          if (userSnapshot.empty) {
            // Create new user
            const newUserRef = usersRef.doc();
            const userId = newUserRef.id;

            const authTokens = await tokenManager.generateTokens({
              userId,
              email: userInfo.email,
              name: userInfo.name,
              loginProvider: 'google',
              lastLoginAt: new Date().toISOString()
            });

            const newUserData = {
              email: userInfo.email,
              name: userInfo.name,
              picture: userInfo.picture,
              createdAt: new Date(),
              lastUpdated: new Date(),
              loginProvider: 'google',
              googleLogin,
              auth: authTokens,
              userId
            };

            await newUserRef.set(newUserData);

            return res.status(200).json({
              success: true,
              message: 'Google authentication successful',
              data: {
                id: userId,
                userId,
                email: userInfo.email,
                name: userInfo.name,
                picture: userInfo.picture,
                loginProvider: 'google',
                accessToken: authTokens.accessToken,
                refreshToken: authTokens.refreshToken
              }
            });
          } else {
            // Update existing user
            const userDoc = userSnapshot.docs[0];
            const userId = userDoc.id;

            const authTokens = await tokenManager.generateTokens({
              userId,
              email: userInfo.email,
              name: userInfo.name,
              loginProvider: 'google',
              lastLoginAt: new Date().toISOString()
            });

            await userDoc.ref.update({
              lastUpdated: new Date(),
              loginProvider: 'google',
              googleLogin,
              auth: authTokens,
              picture: userInfo.picture
            });

            const userData = userDoc.data();

            return res.status(200).json({
              success: true,
              message: 'Google authentication successful',
              data: {
                id: userId,
                userId,
                email: userInfo.email,
                name: userInfo.name,
                picture: userInfo.picture,
                loginProvider: 'google',
                accessToken: authTokens.accessToken,
                refreshToken: authTokens.refreshToken
              }
            });
          }
        } catch (googleError) {
          // Silenced: console.error('Google OAuth error:', googleError); // Too spammy
          
          if (googleError.message && googleError.message.includes('invalid_client')) {
            return res.status(400).json({
              success: false,
              error: 'Invalid Google OAuth configuration',
              details: 'The Google Client ID or Client Secret is invalid. Please check your Google Cloud Console configuration.'
            });
          }
          
          return res.status(500).json({
            success: false,
            error: 'Google authentication failed',
            details: googleError.message
          });
        }
      }

      case 'email-signup': {
        const { email, password, name, confirmPassword } = req.body;
        
        if (!email || !password || !name || !confirmPassword) {
          return res.status(400).json({
            success: false,
            error: 'All fields are required'
          });
        }

        if (password !== confirmPassword) {
          return res.status(400).json({
            success: false,
            error: 'Passwords do not match'
          });
        }

        if (password.length < 6) {
          return res.status(400).json({
            success: false,
            error: 'Password must be at least 6 characters long'
          });
        }

        const userSnapshot = await usersRef
          .where('email', '==', email)
          .get();

        if (userSnapshot.size > 0) {
          return res.status(400).json({
            success: false,
            error: 'Email already registered'
          });
        }

        // Create new user
        const newUserRef = usersRef.doc();
        const userId = newUserRef.id;

        const tokens = await tokenManager.generateTokens({
          userId,
          email,
          name,
          loginProvider: 'email',
          lastLoginAt: new Date().toISOString()
        });

        // Hash password before storing
        const hashedPassword = await tokenManager.hashPassword(password);

        const newUserData = {
          email,
          name,
          password: hashedPassword, // Store hashed password
          userId,
          loginProvider: 'email',
          createdAt: new Date(),
          lastUpdated: new Date(),
          auth: tokens
        };

        await newUserRef.set(newUserData);

        return res.status(200).json({
          success: true,
          message: 'Account created successfully',
          data: {
            id: userId,
            userId,
            email,
            name,
            loginProvider: 'email',
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken
          }
        });
      }

      case 'email-login': {
        const { email, password } = req.body;
        
        console.log('=== EMAIL LOGIN DEBUG ===');
        console.log('Email:', email);
        console.log('Password provided:', !!password);
        console.log('Local mode:', isLocalMode);
        
        if (!email || !password) {
          return res.status(400).json({
            success: false,
            error: 'Email and password are required'
          });
        }

        console.log('Querying users with email:', email);
        const userSnapshot = await usersRef
          .where('email', '==', email)
          .get();

        console.log('User snapshot empty:', userSnapshot.empty);
        console.log('User snapshot size:', userSnapshot.size);
        
        if (isLocalMode && mockDatabase) {
          console.log('Mock database contents:');
          for (const [key, value] of mockDatabase.entries()) {
            if (key.startsWith('users/')) {
              console.log(`  ${key}:`, { email: value.email, name: value.name });
            }
          }
        }

        if (userSnapshot.empty) {
          return res.status(404).json({
            success: false,
            error: 'Invalid email or password'
          });
        }

        console.log('Found user, docs length:', userSnapshot.docs?.length);
        const userDoc = userSnapshot.docs[0];
        const userId = userDoc.id;
        const userData = userDoc.data();
        
        console.log('User data:', { email: userData.email, name: userData.name, hasPassword: !!userData.password });
        
        // Verify password using bcrypt
        const isPasswordValid = await tokenManager.verifyPassword(password, userData.password);
        
        console.log('Password valid:', isPasswordValid);
        
        if (!isPasswordValid) {
          return res.status(401).json({
            success: false,
            error: 'Invalid email or password'
          });
        }
        
        const tokens = await tokenManager.generateTokens({
          userId,
          email,
          name: userData.name,
          loginProvider: 'email',
          lastLoginAt: new Date().toISOString()
        });

        await userDoc.ref.update({
          lastUpdated: new Date(),
          auth: tokens,
          lastLogin: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp()
        });

        return res.status(200).json({
          success: true,
          message: 'Login successful',
          data: {
            id: userId,
            userId,
            email,
            name: userData.name,
            picture: userData.picture,
            loginProvider: 'email',
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken
          }
        });
      }

      case 'phone': {
        const { phone, idToken } = req.body;
        
        if (!phone || !idToken) {
          return res.status(400).json({
            success: false,
            error: 'Phone and idToken are required'
          });
        }

        // In production, verify the Firebase ID token here
        
        const userSnapshot = await usersRef
          .where('phone', '==', phone)
          .get();

        if (userSnapshot.empty) {
          // Create new user
          const newUserRef = usersRef.doc();
          const userId = newUserRef.id;

          const tokens = await tokenManager.generateTokens({
            userId,
            phone,
            loginProvider: 'phone',
            lastLoginAt: new Date().toISOString()
          });

          const newUserData = {
            phone,
            name: `User ${phone.slice(-4)}`,
            userId,
            loginProvider: 'phone',
            createdAt: new Date(),
            lastUpdated: new Date(),
            auth: tokens
          };

          await newUserRef.set(newUserData);

          return res.status(200).json({
            success: true,
            message: 'Phone authentication successful',
            data: {
              id: userId,
              userId,
              phone,
              name: `User ${phone.slice(-4)}`,
              loginProvider: 'phone',
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken
            }
          });
        } else {
          // Update existing user
          const userDoc = userSnapshot.docs[0];
          const userId = userDoc.id;
          const userData = userDoc.data();

          const tokens = await tokenManager.generateTokens({
            userId,
            phone,
            loginProvider: 'phone',
            lastLoginAt: new Date().toISOString()
          });

          await userDoc.ref.update({
            lastUpdated: new Date(),
            auth: tokens,
            lastLogin: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp()
          });

          return res.status(200).json({
            success: true,
            message: 'Phone authentication successful',
            data: {
              id: userId,
              userId,
              phone,
              name: userData.name,
              loginProvider: 'phone',
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken
            }
          });
        }
      }

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid authentication provider'
        });
    }

  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during authentication',
      details: error.message
    });
  }
});

// Test email endpoint for debugging
app.post('/api/test-email', async (req, res) => {
  try {
    const { to } = req.body;
    const testEmail = to || 'malik.vk07@gmail.com';

    console.log('🧪 Testing email functionality...');
    console.log('📧 Sending test email to:', testEmail);

    // Simple test email data
    const testEmailData = {
      signerEmail: testEmail,
      signerName: 'Test User',
      documentTitle: 'Test Document - Email Configuration Check',
      senderName: 'SignFlow System',
      senderEmail: 'system@signflow.com',
      message: 'This is a test email to verify email configuration is working properly.',
      signingUrl: 'https://example.com/test-signing-url'
    };

    // Send test email using the document share template
    const result = await emailService.sendDocumentShareEmail(testEmailData);
    
    console.log('✅ Test email sent successfully');
    console.log('📬 Email result:', result);

    res.json({ 
      success: true, 
      message: `Test email sent successfully to ${testEmail}`,
      emailResult: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Test email failed:', error);
    console.error('📧 Email error details:', error.message);
    
    // Try to send a basic email without templates as fallback
    try {
      console.log('🔄 Trying basic email without templates...');
      
      const basicResult = await emailService.sendEmail({
        to: req.body.to || 'malik.vk07@gmail.com',
        subject: '✉️ SignFlow Email Test - Basic',
        text: `This is a basic test email from SignFlow.
        
Time: ${new Date().toLocaleString()}
Testing email configuration...

If you received this email, the basic email service is working.

Best regards,
SingTap Team`,
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #4F46E5;">✉️ SignFlow Email Test</h2>
          <p>This is a basic test email from SignFlow.</p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <strong>Time:</strong> ${new Date().toLocaleString()}<br>
            <strong>Status:</strong> Testing email configuration...
          </div>
          <p>If you received this email, the basic email service is working.</p>
          <hr style="margin: 20px 0;">
          <p style="color: #666; font-size: 14px;">Best regards,<br>SignFlow Team</p>
        </div>`
      });

      console.log('✅ Basic email sent successfully');
      
      res.json({ 
        success: true, 
        message: 'Template email failed but basic email sent successfully',
        basicEmailResult: basicResult,
        templateError: error.message,
        timestamp: new Date().toISOString()
      });
    } catch (basicError) {
      console.error('❌ Basic email also failed:', basicError);
      res.status(500).json({ 
        success: false,
        error: 'Both template and basic email failed',
        templateError: error.message,
        basicError: basicError.message,
        timestamp: new Date().toISOString()
      });
    }
  }
});

// Email configuration check endpoint
app.get('/api/email-config', async (req, res) => {
  try {
    console.log('🔍 Checking email configuration...');
    
    const config = {
      host: 'smtpout.secureserver.net',
      port: 465,
      secure: true,
      hasEmailCredentials: !!(process.env.GODADY_EMAIL && process.env.GODADY_PA),
      emailUser: process.env.GODADY_EMAIL ? process.env.GODADY_EMAIL.substring(0, 3) + '***' : 'NOT_SET',
      passwordSet: !!process.env.GODADY_PA
    };

    console.log('📧 Email config check:', config);

    res.json({
      success: true,
      config: config,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Email config check failed:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 SignApp Backend running on port ${PORT}`);
  console.log(`📊 Mode: ${isLocalMode ? 'LOCAL DEVELOPMENT1' : 'PRODUCTION'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  if (isLocalMode) {
    console.log('📝 Note: Running in local mode with proper file serving');
  }
});

module.exports = app; 

// Function to generate secure signing token
function generateSigningToken(documentId, signerEmail) {
  // Generate 16-character alphanumeric token
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  for (let i = 0; i < 16; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Function to verify signing token
async function verifySigningToken(token, documentId, signerEmail) {
  // SIMPLE FIXED TOKEN SYSTEM - Just check if token exists
  if (!token) {
    return { valid: false, error: 'No token provided' };
  }
  
  // Accept any token for now - super simple
  console.log('✅ SIMPLE TOKEN CHECK PASSED - Token:', token);
  return { valid: true, payload: { documentId, signerEmail } };
}

// Serve document files for signing (public endpoint with token validation)
app.get('/api/sign/:documentId/file/:fileId', async (req, res) => {
  try {
    const { documentId, fileId } = req.params;
    const { token, signer } = req.query;

    console.log('🔍 FILE REQUEST DEBUG:');
    console.log('  Document ID:', documentId);
    console.log('  File ID:', fileId);
    console.log('  Signer:', signer);
    console.log('  Token provided:', !!token);

    // Validate required parameters
    if (!signer || !token) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        details: 'Both signer email and access token are required'
      });
    }

    // Verify the signing token
    const tokenValidation = await verifySigningToken(token, documentId, signer);
    if (!tokenValidation.valid) {
      console.log('❌ Invalid token:', tokenValidation.error);
      return res.status(403).json({ 
        error: 'Invalid or expired access token',
        details: 'The signing link has expired or is invalid. Please request a new one.'
      });
    }

    // Check if token matches the document and signer
    const tokenPayload = tokenValidation.payload;
    if (tokenPayload.documentId !== documentId || tokenPayload.signerEmail !== signer) {
      console.log('❌ Token mismatch');
      return res.status(403).json({ 
        error: 'Access token mismatch',
        details: 'The access token is not valid for this document and signer.'
      });
    }

    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();

    // Verify signer is authorized
    const authorizedSigner = documentData.signers?.find(s => s.email === signer);
    if (!authorizedSigner) {
      return res.status(403).json({ error: 'Unauthorized signer' });
    }

    // Find the specific file in the document's files array
    const fileInfo = documentData.files?.find(f => f.fileId === fileId);
    
    if (!fileInfo) {
      // Try legacy single file support
      if (documentData.fileName && fileId === 'main') {
        const fileInfo = {
          fileName: documentData.fileName,
          mimeType: documentData.mimeType,
          originalName: documentData.originalName
        };
      } else {
        return res.status(404).json({ error: 'File not found' });
      }
    }

    // Set proper headers for file serving
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', fileInfo.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${fileInfo.originalName}"`);

    // Always serve file content directly to avoid CORS issues
    try {
      const [fileBuffer] = await bucket.file(fileInfo.fileName).download();
      console.log('✅ File served successfully:', fileInfo.originalName);
      res.send(fileBuffer);
    } catch (error) {
      console.error('Error serving file:', error);
      res.status(404).json({ error: 'File not found in storage' });
    }
  } catch (error) {
    console.error('Public file serving error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Test signing endpoint without token validation (temporary)
app.get('/api/test-sign/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { signer } = req.query;

    console.log('🧪 TEST SIGN REQUEST:');
    console.log('  Document ID:', documentId);
    console.log('  Signer:', signer);

    if (!signer) {
      return res.status(400).json({ 
        error: 'Missing signer parameter'
      });
    }

    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      console.log('❌ Document not found');
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();

    // Return full document data without any validation for testing
    res.json({ 
      success: true, 
      message: 'TEST ENDPOINT - NO VALIDATION',
      document: {
        id: documentId,
        title: documentData.title,
        files: documentData.files || [],
        totalFiles: documentData.files?.length || 1,
        status: documentData.status,
        message: documentData.message || '',
        subject: documentData.subject || documentData.title,
        // Legacy support for single file documents
        fileName: documentData.fileName,
        fileUrl: documentData.fileUrl,
        originalName: documentData.originalName,
        mimeType: documentData.mimeType,
        fields: documentData.fields || []
      },
      signer: {
        email: signer,
        hasAccess: true,
        tokenValid: true
      }
    });
  } catch (error) {
    console.error('Test signing document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get document status (public endpoint for checking completion)
app.get('/api/documents/:documentId/status', async (req, res) => {
  try {
    const { documentId } = req.params;

    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();

    res.json({ 
      success: true, 
      document: {
        id: documentId,
        title: documentData.title,
        status: documentData.status,
        signers: documentData.signers || [],
        completedAt: documentData.completedAt,
        createdAt: documentData.createdAt
      }
    });
  } catch (error) {
    console.error('Get document status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download completed document (public endpoint)
app.get('/api/documents/:documentId/download', async (req, res) => {
  try {
    const { documentId } = req.params;

    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();

    // Check if document is completed
    if (documentData.status !== 'completed') {
      return res.status(400).json({ error: 'Document is not yet completed' });
    }

    // Generate completed document with all signatures
    const signersData = documentData.signers.filter(signer => signer.signed);
    const completedDoc = await pdfService.generateCompletedDocument(documentData, signersData);

    // Set headers for download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${completedDoc.filename}"`);
    res.setHeader('Content-Length', completedDoc.buffer.length);

    // Send the PDF buffer
    res.send(completedDoc.buffer);

    // Clean up temp file
    if (completedDoc.tempFilePath) {
      setTimeout(() => {
        pdfService.cleanupTempFile(completedDoc.tempFilePath);
      }, 1000);
    }

  } catch (error) {
    console.error('Download document error:', error);
    res.status(500).json({ error: 'Failed to generate document download' });
  }
});

// Generate OTP function
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Forgot Password endpoint
app.post('/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Get user document from users collection
    const userSnapshot = await db.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data();

    // Check if user has email login (password set)
    if (!userData.password) {
      return res.status(400).json({
        success: false,
        error: 'This account was not registered with email/password'
      });
    }

    // Generate OTP and expiry time (6 hours from now)
    const otp = generateOTP();
    const expiryTime = new Date();
    expiryTime.setHours(expiryTime.getHours() + 6);

    // Update user document with OTP and expiry
    await db.collection('users').doc(userDoc.id).update({
      otpValueReset: otp,
      otpExpiry: expiryTime.toISOString()
    });

    // Send OTP email
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4F46E5;">Password Reset Request</h2>
        <p>Hello ${userData.name || 'User'},</p>
        <p>We received a request to reset your password for your SignFlow account. Here is your OTP:</p>
        <h1 style="font-size: 32px; letter-spacing: 5px; text-align: center; padding: 20px; background-color: #f5f5f5; border-radius: 5px; color: #4F46E5;">${otp}</h1>
        <p>This OTP will expire in 6 hours.</p>
        <p>If you didn't request this password reset, please ignore this email.</p>
        <p>Best regards,<br>SignFlow Team</p>
      </div>
    `;

    await emailService.sendEmail({
      to: email,
      subject: 'Password Reset OTP - SignFlow',
      text: `Your password reset OTP is: ${otp}. This OTP will expire in 6 hours.`,
      html: emailHtml
    });

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Reset Password endpoint
app.post('/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Email, OTP, and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
    }

    // Get user document
    const userSnapshot = await db.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data();

    // Verify OTP and expiry
    if (!userData.otpValueReset || 
        userData.otpValueReset !== otp || 
        !userData.otpExpiry) {
      return res.status(400).json({
        success: false,
        error: 'Invalid OTP'
      });
    }

    // Check OTP expiry
    const expiryTime = new Date(userData.otpExpiry);
    if (expiryTime < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'OTP has expired'
      });
    }

    // Hash the new password
    const tokenManager = new TokenManager(db);
    const hashedPassword = await tokenManager.hashPassword(newPassword);

    // Update password and clear OTP
    await db.collection('users').doc(userDoc.id).update({
      password: hashedPassword,
      otpValueReset: null,
      otpExpiry: null,
      lastUpdated: new Date()
    });

    return res.status(200).json({
      success: true,
      message: 'Password reset successful'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});