# SignBE - Digital Document Signing Backend

A robust Node.js backend API for digital document signing and management, built with Express.js, Firebase, and Google Cloud Storage.

## 🚀 Features

- **Document Management**: Upload, store, and manage PDF and image documents
- **Digital Signatures**: Advanced signature functionality with canvas drawing and image upload
- **Multi-Signer Support**: Add multiple signers to documents with email notifications
- **Field Management**: Dynamic form fields (text, signature, checkbox, date) with drag-and-drop positioning
- **Real-time Updates**: Live document status tracking and updates
- **Cloud Storage**: Secure document storage using Google Cloud Storage
- **Email Notifications**: Automated email notifications for signing requests
- **RESTful API**: Clean, well-documented REST API endpoints

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: Firebase Firestore
- **Storage**: Google Cloud Storage
- **Authentication**: Firebase Auth
- **Email**: Nodemailer with Gmail SMTP
- **File Processing**: Multer for file uploads
- **CORS**: Cross-origin resource sharing enabled

## 📋 Prerequisites

Before running this application, make sure you have:

- Node.js (v14 or higher)
- npm or yarn
- Firebase project with Firestore enabled
- Google Cloud Storage bucket
- Gmail account for SMTP (or other email service)

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd signbe
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   Create a `.env` file in the root directory:
   ```env
   PORT=5002
   NODE_ENV=development
   
   # Firebase Configuration
   FIREBASE_PROJECT_ID=your-firebase-project-id
   FIREBASE_PRIVATE_KEY_ID=your-private-key-id
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Private-Key\n-----END PRIVATE KEY-----\n"
   FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
   FIREBASE_CLIENT_ID=your-client-id
   FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
   FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
   
   # Google Cloud Storage
   GCS_BUCKET_NAME=your-gcs-bucket-name
   GOOGLE_APPLICATION_CREDENTIALS=path/to/your/service-account-key.json
   
   # Email Configuration
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASS=your-app-password
   EMAIL_FROM=your-email@gmail.com
   
   # CORS
   FRONTEND_URL=http://localhost:3000
   ```

4. **Firebase Setup**
   - Create a Firebase project
   - Enable Firestore Database
   - Generate a service account key
   - Download the JSON key file and update the path in `.env`

5. **Google Cloud Storage Setup**
   - Create a GCS bucket
   - Ensure your service account has Storage Admin permissions
   - Update the bucket name in `.env`

## 🚀 Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

The server will start on `http://localhost:5002` (or your specified PORT).

## 📚 API Documentation

### Base URL
```
http://localhost:5002/api
```

### Endpoints

#### Documents

**Upload Document**
```http
POST /documents/upload
Content-Type: multipart/form-data

Body: FormData with 'document' file
```

**Get Document**
```http
GET /documents/:id
```

**Update Document Fields**
```http
PUT /documents/:id/fields
Content-Type: application/json

{
  "fields": [
    {
      "id": "field_123",
      "type": "text",
      "x": 100,
      "y": 200,
      "width": 180,
      "height": 40,
      "page": 0,
      "value": "",
      "required": false
    }
  ]
}
```

**Update Document Signers**
```http
PUT /documents/:id/signers
Content-Type: application/json

{
  "signers": [
    {
      "name": "John Doe",
      "email": "john@example.com",
      "signed": false
    }
  ]
}
```

**Send Document for Signing**
```http
POST /documents/:id/send
Content-Type: application/json

{
  "message": "Please review and sign this document.",
  "senderName": "Your Name",
  "senderEmail": "your@email.com"
}
```

#### Signing

**Get Document for Signing**
```http
GET /sign/:token
```

**Submit Signature**
```http
POST /sign/:token
Content-Type: application/json

{
  "fieldId": "field_123",
  "signature": "data:image/png;base64,..."
}
```

**Complete Signing**
```http
POST /sign/:token/complete
Content-Type: application/json

{
  "signerEmail": "signer@example.com"
}
```

### Response Format

All API responses follow this format:
```json
{
  "success": true,
  "data": {},
  "message": "Success message"
}
```

Error responses:
```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional error details"
}
```

## 🗂️ Project Structure

```
signbe/
├── src/
│   ├── config/
│   │   ├── firebase.js      # Firebase configuration
│   │   └── storage.js       # Google Cloud Storage setup
│   ├── middleware/
│   │   ├── auth.js          # Authentication middleware
│   │   ├── upload.js        # File upload middleware
│   │   └── validation.js    # Request validation
│   ├── routes/
│   │   ├── documents.js     # Document management routes
│   │   ├── signing.js       # Signing process routes
│   │   └── health.js        # Health check routes
│   ├── services/
│   │   ├── documentService.js  # Document business logic
│   │   ├── emailService.js     # Email notifications
│   │   └── storageService.js   # File storage operations
│   └── utils/
│       ├── helpers.js       # Utility functions
│       └── constants.js     # Application constants
├── uploads/                 # Temporary file uploads
├── .env                     # Environment variables
├── .gitignore              # Git ignore rules
├── package.json            # Dependencies and scripts
└── server.js               # Application entry point
```

## 🔒 Security Features

- **CORS Protection**: Configured for specific frontend origins
- **File Validation**: Strict file type and size validation
- **Input Sanitization**: Request data validation and sanitization
- **Secure Headers**: Security headers for API responses
- **Environment Variables**: Sensitive data stored in environment variables

## 🧪 Testing

Run tests:
```bash
npm test
```

Run tests with coverage:
```bash
npm run test:coverage
```

## 📦 Deployment

### Using PM2 (Recommended)
```bash
npm install -g pm2
pm2 start ecosystem.config.js
```

### Using Docker
```bash
docker build -t signbe .
docker run -p 5002:5002 --env-file .env signbe
```

### Environment Variables for Production
Make sure to set all required environment variables in your production environment.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

If you encounter any issues or have questions:

1. Check the [Issues](../../issues) page
2. Create a new issue with detailed information
3. Contact the development team

## 🔄 Changelog

### v1.0.0
- Initial release
- Document upload and management
- Multi-signer support
- Digital signature functionality
- Email notifications
- RESTful API

---

**Built with ❤️ by the SignBE Team** 