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
const PORT = process.env.PORT || 5001;

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

// Local file storage for development
const localStoragePath = path.join(__dirname, 'uploads');
if (!fs.existsSync(localStoragePath)) {
  fs.mkdirSync(localStoragePath, { recursive: true });
}

// Check if we're in local development mode
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
  bucket = {
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
      // For Vercel
      const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      storage = new Storage({
        projectId: serviceAccount.project_id,
        credentials: {
          client_email: serviceAccount.client_email,
          private_key: serviceAccount.private_key
        }
      });
    } else {
      // For local development
      storage = new Storage();
    }
    bucket = storage.bucket('demoimage-7189');
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

// Multer configuration for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'API running fine', timestamp: new Date().toISOString() });
});

// Upload document endpoint
app.post('/api/documents/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const documentId = crypto.randomUUID();
    const fileName = `documents/${documentId}/${req.file.originalname}`;
    
    if (isLocalMode) {
      // Local development mode - save file to local storage
      console.log(`📁 Local upload: ${req.file.originalname} (${req.file.size} bytes)`);
      
      // Save file to local storage
      await bucket.file(fileName).save(req.file.buffer, {
        contentType: req.file.mimetype
      });
      
      // Create a local serving URL
      const fileUrl = `http://localhost:${PORT}/api/documents/${documentId}/file`;
      
      // Save document metadata to mock database
      const documentData = {
        id: documentId,
        originalName: req.file.originalname,
        fileName: fileName,
        fileUrl: fileUrl,
        mimeType: req.file.mimetype,
        size: req.file.size,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'draft',
        fields: [],
        signers: [],
        pages: [{ url: fileUrl, pageNumber: 1 }]
      };

      await db.collection('documents').doc(documentId).set(documentData);

      res.json({
        success: true,
        documentId,
        fileUrl: fileUrl,
        document: documentData
      });
    } else {
      // Production mode - save to Google Cloud Storage with public URL
      const file = bucket.file(fileName);
      
      // Save file to Google Cloud Storage
      await file.save(req.file.buffer, {
        metadata: {
          contentType: req.file.mimetype,
        },
      });

      // Create public URL (files in this bucket are publicly accessible)
      const fileUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

      // Save document metadata to Firestore
      const documentData = {
        id: documentId,
        originalName: req.file.originalname,
        fileName: fileName,
        fileUrl: fileUrl,
        mimeType: req.file.mimetype,
        size: req.file.size,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        status: 'draft',
        fields: [],
        signers: [],
        pages: [{ url: fileUrl, pageNumber: 1 }]
      };

      await db.collection('documents').doc(documentId).set(documentData);

      res.json({
        success: true,
        documentId,
        fileUrl: fileUrl,
        document: documentData
      });
    }
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
    const { message, senderName, senderEmail } = req.body;

    // Get document data
    const docRef = db.collection('documents').doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = doc.data();
    
    if (!documentData.signers || documentData.signers.length === 0) {
      return res.status(400).json({ error: 'No signers added to document' });
    }

    // Update document status
    await docRef.update({
      status: 'sent',
      sentAt: isLocalMode ? new Date().toISOString() : FieldValue.serverTimestamp(),
      senderName: senderName,
      senderEmail: senderEmail,
      message: message
    });

    // Send emails to all signers - TEMPORARILY DISABLED
    // if (emailTransporter) {
    //   const emailPromises = documentData.signers.map(async (signer) => {
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
    //                 <strong style="color: #4F46E5;">${senderName || senderEmail}</strong> has sent you a document that requires your signature.
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
    //                   <p style="margin: 0; font-size: 16px; font-weight: 500; color: #111827;">${documentData.originalName}</p>
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
    //       subject: `📝 Signature Request: ${documentData.originalName}`,
    //       html: emailHtml
    //     };

    //     return emailTransporter.sendMail(mailOptions);
    //   });

    //   await Promise.all(emailPromises);
    // } else {
      // Log email details instead of sending
      console.log('📧 Email sending temporarily disabled - would send to signers:');
      documentData.signers.forEach(signer => {
        const signingUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/sign/${documentId}?signer=${encodeURIComponent(signer.email)}`;
        console.log(`   📩 ${signer.name} (${signer.email}): ${signingUrl}`);
      });
    // }

    res.json({ 
      success: true, 
      message: 'Document sent successfully to all signers',
      signerCount: documentData.signers.length
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

app.listen(PORT, () => {
  console.log(`🚀 SignApp Backend running on port ${PORT}`);
  console.log(`📊 Mode: ${isLocalMode ? 'LOCAL DEVELOPMENT' : 'PRODUCTION'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  if (isLocalMode) {
    console.log('📝 Note: Running in local mode with proper file serving');
  }
});

module.exports = app; 