const nodemailer = require('nodemailer');

async function sendTestEmail(email, password, testEmailAddress = 'malik.vk07@gmail.com') {
  try {
    console.log('🧪 Creating email transporter...');
    
    // Create transporter with provided credentials
    const transporter = nodemailer.createTransport({
      host: 'smtpout.secureserver.net',
      port: 465,
      secure: true,
      auth: {
        user: email,
        pass: password
      },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 15000,
      socketTimeout: 15000
    });

    console.log('📧 Preparing test email...');
    
    // Simple email HTML similar to your working example
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>SignFlow Email Test</h2>
        <p>Hello,</p>
        <p>This is a test email to verify SignFlow email configuration is working.</p>
        <h1 style="font-size: 32px; letter-spacing: 5px; text-align: center; padding: 20px; background-color: #f5f5f5; border-radius: 5px;">✅ SUCCESS</h1>
        <p>If you receive this email, the email service is working correctly!</p>
        <p>Email sent at: ${new Date().toLocaleString()}</p>
        <p>Best regards,<br>SignFlow Team</p>
      </div>
    `;

    const mailOptions = {
      from: email,
      to: testEmailAddress,
      subject: '✅ SignFlow Email Test - Configuration Check',
      text: `SignFlow email test sent at ${new Date().toLocaleString()}. If you received this, the email service is working!`,
      html: emailHtml
    };

    console.log(`📤 Sending test email to: ${testEmailAddress}`);
    console.log(`📧 From: ${email}`);
    
    const info = await transporter.sendMail(mailOptions);
    
    console.log('✅ Email sent successfully!');
    console.log('📬 Message ID:', info.messageId);
    console.log('🎉 Check your inbox!');
    
    return { success: true, messageId: info.messageId };
    
  } catch (error) {
    console.error('❌ Email sending failed:', error.message);
    throw error;
  }
}

// If running directly, get credentials from command line arguments
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node simple-email-test.js <email> <password> [test-email-address]');
    console.log('Example: node simple-email-test.js admin@signflow.com mypassword malik.vk07@gmail.com');
    process.exit(1);
  }
  
  const [email, password, testEmail] = args;
  sendTestEmail(email, password, testEmail);
}

module.exports = sendTestEmail; 