const express = require('express');
require('dotenv').config();
const multer = require('multer');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5002;

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
if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
  console.log('🔧 Running in LOCAL DEVELOPMENT MODE - Firebase disabled');
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
        }
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
      })
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'API running fine', timestamp: new Date().toISOString() });
});

// Upload document endpoint - Modified to support multiple files under single document ID
app.post('/api/documents/upload', upload.any(), async (req, res) => {
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
      title: subject || `Document with ${files.length} files`,
      files: uploadedFiles,
      totalFiles: files.length,
      createdAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      updatedAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      status: 'draft',
      signers: signers,
      subject: subject,
      message: message,
      configuration: configuration
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

// Serve document file with proper CORS headers
app.get('/api/documents/:documentId/file', async (req, res) => {
  try {
    const { documentId } = req.params;
    
    // Get document metadata
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();
    const fileName = documentData.fileName;

    if (!fileName) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set proper headers for file serving
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', documentData.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${documentData.originalName}"`);

    if (isLocalMode) {
      // Serve from local storage
      try {
        const [fileBuffer] = await bucket.file(fileName).download();
        res.send(fileBuffer);
      } catch (error) {
        console.error('Local file serving error:', error);
        res.status(404).json({ error: 'File not found in local storage' });
      }
    } else {
      // Serve from Google Cloud Storage
      try {
        const file = bucket.file(fileName);
        const [fileBuffer] = await file.download();
        res.send(fileBuffer);
      } catch (error) {
        console.error('GCS file serving error:', error);
        res.status(404).json({ error: 'File not found in storage' });
      }
    }
  } catch (error) {
    console.error('File serving error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve individual file from multi-file document
app.get('/api/documents/:documentId/file/:fileId', async (req, res) => {
  try {
    const { documentId, fileId } = req.params;
    
    // Get document metadata
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();
    
    // Find the specific file in the files array
    const fileInfo = documentData.files?.find(file => file.fileId === fileId);
    
    if (!fileInfo) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set proper headers for file serving
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', fileInfo.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${fileInfo.originalName}"`);

    if (isLocalMode) {
      // Serve from local storage
      try {
        const [fileBuffer] = await bucket.file(fileInfo.fileName).download();
        res.send(fileBuffer);
      } catch (error) {
        console.error('Local file serving error:', error);
        res.status(404).json({ error: 'File not found in local storage' });
      }
    } else {
      // Serve from Google Cloud Storage
      try {
        const file = bucket.file(fileInfo.fileName);
        const [fileBuffer] = await file.download();
        res.send(fileBuffer);
      } catch (error) {
        console.error('GCS file serving error:', error);
        res.status(404).json({ error: 'File not found in storage' });
      }
    }
  } catch (error) {
    console.error('Individual file serving error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get document by ID
app.get('/api/documents/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ success: true, document: doc.data() });
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update document fields
app.put('/api/documents/:documentId/fields', async (req, res) => {
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

// Update entire document (general PUT endpoint)
app.put('/api/documents/:documentId', async (req, res) => {
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
      // Get current document data
      const docRef = db.collection('documents').doc(documentId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return res.status(404).json({ error: 'Document not found' });
      }

      const documentData = doc.data();
      
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

// Add signers to document
app.put('/api/documents/:documentId/signers', async (req, res) => {
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

// Send document for signing
app.post('/api/documents/:documentId/send', async (req, res) => {
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

    // Send emails to all signers - TEMPORARILY DISABLED
    // if (emailTransporter) {
    //   const emailPromises = signers.map(async (signer) => {
    //     const signingUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/sign/${documentId}?signer=${encodeURIComponent(signer.email)}`;
        
    //     const emailHtml = `
    //       <!DOCTYPE html>
    //       <html>
    //       <head>
    //         <meta charset="utf-8">
    //         <meta name="viewport" content="width=device-width, initial-scale=1.0">
    //         <title>Document Signature Request</title>
    //       </head>
    //       <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f7fa;">
    //         <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);">
    //           <!-- Header -->
    //           <div style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 40px 20px; text-align: center;">
    //             <div style="font-size: 50px; margin-bottom: 15px;">📝✍️</div>
    //             <h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: 0.5px;">Signature Request</h1>
    //             <p style="color: #E0E7FF; margin-top: 10px; font-size: 16px;">
    //               You have a document waiting for your signature
    //             </p>
    //           </div>

    //           <!-- Main Content -->
    //           <div style="padding: 32px 24px; background-color: #ffffff;">
    //             <p style="font-size: 16px; color: #4B5563; margin-top: 0;">Dear ${signer.name || signer.email},</p>
                
    //             <div style="background-color: #F3F4F6; border-left: 4px solid #4F46E5; padding: 16px; margin: 24px 0; border-radius: 4px;">
    //               <p style="font-size: 16px; color: #4B5563; margin: 0;">
    //                 <strong style="color: #4F46E5;">Document Owner</strong> has sent you a document that requires your signature.
    //               </p>
    //             </div>

    //             ${message ? `
    //             <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 20px; margin: 24px 0;">
    //               <h3 style="margin: 0 0 12px 0; color: #111827; font-size: 16px;">Message from sender:</h3>
    //               <p style="margin: 0; color: #4B5563; font-style: italic;">"${message}"</p>
    //             </div>
    //             ` : ''}

    //             <!-- Document Info -->
    //             <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 20px; margin: 24px 0;">
    //               <div style="display: flex; align-items: center; margin-bottom: 16px;">
    //                 <div style="width: 24px; height: 24px; margin-right: 12px; color: #4F46E5;">
    //                   <span style="font-size: 24px;">📄</span>
    //                 </div>
    //                 <div>
    //                   <p style="margin: 0; font-size: 14px; color: #6B7280;">Document</p>
    //                   <p style="margin: 0; font-size: 16px; font-weight: 500; color: #111827;">${documentData.title || documentData.originalName || 'Document'}</p>
    //                 </div>
    //               </div>
    //               <div style="display: flex; align-items: center;">
    //                 <div style="width: 24px; height: 24px; margin-right: 12px; color: #4F46E5;">
    //                   <span style="font-size: 24px;">⏰</span>
    //                 </div>
    //                 <div>
    //                   <p style="margin: 0; font-size: 14px; color: #6B7280;">Sent</p>
    //                   <p style="margin: 0; font-size: 16px; font-weight: 500; color: #111827;">${new Date().toLocaleString()}</p>
    //                 </div>
    //               </div>
    //             </div>

    //             <!-- Action Button -->
    //             <div style="text-align: center; margin: 32px 0 24px 0;">
    //               <a href="${signingUrl}" 
    //                  style="display: inline-block; background: #4F46E5; color: white; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; margin: 8px; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 4px 6px rgba(79, 70, 229, 0.25);">
    //                 Review & Sign Document
    //               </a>
    //             </div>
                
    //             <p style="font-size: 14px; color: #6B7280; text-align: center; font-style: italic; margin-bottom: 0;">
    //               This signature request will expire in 30 days.
    //             </p>
    //           </div>

    //           <!-- Footer -->
    //           <div style="background-color: #F3F4F6; padding: 24px; text-align: center; border-top: 1px solid #E5E7EB;">
    //             <p style="color: #6B7280; margin: 0; font-size: 14px;">© ${new Date().getFullYear()} SignApp. All rights reserved.</p>
    //           </div>
    //         </div>
    //       </body>
    //       </html>
    //     `;

    //     const mailOptions = {
    //       from: process.env.GODADY_EMAIL_SNAPYFORM,
    //       to: signer.email,
    //       subject: subject || `📝 Signature Request: ${documentData.originalName}`,
    //       html: emailHtml
    //     };

    //     return emailTransporter.sendMail(mailOptions);
    //   });

    //   await Promise.all(emailPromises);
    // } else {
      // Log email details instead of sending
      console.log('📧 Email sending temporarily disabled - would send to signers:');
      signers.forEach(signer => {
        const signingUrl = `${process.env.FRONTEND_URL || 'http://localhost:3003'}/sign/${documentId}?signer=${encodeURIComponent(signer.email)}`;
        console.log(`   📩 ${signer.name} (${signer.email}): ${signingUrl}`);
      });
    // }

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

// Get document for signing (public endpoint)
app.get('/api/sign/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { signer } = req.query;

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

    res.json({ 
      success: true, 
      document: documentData,
      signer: authorizedSigner
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

// Get all documents (for dashboard)
app.get('/api/documents', async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    let query = db.collection('documents').orderBy('createdAt', 'desc');
    
    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshot = await query.limit(parseInt(limit)).offset(offset).get();
    const documents = [];
    
    snapshot.forEach(doc => {
      documents.push({ id: doc.id, ...doc.data() });
    });

    // Get total count for pagination
    const totalSnapshot = await db.collection('documents').get();
    const total = totalSnapshot.size;

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update document status
app.put('/api/documents/:documentId/status', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { status } = req.body;

    const validStatuses = ['draft', 'sent', 'partially_signed', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const updateData = {
      status: status,
      updatedAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp()
    };

    if (status === 'cancelled') {
      updateData.cancelledAt = isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp();
    }

    await docRef.update(updateData);

    res.json({ success: true, message: 'Document status updated successfully' });
  } catch (error) {
    console.error('Update document status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Duplicate document for editing
app.post('/api/documents/:documentId/duplicate', async (req, res) => {
  try {
    const { documentId } = req.params;
    
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const originalDoc = doc.data();
    const newDocumentId = crypto.randomUUID();

    // Create duplicate with new ID and reset status
    const duplicateDoc = {
      ...originalDoc,
      id: newDocumentId,
      status: 'draft',
      createdAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      updatedAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      originalName: `Copy of ${originalDoc.originalName}`,
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
      })) || []
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

// Get document statistics for dashboard
app.get('/api/documents/stats', async (req, res) => {
  try {
    const documentsRef = db.collection('documents');
    
    // Get all documents
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

// Delete document
app.delete('/api/documents/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;

    // Get document data first
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();

    // Delete file from storage
    if (documentData.fileName) {
      try {
        await bucket.file(documentData.fileName).delete();
      } catch (storageError) {
        console.error('Storage deletion error:', storageError);
        // Continue with Firestore deletion even if storage deletion fails
      }
    }

    // Delete document from Firestore
    await docRef.delete();

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create sharing workflow configuration
app.post('/api/documents/:documentId/share', async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`🚀 SignApp Backend running on port ${PORT}`);
  console.log(`📊 Mode: ${isLocalMode ? 'LOCAL DEVELOPMENT1' : 'PRODUCTION'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  if (isLocalMode) {
    console.log('📝 Note: Running in local mode with proper file serving');
  }
});

module.exports = app; 