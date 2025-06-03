require('dotenv').config();
const emailService = require('./email');

async function testDocumentEmail() {
  try {
    console.log('🧪 Testing enhanced document sharing email...');
    
    // Test document sharing email with proper signing URL
    const documentData = {
      signerEmail: 'malik.vk07@gmail.com',
      signerName: 'Malik Kumar',
      documentTitle: 'Employment Contract - SignFlow Test',
      senderName: 'HR Department',
      senderEmail: 'hr@company.com',
      message: 'Please review and sign this employment contract. Your signature is required to complete the hiring process.',
      signingUrl: 'http://localhost:3002/sign/test-doc-123?signer=malik.vk07%40gmail.com'
    };

    console.log('📧 Sending enhanced document sharing email...');
    console.log('📄 Document:', documentData.documentTitle);
    console.log('👤 To:', documentData.signerEmail);
    console.log('🔗 Signing URL:', documentData.signingUrl);
    
    const result = await emailService.sendDocumentShareEmail(documentData);
    
    console.log('✅ Enhanced document email sent successfully!');
    console.log('📬 Message ID:', result.messageId);
    console.log('🎯 Features included:');
    console.log('  ✓ Enhanced "START SIGNING NOW" button');
    console.log('  ✓ Action-oriented subject line');
    console.log('  ✓ Professional document information');
    console.log('  ✓ Security notices');
    console.log('  ✓ Direct signing URL link');
    console.log('');
    console.log('📱 Check your email inbox for the enhanced document signing request!');
    
  } catch (error) {
    console.error('❌ Document email test failed:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

// Run the test
testDocumentEmail(); 