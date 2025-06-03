require('dotenv').config();
const emailService = require('./email');

async function testRealDocumentShare() {
  try {
    console.log('🧪 Testing REAL document sharing email flow...');
    console.log('📧 This simulates exactly what happens when you hit "Share Document"');
    console.log('');
    
    // Simulate the exact data structure from the document sharing endpoint
    const documentData = {
      title: 'Employment Contract 2024',
      originalName: 'employment-contract.pdf'
    };
    
    const signer = {
      email: 'malik.vk07@gmail.com',
      name: 'Malik Kumar'
    };
    
    const senderName = 'HR Department';
    const senderEmail = 'hr@company.com';
    const message = 'Please review and sign this employment contract at your earliest convenience.';
    const documentId = 'test-doc-12345';
    
    // Create the exact signing URL like the backend does
    const signingUrl = `${process.env.FRONTEND_URL || 'http://localhost:3002'}/sign/${documentId}?signer=${encodeURIComponent(signer.email)}`;
    
    // Create the exact emailData structure from index.js lines 1129-1138
    const emailData = {
      signerEmail: signer.email,
      signerName: signer.name || signer.email.split('@')[0],
      documentTitle: documentData.title || documentData.originalName || 'Document',
      senderName: senderName,
      senderEmail: senderEmail,
      message: message || '',
      signingUrl: signingUrl
    };
    
    console.log('📄 Document Info:');
    console.log('  Title:', emailData.documentTitle);
    console.log('  Sender:', emailData.senderName, `(${emailData.senderEmail})`);
    console.log('');
    console.log('👤 Signer Info:');
    console.log('  Name:', emailData.signerName);
    console.log('  Email:', emailData.signerEmail);
    console.log('');
    console.log('🔗 Signing URL:');
    console.log('  ', emailData.signingUrl);
    console.log('');
    console.log('💌 Message:', emailData.message);
    console.log('');
    console.log('📧 Sending email exactly like the document sharing endpoint...');
    
    // This is the EXACT same call as in index.js line 1141
    const result = await emailService.sendDocumentShareEmail(emailData);
    
    console.log('✅ SUCCESS! Document sharing email sent');
    console.log('📬 Message ID:', result.messageId);
    console.log('');
    console.log('🎯 If you received the test email but not this one, check:');
    console.log('  1. Email template differences');
    console.log('  2. Email data validation in sendDocumentShareEmail');
    console.log('  3. Any errors in the email template rendering');
    console.log('');
    console.log('📱 Check your email inbox for the document signing request!');
    
  } catch (error) {
    console.error('❌ Real document sharing email test failed!');
    console.error('📧 Error:', error.message);
    console.error('📋 Stack:', error.stack);
    
    // Try to identify the specific issue
    if (error.message.includes('Required document data is missing')) {
      console.log('');
      console.log('🔍 DIAGNOSIS: Missing required data in sendDocumentShareEmail');
      console.log('📋 Check: signerEmail, signerName, documentTitle validation');
    } else if (error.message.includes('Failed to send email')) {
      console.log('');
      console.log('🔍 DIAGNOSIS: Email transport/template issue');
      console.log('📋 Check: Email template rendering or SMTP connection');
    } else {
      console.log('');
      console.log('🔍 DIAGNOSIS: Unknown error in document sharing flow');
    }
    
    process.exit(1);
  }
}

// Run the test
testRealDocumentShare(); 