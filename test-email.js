const emailService = require('./email');

async function testEmail() {
  try {
    console.log('🧪 Testing email functionality...');
    
    // Test 1: Basic email similar to your working example
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Test Email from SignFlow</h2>
        <p>Hello,</p>
        <p>This is a test email to verify the email configuration is working properly.</p>
        <h1 style="font-size: 32px; letter-spacing: 5px; text-align: center; padding: 20px; background-color: #f5f5f5; border-radius: 5px;">TEST123</h1>
        <p>This is just a test to make sure emails are being sent correctly.</p>
        <p>If you received this email, the email service is working!</p>
        <p>Best regards,<br>SignFlow Team</p>
      </div>
    `;

    console.log('📧 Sending basic test email...');
    const result1 = await emailService.sendEmail({
      to: 'malik.vk07@gmail.com',
      subject: 'Test Email - SignFlow Email Service',
      text: `Your test email from SignFlow. This is just a test to make sure emails are being sent correctly.`,
      html: emailHtml
    });

    console.log('✅ Basic email result:', result1);

    // Test 2: Using the document share template
    console.log('📧 Sending document share template email...');
    const documentData = {
      signerEmail: 'malik.vk07@gmail.com',
      signerName: 'Malik',
      documentTitle: 'Test Document - Email Check',
      senderName: 'SignFlow Test',
      senderEmail: 'test@signflow.com',
      message: 'This is a test document to verify email templates are working.',
      signingUrl: 'https://example.com/test-signing-url'
    };

    const result2 = await emailService.sendDocumentShareEmail(documentData);
    console.log('✅ Document share email result:', result2);

    console.log('🎉 All email tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Email test failed:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

// Run the test
testEmail(); 